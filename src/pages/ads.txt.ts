import type { APIRoute } from 'astro';

/**
 * ads.txt para Google Ad Manager / AdSense. O conteúdo vem da variável ADS_TXT
 * (linhas separadas por "\n" ou ";"), ex.: "google.com, pub-1234567890, DIRECT, f08c47fec0942fa0".
 */
export const GET: APIRoute = () => {
  const raw = (process.env.ADS_TXT || '').replace(/\\n|;/g, '\n').trim();
  const body = raw ? `${raw}\n` : '# Nenhum vendedor de anúncios autorizado ainda.\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
