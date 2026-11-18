import demo from '../data/demo.json';
import { exec, query } from './db';
import { clearCache, demoExpiry } from './data';

/**
 * Carrega no banco as lojas e cupons fictícios de src/data/demo.json (network = demo).
 * Não mexe em lojas reais. Rodar de novo atualiza as lojas e recria os cupons de demonstração
 * com as datas de validade recalculadas a partir de hoje.
 */
export async function seedDemo(): Promise<{ stores: number; coupons: number }> {
  const catRows = await query<{ id: number; slug: string }>('SELECT id, slug FROM categories');
  const catBySlug = new Map(catRows.map((c) => [c.slug, Number(c.id)]));
  const demoCatSlug = new Map(demo.categories.map((c) => [c.id, c.slug]));
  // Garante as categorias usadas pelas lojas de demonstração.
  for (const c of demo.categories) {
    if (!catBySlug.has(c.slug)) {
      const r = await exec('INSERT INTO categories (slug, name, intro) VALUES (?,?,?)', [c.slug, c.name, c.intro]);
      catBySlug.set(c.slug, r.insertId);
    }
  }

  let coupons = 0;
  for (const s of demo.stores as any[]) {
    const existing = await query('SELECT id, network FROM stores WHERE slug = ?', [s.slug]);
    if (existing[0] && existing[0].network !== 'demo') continue; // nunca sobrescreve uma loja real
    let storeId: number;
    const values = [s.name, s.website_url, s.network_mid, s.brand_color, s.intro, s.about, JSON.stringify(s.faq), s.featured ? 1 : 0];
    if (existing[0]) {
      storeId = Number(existing[0].id);
      await exec(
        "UPDATE stores SET name=?, website_url=?, network='demo', network_mid=?, brand_color=?, intro=?, about=?, faq_json=?, featured=?, active=1 WHERE id=?",
        [...values, storeId],
      );
    } else {
      const r = await exec(
        "INSERT INTO stores (name, website_url, network, network_mid, brand_color, intro, about, faq_json, featured, slug) VALUES (?,?,'demo',?,?,?,?,?,?,?)",
        [...values, s.slug],
      );
      storeId = r.insertId;
    }
    await exec('DELETE FROM store_categories WHERE store_id = ?', [storeId]);
    for (const cid of s.categories as number[]) {
      const catId = catBySlug.get(demoCatSlug.get(cid) || '');
      if (catId) await exec('INSERT IGNORE INTO store_categories (store_id, category_id) VALUES (?,?)', [storeId, catId]);
    }
    await exec("DELETE FROM coupons WHERE store_id = ? AND source = 'demo'", [storeId]);
    for (const c of (demo.coupons as any[]).filter((c) => c.store_id === s.id)) {
      await exec(
        `INSERT INTO coupons (store_id, source, external_id, type, title, description, code, discount_label, expires_at, verified, exclusive, priority)
         VALUES (?, 'demo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [storeId, `demo-${c.id}`, c.type, c.title, c.description, c.code, c.discount_label, demoExpiry(c.expires_in_days), c.verified, c.exclusive, c.priority],
      );
      coupons++;
    }
  }
  clearCache();
  return { stores: demo.stores.length, coupons };
}

/** Remove todas as lojas de demonstração (e, em cascata, seus cupons). */
export async function removeDemo(): Promise<number> {
  const r = await exec("DELETE FROM stores WHERE network = 'demo'");
  clearCache();
  return r.affectedRows;
}

export async function demoCount(): Promise<number> {
  const rows = await query("SELECT COUNT(*) AS n FROM stores WHERE network = 'demo'");
  return Number(rows[0]?.n || 0);
}
