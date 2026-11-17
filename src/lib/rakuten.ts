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

const COUPON_API = 'https://api.linksynergy.com/coupon/1.0';
const EVENTS_API = 'https://api.linksynergy.com/events/1.0/transactions';
const PER_PAGE = 500;

export async function rakutenToken(): Promise<string> {
  const key = process.env.RAKUTEN_TOKEN_KEY;
  const sid = process.env.RAKUTEN_SID;
  if (!key || !sid) throw new Error('Defina RAKUTEN_TOKEN_KEY e RAKUTEN_SID nas variáveis de ambiente.');
  const res = await fetch('https://api.linksynergy.com/token', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ scope: sid }),
  });
  if (!res.ok) throw new Error(`Rakuten /token respondeu ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  return json.access_token;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', trimValues: true });
const text = (v: any): string | null => (v == null ? null : typeof v === 'object' ? (v['#text'] ?? null) : String(v));
const asArray = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const sqlDate = (s: string | null) => {
  if (!s) return null;
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

async function ensureStore(mid: string, name: string): Promise<number> {
  const rows = await query("SELECT id FROM stores WHERE network='rakuten' AND network_mid=?", [mid]);
  if (rows[0]) return rows[0].id;
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
  const token = await rakutenToken();
  const startedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const before = await query('SELECT COUNT(*) AS n FROM stores');
  let page = 1, total = 1, synced = 0;

  do {
    const params = new URLSearchParams({ resultsperpage: String(PER_PAGE), pagenumber: String(page) });
    if (process.env.RAKUTEN_NETWORK) params.set('network', process.env.RAKUTEN_NETWORK);
    const res = await fetch(`${COUPON_API}?${params}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/xml' } });
    if (!res.ok) throw new Error(`Coupon API página ${page}: ${res.status} ${await res.text()}`);
    const feed = parser.parse(await res.text()).couponfeed || {};
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

      await exec(
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
      synced++;
    }
    page++;
  } while (page <= total);

  // Cupons da Rakuten que não vieram nesta execução saíram do feed: desativa (não apaga, mantém histórico).
  const off = await exec("UPDATE coupons SET active=0 WHERE source='rakuten' AND active=1 AND updated_at < ?", [startedAt]);
  const after = await query('SELECT COUNT(*) AS n FROM stores');
  clearCache();
  return { synced, deactivated: off.affectedRows, newStores: Number(after[0].n) - Number(before[0].n) };
}

export async function syncConversions(days = 7): Promise<{ imported: number }> {
  const token = await rakutenToken();
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  let page = 1, imported = 0;

  while (page < 100) {
    const params = new URLSearchParams({ transaction_date_start: since, limit: '1000', page: String(page) });
    const res = await fetch(`${EVENTS_API}?${params}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Events API: ${res.status} ${await res.text()}`);
    const list: any = await res.json();
    if (!Array.isArray(list) || list.length === 0) break;

    for (const t of list) {
      const store = await query("SELECT id FROM stores WHERE network='rakuten' AND network_mid=?", [String(t.advertiser_id ?? '')]);
      await exec(
        `INSERT INTO conversions (network, network_txn_id, click_id, store_id, order_amount, commission, currency, status, transaction_at, raw_json)
         VALUES ('rakuten', ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE order_amount=VALUES(order_amount), commission=VALUES(commission), status=VALUES(status), raw_json=VALUES(raw_json)`,
        [
          String(t.etransaction_id ?? t.transaction_id),
          t.u1 ? String(t.u1).slice(0, 22) : null,
          store[0]?.id ?? null,
          t.sale_amount ?? null,
          t.commissions ?? null,
          t.currency || 'BRL',
          Number(t.sale_amount) < 0 ? 'reversed' : 'pending',
          sqlDate(t.transaction_date ?? null),
          JSON.stringify(t),
        ],
      );
      imported++;
    }
    page++;
  }
  return { imported };
}
