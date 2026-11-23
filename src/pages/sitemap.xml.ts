import type { APIRoute } from 'astro';
import { getCategories, getStores } from '../lib/data';

/**
 * Sitemap dinâmico. O lastmod de cada loja é a última mudança real nela ou nos cupons
 * (o Google usa o lastmod quando ele é confiável, e ignora changefreq/priority).
 */
export const GET: APIRoute = async ({ site }) => {
  const [stores, categories] = await Promise.all([getStores(), getCategories()]);
  const real = stores.filter((s) => !s.demo);
  const day = (d?: Date | null) => (d && !Number.isNaN(d.getTime()) ? d : new Date()).toISOString();
  const newest = real.reduce<Date | null>((m, s) => (s.updated_at && (!m || s.updated_at > m) ? s.updated_at : m), null);
  const urls: { loc: string; lastmod: string }[] = [
    { loc: '/', lastmod: day(newest) },
    { loc: '/lojas', lastmod: day(newest) },
    { loc: '/categorias', lastmod: day(newest) },
    ...real.map((s) => ({ loc: `/cupom-desconto/${s.slug}`, lastmod: day(s.updated_at) })),
    ...categories
      .filter((c) => real.some((s) => s.categories.includes(c.id)))
      .map((c) => {
        const mine = real.filter((s) => s.categories.includes(c.id));
        const last = mine.reduce<Date | null>((m, s) => (s.updated_at && (!m || s.updated_at > m) ? s.updated_at : m), null);
        return { loc: `/categoria/${c.slug}`, lastmod: day(last) };
      }),
    { loc: '/sobre', lastmod: '2026-11-23T00:00:00.000Z' },
    { loc: '/como-funciona', lastmod: '2026-11-23T00:00:00.000Z' },
    { loc: '/privacidade', lastmod: '2026-11-23T00:00:00.000Z' },
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${new URL(u.loc, site).toString()}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
};
