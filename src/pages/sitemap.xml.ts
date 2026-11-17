import type { APIRoute } from 'astro';
import { getCategories, getStores } from '../lib/data';

/** Sitemap dinâmico: home, páginas fixas, todas as lojas ativas e categorias. */
export const GET: APIRoute = async ({ site }) => {
  const [stores, categories] = await Promise.all([getStores(), getCategories()]);
  const today = new Date().toISOString().slice(0, 10);
  const urls: { loc: string; priority: string; changefreq: string }[] = [
    { loc: '/', priority: '1.0', changefreq: 'daily' },
    { loc: '/lojas', priority: '0.8', changefreq: 'daily' },
    ...stores.map((s) => ({ loc: `/cupom-desconto/${s.slug}`, priority: s.featured ? '0.9' : '0.8', changefreq: 'daily' })),
    ...categories.map((c) => ({ loc: `/categoria/${c.slug}`, priority: '0.7', changefreq: 'daily' })),
    { loc: '/sobre', priority: '0.3', changefreq: 'monthly' },
    { loc: '/como-funciona', priority: '0.3', changefreq: 'monthly' },
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${new URL(u.loc, site).toString()}</loc><lastmod>${today}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
