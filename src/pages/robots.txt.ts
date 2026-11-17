import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const body = [
    'User-agent: *',
    'Allow: /',
    '# Links de saída com tracking não devem ser rastreados',
    'Disallow: /ir/',
    '',
    `Sitemap: ${new URL('/sitemap.xml', site).toString()}`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
