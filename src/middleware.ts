import { defineMiddleware } from 'astro:middleware';

/**
 * Guarda a origem do visitante (UTM e referrer externo) em um cookie de sessão,
 * sem JavaScript no navegador. Quando ele clicar em um cupom, o /ir/ lê esse
 * cookie e grava a origem junto com o clique.
 */
export const onRequest = defineMiddleware(async (ctx, next) => {
  const url = ctx.url;
  const isPage = !url.pathname.startsWith('/ir/') && !url.pathname.includes('.');

  if (isPage) {
    const utm = {
      s: url.searchParams.get('utm_source'),
      m: url.searchParams.get('utm_medium'),
      c: url.searchParams.get('utm_campaign'),
    };
    if (utm.s || utm.m || utm.c) {
      ctx.cookies.set('cp_utm', JSON.stringify(utm), { path: '/', maxAge: 60 * 60 * 24 * 30, sameSite: 'lax', httpOnly: true });
    }
    const ref = ctx.request.headers.get('referer');
    if (ref && !ctx.cookies.has('cp_ref')) {
      try {
        const refHost = new URL(ref).host;
        if (refHost && refHost !== url.host) {
          ctx.cookies.set('cp_ref', ref.slice(0, 400), { path: '/', maxAge: 60 * 60 * 24 * 30, sameSite: 'lax', httpOnly: true });
        }
      } catch { /* referrer inválido: ignora */ }
    }
  }

  const response = await next();

  if (isPage && response.headers.get('content-type')?.includes('text/html') && !response.headers.has('cache-control')) {
    response.headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  }
  return response;
});
