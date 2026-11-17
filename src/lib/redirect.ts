import type { APIContext } from 'astro';
import type { Coupon, Store } from './data';
import { buildAffiliateUrl, logClick, newClickId } from './tracking';

/** Fluxo comum de /ir/{cupom} e /ir/loja/{slug}: registra o clique e redireciona. */
export async function trackAndRedirect(ctx: APIContext, store: Store, coupon?: Coupon): Promise<Response> {
  const clickId = newClickId();

  let utm: { s?: string; m?: string; c?: string } = {};
  try { utm = JSON.parse(ctx.cookies.get('cp_utm')?.value || '{}'); } catch { utm = {}; }

  const referer = ctx.request.headers.get('referer');
  let pagePath: string | null = ctx.url.searchParams.get('p');
  if (!pagePath && referer) {
    try { pagePath = new URL(referer).pathname; } catch { pagePath = null; }
  }

  const target = buildAffiliateUrl(store, coupon, clickId);

  await logClick({
    clickId,
    store,
    coupon,
    pagePath,
    referrer: ctx.cookies.get('cp_ref')?.value ?? null,
    utm: { source: utm.s, medium: utm.m, campaign: utm.c },
    userAgent: ctx.request.headers.get('user-agent') || '',
    ip: ctx.clientAddress || '',
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer-when-downgrade',
    },
  });
}
