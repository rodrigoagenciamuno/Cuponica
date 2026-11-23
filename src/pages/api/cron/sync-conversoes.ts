import type { APIRoute } from 'astro';
import { cronAuthorized } from '../../../lib/auth';
import { hasDatabase } from '../../../lib/db';
import { syncConversions } from '../../../lib/rakuten';

/** Cron Job (hPanel): curl -s "https://cuponica.com.br/api/cron/sync-conversoes?key=CRON_KEY&dias=30" */
export const GET: APIRoute = async ({ url }) => {
  if (!cronAuthorized(url)) return new Response('forbidden', { status: 403 });
  if (!hasDatabase()) return Response.json({ ok: false, error: 'Banco não configurado' }, { status: 500 });
  try {
    // A Events API aceita no máximo 30 dias de intervalo (e só guarda 1–2 semanas).
    const days = Math.min(Math.max(Number(url.searchParams.get('dias') || 7), 1), 30);
    const result = await syncConversions(days);
    console.log('[cron] sync-conversoes', result);
    return Response.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[cron] sync-conversoes falhou', err);
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
};
