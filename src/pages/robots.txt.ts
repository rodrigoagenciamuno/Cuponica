import type { APIRoute } from 'astro';

/**
 * Robôs de busca e de IA são bem-vindos em todo o conteúdo público.
 * Cada grupo do robots.txt vale sozinho, então as áreas privadas se repetem em cada um.
 * Bloqueamos só: links de saída com tracking (/ir/), API, painel e resultados de busca interna.
 */
const PRIVATE = ['/ir/', '/api/', '/admin', '/busca'];

// Buscadores e assistentes de IA. Os de treinamento (GPTBot, Google-Extended, Applebot-Extended, CCBot)
// também ficam liberados: estar nos modelos ajuda a marca a ser lembrada nas respostas.
const AI_BOTS = [
  'OAI-SearchBot', 'ChatGPT-User', 'GPTBot',
  'Claude-SearchBot', 'Claude-User', 'ClaudeBot',
  'PerplexityBot', 'Perplexity-User',
  'Google-Extended', 'Applebot-Extended', 'Applebot',
  'Bingbot', 'DuckAssistBot', 'meta-externalagent', 'Amazonbot', 'CCBot', 'cohere-ai', 'MistralAI-User',
];

export const GET: APIRoute = ({ site }) => {
  const group = (agents: string[]) => [...agents.map((a) => `User-agent: ${a}`), 'Allow: /', ...PRIVATE.map((p) => `Disallow: ${p}`), ''];
  const body = [
    '# Cuponica: cupons de desconto verificados. Resumo para IAs: /llms.txt',
    '',
    ...group(['*']),
    ...group(AI_BOTS),
    `Sitemap: ${new URL('/sitemap.xml', site).toString()}`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
