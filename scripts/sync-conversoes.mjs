// Importa vendas/comissões da Rakuten (Events/Transactions API) e liga cada uma ao clique pelo u1.
// Rodar via Cron Job do hPanel, por exemplo 1x por dia:
//   node scripts/sync-conversoes.mjs            (últimos 7 dias)
//   node scripts/sync-conversoes.mjs 30         (últimos 30 dias)
//
// ATENÇÃO: validar os nomes de campos com a primeira resposta real da API assim que as credenciais saírem.
import { connect, rakutenToken, log } from './lib.mjs';

const days = Number(process.argv[2] || 7);
const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 19).replace('T', ' ');

const db = await connect();
const token = await rakutenToken();
let page = 1, imported = 0;

while (true) {
  const params = new URLSearchParams({ transaction_date_start: since, limit: '1000', page: String(page) });
  const res = await fetch(`https://api.linksynergy.com/events/1.0/transactions?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Events API: ${res.status} ${await res.text()}`);
  const list = await res.json();
  if (!Array.isArray(list) || list.length === 0) break;

  for (const t of list) {
    const clickId = t.u1 ? String(t.u1).slice(0, 22) : null;
    const [store] = await db.query("SELECT id FROM stores WHERE network='rakuten' AND network_mid=?", [String(t.advertiser_id ?? '')]);
    await db.query(
      `INSERT INTO conversions (network, network_txn_id, click_id, store_id, order_amount, commission, currency, status, transaction_at, raw_json)
       VALUES ('rakuten', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE order_amount=VALUES(order_amount), commission=VALUES(commission), status=VALUES(status), raw_json=VALUES(raw_json)`,
      [
        String(t.etransaction_id ?? t.transaction_id),
        clickId,
        store[0]?.id ?? null,
        t.sale_amount ?? null,
        t.commissions ?? null,
        t.currency || 'BRL',
        Number(t.sale_amount) < 0 ? 'reversed' : 'pending',
        t.transaction_date ? new Date(t.transaction_date).toISOString().slice(0, 19).replace('T', ' ') : null,
        JSON.stringify(t),
      ],
    );
    imported++;
  }
  page++;
}

log(`Conversões importadas/atualizadas: ${imported}`);
await db.end();
