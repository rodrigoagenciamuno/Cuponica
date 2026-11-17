import type { APIRoute } from 'astro';
import { getCouponById, getStoreById } from '../../lib/data';
import { trackAndRedirect } from '../../lib/redirect';

/** /ir/{idDoCupom} → registra o clique e redireciona para o link de afiliado. */
export const GET: APIRoute = async (ctx) => {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return ctx.redirect('/', 302);

  const coupon = await getCouponById(id);
  if (!coupon) return ctx.redirect('/', 302);

  const store = await getStoreById(coupon.store_id);
  if (!store) return ctx.redirect('/', 302);

  return trackAndRedirect(ctx, store, coupon);
};
