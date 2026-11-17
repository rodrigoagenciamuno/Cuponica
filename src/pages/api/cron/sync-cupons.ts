import type { APIRoute } from 'astro';
import { cronAuthorized } from '../../../lib/auth';
import { hasDatabase } from '../../../lib/db';
import { syncCoupons } from '../../../lib/rakuten';

/** Cron Job (hPanel): curl -s "https://cuponica.com.br/api/cron/sync-cupons?key=CRON_KEY" */
export const GET: APIRoute = async ({ url }) => {
  if (!cronAuthorized(url)) return new Response('forbidden', { status: 403 });
  if (!hasDatabase()) return Response.json({ ok: false, error: 'Banco não configurado' }, { status: 500 });
  try {
    const result = await syncCoupons();
    console.log('[cron] sync-cupons', result);
    return Response.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[cron] sync-cupons falhou', err);
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
};
