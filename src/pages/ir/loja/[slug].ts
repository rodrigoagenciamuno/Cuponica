import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/data';
import { trackAndRedirect } from '../../../lib/redirect';

/** /ir/loja/{slug} → clique em "Ir para a loja" (sem cupom específico). */
export const GET: APIRoute = async (ctx) => {
  const store = await getStore(String(ctx.params.slug));
  if (!store) return ctx.redirect('/', 302);
  return trackAndRedirect(ctx, store);
};
