import type { APIRoute } from 'astro';
import { cronAuthorized } from '../../../lib/auth';
import { hasDatabase } from '../../../lib/db';
import { logCronRun } from '../../../lib/cronlog';
import { syncConversions } from '../../../lib/rakuten';

/** Cron Job (hPanel): curl -s "https://cuponica.com.br/api/cron/sync-conversoes?key=CRON_KEY&dias=30" */
export const GET: APIRoute = async ({ url, request }) => {
  if (!cronAuthorized(url)) {
    // Registra tentativas com chave (errada) para mostrar no admin: é o erro mais comum ao configurar o cron.
    if (url.searchParams.has('key')) await logCronRun('sync-conversoes', false, 'chave errada', request);
    return new Response('forbidden', { status: 403 });
  }
  if (!hasDatabase()) return Response.json({ ok: false, error: 'Banco não configurado' }, { status: 500 });
  try {
    // A Events API aceita no máximo 30 dias de intervalo (e só guarda 1–2 semanas).
    const days = Math.min(Math.max(Number(url.searchParams.get('dias') || 7), 1), 30);
    const result = await syncConversions(days);
    console.log('[cron] sync-conversoes', result);
    await logCronRun('sync-conversoes', true, result, request);
    return Response.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[cron] sync-conversoes falhou', err);
    await logCronRun('sync-conversoes', false, String(err?.message || err), request);
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
};
