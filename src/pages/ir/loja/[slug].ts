import type { APIRoute } from 'astro';
import { getStore, getStoreCoupons } from '../../../lib/data';
import type { Coupon } from '../../../lib/data';
import { trackAndRedirect } from '../../../lib/redirect';

/** /ir/loja/{slug} → clique em "Ir para a loja" (sem cupom específico). */
export const GET: APIRoute = async (ctx) => {
  const store = await getStore(String(ctx.params.slug));
  if (!store) return ctx.redirect('/', 302);

  // Lojas criadas pelo sync da Rakuten chegam sem website_url. Sem ele não dá para montar o deeplink,
  // então usamos o link de afiliado de um cupom ativo da loja (a Rakuten leva para a loja do mesmo jeito).
  // O clique continua registrado como "loja", sem cupom.
  if (!store.website_url) {
    const withLink = (await getStoreCoupons(store.id)).find((c) => !c.expired && c.tracking_url);
    if (withLink) return trackAndRedirect(ctx, store, { tracking_url: withLink.tracking_url } as Coupon);
  }
  return trackAndRedirect(ctx, store);
};
