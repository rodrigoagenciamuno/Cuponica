import type { APIRoute } from 'astro';
import { cronAuthorized } from '../../../lib/auth';
import { hasDatabase } from '../../../lib/db';
import { logCronRun } from '../../../lib/cronlog';
import { syncCoupons, syncPartnerships } from '../../../lib/rakuten';
import { pingIndexNow } from '../../../lib/indexnow';

/**
 * Cron Job (hPanel): curl -s "https://cuponica.com.br/api/cron/sync-cupons?key=CRON_KEY"
 * Sincroniza as parcerias aprovadas (lojas) e depois o feed de cupons.
 */
export const GET: APIRoute = async ({ url, request }) => {
  if (!cronAuthorized(url)) {
    // Registra tentativas com chave (errada) para mostrar no admin: é o erro mais comum ao configurar o cron.
    if (url.searchParams.has('key')) await logCronRun('sync-cupons', false, 'chave errada', request);
    return new Response('forbidden', { status: 403 });
  }
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
    await logCronRun('sync-cupons', true, { partnerships, ...result }, request);
    return Response.json({ ok: true, partnerships, ...result });
  } catch (err: any) {
    console.error('[cron] sync-cupons falhou', err);
    await logCronRun('sync-cupons', false, String(err?.message || err), request);
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
};
