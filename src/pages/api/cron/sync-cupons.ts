import type { APIRoute } from 'astro';
import { cronAuthorized } from '../../../lib/auth';
import { hasDatabase } from '../../../lib/db';
import { syncCoupons, syncPartnerships } from '../../../lib/rakuten';
import { pingIndexNow } from '../../../lib/indexnow';

/**
 * Cron Job (hPanel): curl -s "https://cuponica.com.br/api/cron/sync-cupons?key=CRON_KEY"
 * Sincroniza as parcerias aprovadas (lojas) e depois o feed de cupons.
 */
export const GET: APIRoute = async ({ url }) => {
  if (!cronAuthorized(url)) return new Response('forbidden', { status: 403 });
  if (!hasDatabase()) return Response.json({ ok: false, error: 'Banco não configurado' }, { status: 500 });
  // Primeiro as parcerias (cria lojas de anunciantes aprovados, mesmo sem cupom). Se falhar, os cupons seguem.
  let partnerships: unknown;
  try {
    const p = await syncPartnerships();
    if (p.newSlugs.length) await pingIndexNow(['/', '/lojas', ...p.newSlugs.map((s) => `/cupom-desconto/${s}`)]);
    partnerships = p;
  } catch (err: any) {
    console.error('[cron] sync-parcerias falhou', err);
    partnerships = { error: String(err?.message || err) };
  }
  try {
    const result = await syncCoupons();
    console.log('[cron] sync-cupons', { partnerships, ...result });
    return Response.json({ ok: true, partnerships, ...result });
  } catch (err: any) {
    console.error('[cron] sync-cupons falhou', err);
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
};
