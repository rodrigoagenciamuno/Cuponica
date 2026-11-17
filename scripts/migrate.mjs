// Cria as tabelas no MySQL. Com --demo, carrega também os dados fictícios de demonstração.
//   npm run db:migrate
//   npm run db:migrate -- --demo
import { readFileSync } from 'node:fs';
import { connect, log } from './lib.mjs';

const db = await connect();
await db.query(readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8'));
log('Tabelas criadas/atualizadas.');

if (process.argv.includes('--demo')) {
  const demo = JSON.parse(readFileSync(new URL('../src/data/demo.json', import.meta.url), 'utf8'));
  for (const c of demo.categories) {
    await db.query('INSERT INTO categories (id, slug, name, intro) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), intro=VALUES(intro)', [c.id, c.slug, c.name, c.intro]);
  }
  for (const s of demo.stores) {
    await db.query(
      `INSERT INTO stores (id, slug, name, website_url, network, network_mid, intro, about, faq_json, featured)
       VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)`,
      [s.id, s.slug, s.name, s.website_url, s.network, s.network_mid, s.intro, s.about, JSON.stringify(s.faq || []), s.featured],
    );
    for (const cid of s.categories) await db.query('INSERT IGNORE INTO store_categories VALUES (?,?)', [s.id, cid]);
  }
  for (const c of demo.coupons) {
    await db.query(
      `INSERT INTO coupons (id, store_id, source, external_id, type, title, description, code, discount_label, expires_at, verified, exclusive, priority)
       VALUES (?,?,'demo',?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title)`,
      [c.id, c.store_id, `demo-${c.id}`, c.type, c.title, c.description, c.code, c.discount_label, c.expires_at ? c.expires_at.replace('T', ' ') : null, c.verified, c.exclusive, c.priority],
    );
  }
  log('Dados de demonstração carregados.');
}

await db.end();
