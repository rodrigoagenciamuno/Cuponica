/**
 * Integração com a Rakuten Advertising.
 *  - syncCoupons():     Coupon Web Service → tabela coupons (e cria lojas novas pelo MID)
 *  - syncConversions(): Events/Transactions API → tabela conversions, ligada ao clique pelo u1
 *
 * Disparadas pelos endpoints /api/cron/* (Cron Job do hPanel).
 * ATENÇÃO: validar os nomes de campos com a primeira resposta real da API assim que as credenciais saírem.
 */
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { exec, query } from './db';
import { clearCache } from './data';
import { slugify } from './util';
import { pingIndexNow } from './indexnow';

const COUPON_API = 'https://api.linksynergy.com/coupon/1.0';
const PARTNERSHIPS_API = 'https://api.linksynergy.com/v1/partnerships';
const ADVERTISERS_API = 'https://api.linksynergy.com/v2/advertisers';
const EVENTS_API = 'https://api.linksynergy.com/events/1.0/transactions';
const PER_PAGE = 500;

// O access token vale 3600 s. Guardamos em memória para não pedir um novo a cada chamada.
let cachedToken: { value: string; expiresAt: number } | null = null;

export async function rakutenToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const key = process.env.RAKUTEN_TOKEN_KEY?.trim();
  const sid = process.env.RAKUTEN_SID?.trim();
  if (!key || !sid) throw new Error('Defina RAKUTEN_TOKEN_KEY e RAKUTEN_SID nas variáveis de ambiente.');
  const res = await fetch('https://api.linksynergy.com/token', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ scope: sid }),
  });
  if (!res.ok) throw new Error(`Rakuten /token respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json: any = await res.json();
  if (!json.access_token) throw new Error(`Rakuten /token não devolveu access_token: ${JSON.stringify(json).slice(0, 300)}`);
  const ttl = Number(json.expires_in || 3600);
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (ttl - 120) * 1000 };
  return cachedToken.value;
}

/** GET autenticado. Renova o token uma vez se vier 401 e espera se bater no limite de 100 chamadas/min (429). */
async function rakutenGet(url: string, accept: string): Promise<Response> {
  let res!: Response;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, { headers: { Authorization: `Bearer ${await rakutenToken()}`, Accept: accept } });
    if (res.status === 401 && attempt === 0) { cachedToken = null; continue; }
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 15_000)); continue; }
    break;
  }
  return res;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', trimValues: true });
const text = (v: any): string | null => (v == null ? null : typeof v === 'object' ? (v['#text'] ?? null) : String(v));
const asArray = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const sqlDate = (s: string | null) => {
  if (!s) return null;
  // A Coupon API manda "2026-11-30T23:59Z" ou "2026-11-30"; a Events API manda "Tue Nov 03 2020 21:47:55 GMT+0000 (UTC)".
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
};

export function discountLabel(s: string | null): string | null {
  if (!s) return null;
  const pct = s.match(/(\d{1,2})\s?%/);
  if (pct) return `${pct[1]}% OFF`;
  const brl = s.match(/R\$\s?(\d+[.,]?\d*)/i);
  if (brl) return `R$ ${brl[1]}`;
  if (/frete\s+gr[aá]tis|free shipping/i.test(s)) return 'Frete grátis';
  return null;
}

/**
 * Nome de vitrine a partir do nome interno da Rakuten: tira sufixos de conta/rede
 * ("New Balance BR", "Netshoes WL", "Zupper Viagens" fica como está; "Brae Hair Care" não muda).
 */
export function cleanStoreName(raw: string): string {
  let name = String(raw).trim();
  for (let i = 0; i < 3; i++) {
    const next = name.replace(/[\s\-–|]+(BR|WL|Brasil|Brazil|Brazilian|LATAM|BRL|Affiliate|Afiliados?)$/i, '').trim();
    if (next === name || !next) break;
    name = next;
  }
  return name || String(raw).trim();
}

/** Categorias da Rakuten (texto livre, PT ou EN) → slugs das categorias do site. */
const CATEGORY_RULES: [RegExp, string][] = [
  [/vestu|roupa|moda|apparel|clothing|fashion|cal[cç]ad|shoe|footwear|acess[oó]rio|accessor|j[oó]ia|jewel/i, 'moda'],
  [/esport|sport|fitness|outdoor|suplement/i, 'esportes'],
  [/beleza|beauty|perfum|cosm[eé]t|fragr|sa[uú]de|health|farm[aá]c|pharm|cabelo|hair/i, 'beleza'],
  [/eletr[oô]n|electron|computa|computer|inform[aá]t|celular|phone|game|tecnolog|tech/i, 'eletronicos'],
  [/viag|travel|f[eé]rias|vacation|hotel|passage|flight|turismo|tourism/i, 'viagens'],
  [/casa|home|decora|m[oó]ve|furnit|utilidade|kitchen|cozinha|jardim|garden/i, 'casa'],
  [/aliment|food|bebida|beverage|drink|gourmet|mercado|grocer|nutri/i, 'alimentos'],
];
export function mapCategories(rakutenCategories: unknown): string[] {
  const list = Array.isArray(rakutenCategories) ? rakutenCategories.map(String) : [];
  const out = new Set<string>();
  for (const c of list) for (const [re, slug] of CATEGORY_RULES) if (re.test(c)) out.add(slug);
  return [...out];
}

async function ensureStore(mid: string, rawName: string): Promise<number> {
  const rows = await query("SELECT id FROM stores WHERE network='rakuten' AND network_mid=?", [mid]);
  if (rows[0]) return rows[0].id;
  const name = cleanStoreName(rawName);
  let slug = slugify(name);
  const dup = await query('SELECT id FROM stores WHERE slug=?', [slug]);
  if (dup[0]) slug = `${slug}-${mid}`;
  const r = await exec(
    "INSERT INTO stores (slug, name, website_url, network, network_mid) VALUES (?,?,'',  'rakuten', ?)",
    [slug, name, mid],
  );
  return r.insertId;
}

export async function syncCoupons(): Promise<{ synced: number; deactivated: number; newStores: number }> {
  const startedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const before = await query('SELECT COUNT(*) AS n FROM stores');
  let page = 1, total = 1, synced = 0;
  const changedStores = new Set<number>();

  do {
    const params = new URLSearchParams({ resultsperpage: String(PER_PAGE), pagenumber: String(page) });
    if (process.env.RAKUTEN_NETWORK) params.set('network', process.env.RAKUTEN_NETWORK);
    const res = await rakutenGet(`${COUPON_API}?${params}`, 'application/xml');
    const body = await res.text();
    if (!res.ok) throw new Error(`Coupon API página ${page}: ${res.status} ${body.slice(0, 300)}`);
    const parsed = parser.parse(body);
    if (!parsed.couponfeed) throw new Error(`Coupon API página ${page}: resposta inesperada ${body.slice(0, 300)}`);
    const feed = parsed.couponfeed;
    total = Number(feed.TotalPages || 1);

    for (const l of asArray<any>(feed.link)) {
      const mid = text(l.advertiserid);
      const advertiser = text(l.advertisername);
      const clickUrl = text(l.clickurl);
      if (!mid || !advertiser || !clickUrl) continue;

      const storeId = await ensureStore(mid, advertiser);
      const description = text(l.offerdescription) || '';
      const code = text(l.couponcode);
      const externalId = createHash('sha1').update(`${mid}|${clickUrl}`).digest('hex');

      const up = await exec(
        `INSERT INTO coupons (store_id, source, external_id, type, title, description, code, discount_label, tracking_url, starts_at, expires_at, active)
         VALUES (?, 'rakuten', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE type=VALUES(type), title=VALUES(title), description=VALUES(description), code=VALUES(code),
           discount_label=VALUES(discount_label), tracking_url=VALUES(tracking_url), starts_at=VALUES(starts_at),
           expires_at=VALUES(expires_at), active=1, updated_at=CURRENT_TIMESTAMP`,
        [
          storeId, externalId, code ? 'code' : 'deal', description.slice(0, 255), text(l.couponrestriction),
          code, discountLabel(description), clickUrl, sqlDate(text(l.offerstartdate)), sqlDate(text(l.offerenddate)),
        ],
      );
      if (up.affectedRows === 1) changedStores.add(storeId); // cupom novo
      synced++;
    }
    page++;
  } while (page <= total);

  // Cupons da Rakuten que não vieram nesta execução saíram do feed: desativa (não apaga, mantém histórico).
  // Se o feed veio vazio, não desativa nada: é mais provável ser falha momentânea do que todas as lojas sem cupom.
  let off = { affectedRows: 0 };
  if (synced > 0) {
    const gone = await query("SELECT DISTINCT store_id FROM coupons WHERE source='rakuten' AND active=1 AND updated_at < ?", [startedAt]);
    gone.forEach((r: any) => changedStores.add(Number(r.store_id)));
    off = await exec("UPDATE coupons SET active=0 WHERE source='rakuten' AND active=1 AND updated_at < ?", [startedAt]);
  }
  const after = await query('SELECT COUNT(*) AS n FROM stores');
  clearCache();

  // Avisa Bing/Yandex (IndexNow) só das lojas que ganharam ou perderam cupons.
  let indexnow: unknown = null;
  if (changedStores.size) {
    const rows = await query("SELECT slug FROM stores WHERE id IN (?) AND network <> 'demo'", [[...changedStores]]);
    indexnow = await pingIndexNow(['/', ...rows.map((r: any) => `/cupom-desconto/${r.slug}`)]);
  }
  return { synced, deactivated: off.affectedRows, newStores: Number(after[0].n) - Number(before[0].n), indexnow };
}

/**
 * Partnerships API: cria uma loja para cada anunciante com parceria ativa, mesmo que ele não tenha cupom no feed.
 * Muitos anunciantes (ex.: Mundo Danone) só têm a comissão padrão, sem cupom. Sem isso a loja nunca aparecia no site.
 * Para lojas sem website_url, busca a URL na Advertisers API: com ela o "Ir para a loja" vira deeplink da Rakuten
 * (RAKUTEN_PUBLISHER_ID + MID), e o clique gera comissão.
 */
export async function syncPartnerships(): Promise<{ partners: number; newStores: number; urlsFilled: number; newSlugs: string[] }> {
  const LIMIT = 200;
  let page = 1, partners = 0, newStores = 0, urlsFilled = 0;
  const newSlugs: string[] = [];

  while (page <= 50) {
    const params = new URLSearchParams({ partner_status: 'active', limit: String(LIMIT), page: String(page) });
    if (process.env.RAKUTEN_NETWORK) params.set('network', process.env.RAKUTEN_NETWORK);
    const res = await rakutenGet(`${PARTNERSHIPS_API}?${params}`, 'application/json');
    const body = await res.text();
    if (!res.ok) throw new Error(`Partnerships API página ${page}: ${res.status} ${body.slice(0, 300)}`);
    const json: any = JSON.parse(body || '{}');
    const list: any[] = Array.isArray(json.partnerships) ? json.partnerships : [];

    for (const p of list) {
      const mid = p?.advertiser?.id != null ? String(p.advertiser.id) : null;
      const name = p?.advertiser?.name ? String(p.advertiser.name).trim() : null;
      if (!mid || !name) continue;
      partners++;

      const existing = await query("SELECT id, slug, website_url FROM stores WHERE network='rakuten' AND network_mid=?", [mid]);
      let storeId: number;
      let websiteUrl = existing[0]?.website_url || '';
      if (existing[0]) {
        storeId = existing[0].id;
      } else {
        storeId = await ensureStore(mid, name);
        // Loja nova: já entra com as categorias que a Rakuten informa (quando batem com as do site).
        const cats = mapCategories(p?.advertiser?.categories);
        if (cats.length) {
          await exec(
            'INSERT IGNORE INTO store_categories (store_id, category_id) SELECT ?, id FROM categories WHERE slug IN (?)',
            [storeId, cats],
          );
        }
        const row = await query('SELECT slug FROM stores WHERE id=?', [storeId]);
        if (row[0]) newSlugs.push(row[0].slug);
        newStores++;
      }

      if (!websiteUrl) {
        const adv = await rakutenGet(`${ADVERTISERS_API}/${encodeURIComponent(mid)}`, 'application/json');
        if (adv.ok) {
          const a: any = JSON.parse((await adv.text()) || '{}');
          const url = String(a?.advertiser?.url || '').trim();
          if (/^https?:\/\//i.test(url)) {
            await exec("UPDATE stores SET website_url=? WHERE id=? AND (website_url IS NULL OR website_url='')", [url.slice(0, 500), storeId]);
            urlsFilled++;
          }
        }
      }
    }

    const total = Number(json?._metadata?.total || 0);
    const hasNext = Boolean(json?._metadata?._links?.next);
    if (list.length < LIMIT || (total && page * LIMIT >= total) || (!hasNext && !total)) break;
    page++;
  }

  if (newStores || urlsFilled) clearCache();
  return { partners, newStores, urlsFilled, newSlugs };
}

const eventsDate = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

/**
 * Events API: guarda só as últimas 1–2 semanas e exige início E fim juntos, com no máximo 30 dias de intervalo.
 * Os valores são "direcionais" (a Rakuten não atualiza comissão depois); o valor oficial está no Signature Orders Report.
 */
export async function syncConversions(days = 7): Promise<{ imported: number; matched: number }> {
  days = Math.min(Math.max(days, 1), 30);
  const end = new Date();
  const start = new Date(end.getTime() - days * 864e5);
  const LIMIT = 1000;
  let page = 1, imported = 0, matched = 0;

  while (page <= 100) {
    const params = new URLSearchParams({
      transaction_date_start: eventsDate(start),
      transaction_date_end: eventsDate(end),
      limit: String(LIMIT),
      page: String(page),
    });
    const res = await rakutenGet(`${EVENTS_API}?${params}`, 'application/json');
    const body = await res.text();
    if (!res.ok) throw new Error(`Events API: ${res.status} ${body.slice(0, 300)}`);
    const list: any = JSON.parse(body || '[]');
    if (!Array.isArray(list) || list.length === 0) break;

    for (const t of list) {
      const txnId = String(t.etransaction_id ?? t.transaction_id ?? '');
      if (!txnId) continue;
      const store = await query("SELECT id FROM stores WHERE network='rakuten' AND network_mid=?", [String(t.advertiser_id ?? '')]);
      const clickId = t.u1 ? String(t.u1).slice(0, 22) : null;
      if (clickId) matched++;
      const reversed = Number(t.sale_amount) < 0 || String(t.is_event ?? '').toUpperCase() === 'N';
      await exec(
        `INSERT INTO conversions (network, network_txn_id, click_id, store_id, order_amount, commission, currency, status, transaction_at, raw_json)
         VALUES ('rakuten', ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE order_amount=VALUES(order_amount), commission=VALUES(commission), status=VALUES(status), raw_json=VALUES(raw_json)`,
        [
          txnId,
          clickId,
          store[0]?.id ?? null,
          t.sale_amount ?? null,
          t.commissions ?? null,
          t.currency || 'BRL',
          reversed ? 'reversed' : 'pending',
          sqlDate(t.transaction_date ?? null),
          JSON.stringify(t),
        ],
      );
      imported++;
    }
    if (list.length < LIMIT) break;
    page++;
  }
  return { imported, matched };
}

/**
 * Diagnóstico para a primeira conexão: testa o token, lista as redes/categorias/tipos de promoção
 * liberados para a conta e mostra uma amostra crua do feed, sem gravar nada no banco.
 */
export async function rakutenDiagnostics(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    env: {
      RAKUTEN_TOKEN_KEY: process.env.RAKUTEN_TOKEN_KEY ? `definida (${process.env.RAKUTEN_TOKEN_KEY.trim().length} caracteres)` : 'FALTANDO',
      RAKUTEN_SID: process.env.RAKUTEN_SID ? 'definida' : 'FALTANDO',
      RAKUTEN_PUBLISHER_ID: process.env.RAKUTEN_PUBLISHER_ID ? 'definida' : 'faltando (só usada no deeplink de lojas sem cupom)',
      RAKUTEN_NETWORK: process.env.RAKUTEN_NETWORK || '(vazia: todas as redes)',
    },
  };
  try {
    await rakutenToken(true);
    out.token = 'ok';
  } catch (e: any) {
    out.token = `ERRO: ${e?.message || e}`;
    return out;
  }

  const ids = await rakutenGet(`${COUPON_API}?promocat=1`, 'application/xml');
  const idsBody = await ids.text();
  out.networks = ids.ok
    ? asArray<any>(parser.parse(idsBody).couponfeed?.network).map((n) => ({
        id: n['@id'],
        name: text(n.name),
        categories: asArray<any>(n.categories?.category).map((c) => `${c['@id']}: ${text(c)}`),
        promotiontypes: asArray<any>(n.promotiontypes?.promotiontype).map((p) => `${p['@id']}: ${text(p)}`),
      }))
    : `ERRO ${ids.status}: ${idsBody.slice(0, 300)}`;

  const params = new URLSearchParams({ resultsperpage: '5', pagenumber: '1' });
  if (process.env.RAKUTEN_NETWORK) params.set('network', process.env.RAKUTEN_NETWORK);
  const feed = await rakutenGet(`${COUPON_API}?${params}`, 'application/xml');
  const feedBody = await feed.text();
  if (feed.ok) {
    const f = parser.parse(feedBody).couponfeed || {};
    out.coupons = { totalMatches: f.TotalMatches, totalPages: f.TotalPages, sample: asArray<any>(f.link).slice(0, 5) };
  } else {
    out.coupons = `ERRO ${feed.status}: ${feedBody.slice(0, 300)}`;
  }

  const pp = new URLSearchParams({ partner_status: 'active', limit: '10' });
  if (process.env.RAKUTEN_NETWORK) pp.set('network', process.env.RAKUTEN_NETWORK);
  const parts = await rakutenGet(`${PARTNERSHIPS_API}?${pp}`, 'application/json');
  const partsBody = await parts.text();
  out.partnerships = parts.ok
    ? (() => {
        const j: any = JSON.parse(partsBody || '{}');
        return {
          total: j?._metadata?.total,
          sample: (j.partnerships || []).map((p: any) => `${p?.advertiser?.id}: ${p?.advertiser?.name} (${p?.status})`),
        };
      })()
    : `ERRO ${parts.status}: ${partsBody.slice(0, 300)}`;

  const end = new Date();
  const ev = new URLSearchParams({
    transaction_date_start: eventsDate(new Date(end.getTime() - 14 * 864e5)),
    transaction_date_end: eventsDate(end),
    limit: '3',
  });
  const events = await rakutenGet(`${EVENTS_API}?${ev}`, 'application/json');
  const evBody = await events.text();
  out.events = events.ok ? { sample: JSON.parse(evBody || '[]') } : `ERRO ${events.status}: ${evBody.slice(0, 300)}`;
  return out;
}
