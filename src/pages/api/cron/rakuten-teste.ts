import type { APIRoute } from 'astro';
import { cronAuthorized } from '../../../lib/auth';
import { rakutenDiagnostics } from '../../../lib/rakuten';

/**
 * Teste da conexão com a Rakuten, sem gravar nada no banco:
 *   https://cuponica.com.br/api/cron/rakuten-teste?key=CRON_KEY
 * Mostra se o token funciona, as redes/categorias liberadas (o ID da rede Brasil vai em RAKUTEN_NETWORK)
 * e uma amostra crua do feed de cupons e da Events API.
 */
export const GET: APIRoute = async ({ url }) => {
  if (!cronAuthorized(url)) return new Response('forbidden', { status: 403 });
  try {
    const result = await rakutenDiagnostics();
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
};
