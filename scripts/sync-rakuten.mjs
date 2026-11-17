// Sincroniza cupons da API de cupons da Rakuten Advertising (Coupon Web Service) com o MySQL.
// Rodar via Cron Job do hPanel, por exemplo a cada 2 horas:
//   npm run sync:cupons
//
// O que faz:
//  1. Busca todas as páginas do feed de cupons dos anunciantes aprovados.
//  2. Cria a loja se for nova (pelo MID do anunciante) — o texto editorial é preenchido depois no admin.
//  3. Insere ou atualiza cada cupom (sem duplicar), guardando o clickurl como tracking_url.
//  4. Desativa cupons da Rakuten que saíram do feed.
//
// ATENÇÃO: validar os nomes de campos com a primeira resposta real da API assim que as credenciais saírem.
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { connect, rakutenToken, slugify, log } from './lib.mjs';

const API = 'https://api.linksynergy.com/coupon/1.0';
const PER_PAGE = 500;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', trimValues: true });
const text = (v) => (v == null ? null : typeof v === 'object' ? (v['#text'] ?? null) : String(v));
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function discountLabel(s) {
  if (!s) return null;
  const pct = s.match(/(\d{1,2})\s?%/);
  if (pct) return `${pct[1]}% OFF`;
  const brl = s.match(/R\$\s?(\d+[.,]?\d*)/i);
  if (brl) return `R$ ${brl[1]}`;
  if (/frete\s+gr[aá]tis|free shipping/i.test(s)) return 'Frete grátis';
  return null;
}

function toDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
}

async function fetchPage(token, page) {
  const params = new URLSearchParams({ resultsperpage: String(PER_PAGE), pagenumber: String(page) });
  if (process.env.RAKUTEN_NETWORK) params.set('network', process.env.RAKUTEN_NETWORK);
  const res = await fetch(`${API}?${params}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/xml' } });
  if (!res.ok) throw new Error(`Coupon API página ${page}: ${res.status} ${await res.text()}`);
  const feed = parser.parse(await res.text()).couponfeed || {};
  return { links: asArray(feed.link), totalPages: Number(feed.TotalPages || 1) };
}

async function ensureStore(db, mid, name) {
  const [rows] = await db.query("SELECT id FROM stores WHERE network='rakuten' AND network_mid=?", [mid]);
  if (rows[0]) return rows[0].id;
  let slug = slugify(name);
  const [dup] = await db.query('SELECT id FROM stores WHERE slug=?', [slug]);
  if (dup[0]) slug = `${slug}-${mid}`;
  const [r] = await db.query(
    "INSERT INTO stores (slug, name, website_url, network, network_mid) VALUES (?,?,?,'rakuten',?)",
    [slug, name, 'https://', mid],
  );
  log(`Nova loja: ${name} (${slug})`);
  return r.insertId;
}

const db = await connect();
const token = await rakutenToken();
const startedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
let page = 1, total = 1, count = 0;

do {
  const { links, totalPages } = await fetchPage(token, page);
  total = totalPages;
  for (const l of links) {
    const mid = text(l.advertiserid);
    const advertiser = text(l.advertisername);
    const clickUrl = text(l.clickurl);
    if (!mid || !advertiser || !clickUrl) continue;

    const storeId = await ensureStore(db, mid, advertiser);
    const description = text(l.offerdescription) || '';
    const code = text(l.couponcode);
    const restriction = text(l.couponrestriction);
    const externalId = createHash('sha1').update(`${mid}|${clickUrl}`).digest('hex');

    await db.query(
      `INSERT INTO coupons (store_id, source, external_id, type, title, description, code, discount_label, tracking_url, starts_at, expires_at, active)
       VALUES (?, 'rakuten', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE type=VALUES(type), title=VALUES(title), description=VALUES(description), code=VALUES(code),
         discount_label=VALUES(discount_label), tracking_url=VALUES(tracking_url), starts_at=VALUES(starts_at),
         expires_at=VALUES(expires_at), active=1, updated_at=CURRENT_TIMESTAMP`,
      [
        storeId, externalId, code ? 'code' : 'deal',
        description.slice(0, 255), restriction, code, discountLabel(description),
        clickUrl, toDate(text(l.offerstartdate)), toDate(text(l.offerenddate)),
      ],
    );
    count++;
  }
  log(`Página ${page}/${total}: ${links.length} cupons`);
  page++;
} while (page <= total);

// Cupons da Rakuten que não vieram nesta execução saíram do feed: desativa (não apaga, para manter histórico).
const [res] = await db.query("UPDATE coupons SET active=0 WHERE source='rakuten' AND active=1 AND updated_at < ?", [startedAt]);
log(`Concluído: ${count} cupons sincronizados, ${res.affectedRows} desativados.`);
await db.end();
