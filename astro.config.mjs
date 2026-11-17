// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// URL pública do site. Usada em canonical, Open Graph e sitemap.
const SITE_URL = process.env.SITE_URL || 'https://cuponica.com.br';

export default defineConfig({
  site: SITE_URL,
  // Páginas renderizadas no servidor a cada acesso (com cache em memória),
  // para que cupons sincronizados da Rakuten apareçam sem precisar de novo build.
  // O HTML entregue é completo: nenhum conteúdo depende de JavaScript no navegador.
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  trailingSlash: 'never',
  build: { format: 'file' },
  compressHTML: true,
  prefetch: false,
  server: { host: true, port: Number(process.env.PORT) || 4321 },
});
