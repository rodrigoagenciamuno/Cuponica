/** Consultas e gravações usadas pelo painel admin. */
import { exec, query } from './db';
import { clearCache } from './data';
import { faqFromText, slugify } from './util';

export type FormValues = Record<string, string>;

const str = (v: FormDataEntryValue | null) => (v == null ? '' : String(v).trim());
const nul = (v: string) => (v === '' ? null : v);
const bool = (v: FormDataEntryValue | null) => (v === 'on' || v === '1' ? 1 : 0);

/* ---------- Resumo ---------- */
export async function dashboard() {
  const [kpi] = await query(`
    SELECT
      (SELECT COUNT(*) FROM stores WHERE active=1) AS stores,
      (SELECT COUNT(*) FROM coupons WHERE active=1 AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())) AS coupons,
      (SELECT COUNT(*) FROM clicks WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 DAY AND device <> 'bot') AS clicks_1d,
      (SELECT COUNT(*) FROM clicks WHERE created_at > UTC_TIMESTAMP() - INTERVAL 30 DAY AND device <> 'bot') AS clicks_30d,
      (SELECT COUNT(*) FROM conversions WHERE transaction_at > UTC_TIMESTAMP() - INTERVAL 30 DAY AND status <> 'reversed') AS sales_30d,
      (SELECT COALESCE(SUM(commission),0) FROM conversions WHERE transaction_at > UTC_TIMESTAMP() - INTERVAL 30 DAY AND status <> 'reversed') AS commission_30d
  `);
  const topStores = await query(`
    SELECT s.id, s.name, s.slug, COUNT(c.id) AS clicks,
      (SELECT COUNT(*) FROM conversions v WHERE v.store_id = s.id AND v.transaction_at > UTC_TIMESTAMP() - INTERVAL 30 DAY AND v.status <> 'reversed') AS sales,
      (SELECT COALESCE(SUM(commission),0) FROM conversions v WHERE v.store_id = s.id AND v.transaction_at > UTC_TIMESTAMP() - INTERVAL 30 DAY AND v.status <> 'reversed') AS commission
    FROM clicks c JOIN stores s ON s.id = c.store_id
    WHERE c.created_at > UTC_TIMESTAMP() - INTERVAL 30 DAY AND c.device <> 'bot'
    GROUP BY s.id ORDER BY clicks DESC LIMIT 15`);
  const topCoupons = await query(`
    SELECT cp.id, cp.title, s.name AS store, COUNT(c.id) AS clicks
    FROM clicks c JOIN coupons cp ON cp.id = c.coupon_id JOIN stores s ON s.id = cp.store_id
    WHERE c.created_at > UTC_TIMESTAMP() - INTERVAL 30 DAY AND c.device <> 'bot'
    GROUP BY cp.id ORDER BY clicks DESC LIMIT 15`);
  const topPages = await query(`
    SELECT page_path, COUNT(*) AS clicks FROM clicks
    WHERE created_at > UTC_TIMESTAMP() - INTERVAL 30 DAY AND device <> 'bot' AND page_path IS NOT NULL
    GROUP BY page_path ORDER BY clicks DESC LIMIT 10`);
  const topSources = await query(`
    SELECT COALESCE(utm_source, CASE WHEN referrer IS NULL THEN '(direto)' ELSE SUBSTRING_INDEX(SUBSTRING_INDEX(referrer, '/', 3), '/', -1) END) AS source,
      COUNT(*) AS clicks
    FROM clicks WHERE created_at > UTC_TIMESTAMP() - INTERVAL 30 DAY AND device <> 'bot'
    GROUP BY source ORDER BY clicks DESC LIMIT 10`);
  return { kpi, topStores, topCoupons, topPages, topSources };
}

/* ---------- Lojas ---------- */
export async function listStores(search = '') {
  const like = `%${search}%`;
  return query(
    `SELECT s.*,
       (SELECT COUNT(*) FROM coupons c WHERE c.store_id = s.id AND c.active = 1 AND (c.expires_at IS NULL OR c.expires_at > UTC_TIMESTAMP())) AS active_coupons,
       (SELECT COUNT(*) FROM clicks k WHERE k.store_id = s.id AND k.created_at > UTC_TIMESTAMP() - INTERVAL 30 DAY) AS clicks_30d
     FROM stores s WHERE s.name LIKE ? OR s.slug LIKE ? ORDER BY s.featured DESC, s.name LIMIT 500`,
    [like, like],
  );
}

export async function getStoreAdmin(id: number) {
  const [s] = await query('SELECT * FROM stores WHERE id = ?', [id]);
  if (!s) return null;
  const cats = await query('SELECT category_id FROM store_categories WHERE store_id = ?', [id]);
  return { ...s, categories: cats.map((c: any) => c.category_id) };
}

