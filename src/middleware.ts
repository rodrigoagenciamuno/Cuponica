import { defineMiddleware } from 'astro:middleware';
import { isAdmin } from './lib/auth';

export const onRequest = defineMiddleware(async (ctx, next) => {
  const url = ctx.url;
  const path = url.pathname;

  /* ---------- Painel admin: exige login ---------- */
  if (path === '/admin' || path.startsWith('/admin/')) {
    if (path !== '/admin/entrar' && !isAdmin(ctx.cookies)) {
      return ctx.redirect('/admin/entrar', 302);
    }
    const res = await next();
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return res;
  }

  /* ---------- Páginas públicas: guarda a origem do visitante ----------
     UTM e referrer externo ficam num cookie (sem JavaScript no navegador).
     Quando ele clicar em um cupom, o /ir/ grava essa origem junto com o clique. */
  const isPage = !path.startsWith('/ir/') && !path.startsWith('/api/') && !path.includes('.');
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

  // Rotas de API (crons, testes): nunca em cache, nem no CDN da Hostinger.
  if (path.startsWith('/api/')) response.headers.set('Cache-Control', 'no-store');

  if (isPage && response.headers.get('content-type')?.includes('text/html') && !response.headers.has('cache-control')) {
    response.headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  }
  return response;
});
