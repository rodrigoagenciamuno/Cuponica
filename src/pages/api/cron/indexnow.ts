import type { APIRoute } from 'astro';
import { cronAuthorized } from '../../../lib/auth';
import { getCategories, getStores } from '../../../lib/data';
import { pingIndexNow } from '../../../lib/indexnow';

/**
 * Envia todas as URLs públicas para o IndexNow (Bing, Yandex...).
 * Rodar uma vez depois do lançamento: /api/cron/indexnow?key=CRON_KEY
 * Depois disso, o sync de cupons e o admin avisam sozinhos as páginas que mudarem.
 */
export const GET: APIRoute = async ({ url }) => {
  if (!cronAuthorized(url)) return new Response('forbidden', { status: 403 });
  const [stores, categories] = await Promise.all([getStores(), getCategories()]);
  const paths = [
    '/', '/lojas', '/categorias', '/sobre', '/como-funciona', '/privacidade',
    ...stores.filter((s) => !s.demo).map((s) => `/cupom-desconto/${s.slug}`),
    ...categories.map((c) => `/categoria/${c.slug}`),
  ];
  return Response.json(await pingIndexNow(paths));
};