export async function saveStore(id: number | null, form: FormData): Promise<{ id: number } | { error: string }> {
  const name = str(form.get('name'));
  if (!name) return { error: 'Informe o nome da loja.' };
  const slug = slugify(str(form.get('slug')) || name);
  const dup = await query('SELECT id FROM stores WHERE slug = ? AND id <> ?', [slug, id ?? 0]);
  if (dup[0]) return { error: `Já existe uma loja com o endereço /cupom-desconto/${slug}.` };

  const values = [
    slug, name, str(form.get('website_url')), str(form.get('network')) || 'rakuten', nul(str(form.get('network_mid'))),
    nul(str(form.get('logo_url'))), nul(/^#[0-9a-f]{6}$/i.test(str(form.get('brand_color'))) ? str(form.get('brand_color')) : ''), nul(str(form.get('intro'))), nul(str(form.get('about'))),
    JSON.stringify(faqFromText(str(form.get('faq')))), bool(form.get('featured')), bool(form.get('active')),
  ];
  try {
    if (id) {
      await exec(
        `UPDATE stores SET slug=?, name=?, website_url=?, network=?, network_mid=?, logo_url=?, brand_color=?, intro=?, about=?, faq_json=?, featured=?, active=? WHERE id=?`,
        [...values, id],
      );
    } else {
      const r = await exec(
        `INSERT INTO stores (slug, name, website_url, network, network_mid, logo_url, brand_color, intro, about, faq_json, featured, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        values,
      );
      id = r.insertId;
    }
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY') return { error: 'Já existe uma loja com esse MID nessa rede.' };
    throw err;
  }
  await exec('DELETE FROM store_categories WHERE store_id = ?', [id]);
  for (const c of form.getAll('categories')) {
    await exec('INSERT IGNORE INTO store_categories (store_id, category_id) VALUES (?, ?)', [id, Number(c)]);
  }
  clearCache();
  return { id: id! };
}

/* ---------- Cupons ---------- */
export async function listCoupons(opts: { storeId?: number; status?: string; search?: string }) {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (opts.storeId) { where.push('c.store_id = ?'); params.push(opts.storeId); }
  if (opts.search) { where.push('(c.title LIKE ? OR c.code LIKE ?)'); params.push(`%${opts.search}%`, `%${opts.search}%`); }
  if (opts.status === 'ativos') where.push('c.active = 1 AND (c.expires_at IS NULL OR c.expires_at > UTC_TIMESTAMP())');
  if (opts.status === 'expirados') where.push('c.expires_at <= UTC_TIMESTAMP()');
  if (opts.status === 'inativos') where.push('c.active = 0');
  return query(
    `SELECT c.*, s.name AS store_name, s.slug AS store_slug,
       (SELECT COUNT(*) FROM clicks k WHERE k.coupon_id = c.id AND k.created_at > UTC_TIMESTAMP() - INTERVAL 30 DAY) AS clicks_30d
     FROM coupons c JOIN stores s ON s.id = c.store_id
     WHERE ${where.join(' AND ')} ORDER BY c.updated_at DESC LIMIT 300`,
    params,
  );
}

export async function getCouponAdmin(id: number) {
  const [c] = await query('SELECT * FROM coupons WHERE id = ?', [id]);
  return c ?? null;
}

/** "2026-12-31T23:59" (horário de Brasília, do input do formulário) → "2027-01-01 02:59:00" (UTC, no banco). */
function brToUtc(v: string): string | null {
  if (!v) return null;
  const d = new Date(`${v}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
}
/** Data do banco (UTC) → valor para input datetime-local em horário de Brasília. */
export function utcToBrInput(d: Date | string | null): string {
  if (!d) return '';
  const t = new Date(d).getTime() - 3 * 3600e3;
  return new Date(t).toISOString().slice(0, 16);
}

export async function saveCoupon(id: number | null, form: FormData): Promise<{ id: number } | { error: string }> {
  const storeId = Number(form.get('store_id'));
  const title = str(form.get('title'));
  const type = str(form.get('type')) === 'deal' ? 'deal' : 'code';
  const code = nul(str(form.get('code')));
  if (!storeId) return { error: 'Escolha a loja.' };
  if (!title) return { error: 'Informe o título do cupom.' };
  if (type === 'code' && !code) return { error: 'Cupom do tipo "código" precisa ter o código.' };

  const values = [
    storeId, type, title.slice(0, 255), nul(str(form.get('description'))), code, nul(str(form.get('discount_label'))),
    nul(str(form.get('tracking_url'))), nul(str(form.get('landing_url'))), brToUtc(str(form.get('expires_at'))),
    bool(form.get('verified')), bool(form.get('exclusive')), Number(form.get('priority') || 0), bool(form.get('active')),
  ];
  if (id) {
    await exec(
      `UPDATE coupons SET store_id=?, type=?, title=?, description=?, code=?, discount_label=?, tracking_url=?, landing_url=?, expires_at=?, verified=?, exclusive=?, priority=?, active=? WHERE id=?`,
      [...values, id],
    );
  } else {
    const r = await exec(
      `INSERT INTO coupons (store_id, type, title, description, code, discount_label, tracking_url, landing_url, expires_at, verified, exclusive, priority, active, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'manual')`,
      values,
    );
    id = r.insertId;
  }
  clearCache();
  return { id: id! };
}

/* ---------- Categorias ---------- */
export async function listCategories() {
  return query(`SELECT c.*, (SELECT COUNT(*) FROM store_categories sc WHERE sc.category_id = c.id) AS stores FROM categories c ORDER BY c.name`);
}

export async function saveCategory(id: number | null, form: FormData): Promise<{ id: number } | { error: string }> {
  const name = str(form.get('name'));
  if (!name) return { error: 'Informe o nome da categoria.' };
  const slug = slugify(str(form.get('slug')) || name);
  const dup = await query('SELECT id FROM categories WHERE slug = ? AND id <> ?', [slug, id ?? 0]);
  if (dup[0]) return { error: `Já existe a categoria /categoria/${slug}.` };
  if (id) await exec('UPDATE categories SET slug=?, name=?, intro=? WHERE id=?', [slug, name, nul(str(form.get('intro'))), id]);
  else id = (await exec('INSERT INTO categories (slug, name, intro) VALUES (?,?,?)', [slug, name, nul(str(form.get('intro')))])).insertId;
  clearCache();
  return { id: id! };
}
