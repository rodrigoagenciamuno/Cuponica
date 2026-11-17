# Cuponica

Plataforma de cupons de desconto integrada à Rakuten Advertising.
Astro (HTML renderizado no servidor, quase sem JavaScript) + Node.js + MySQL, hospedada como app Node.js na Hostinger.

## Como está organizado

| Caminho | O que é |
|---|---|
| `src/pages/index.astro` | Home |
| `src/pages/cupom-desconto/[loja].astro` | Página de cada loja (a principal para SEO). URL fixa, nunca muda. |
| `src/pages/categoria/[slug].astro` | Página de categoria |
| `src/pages/lojas.astro` | Lojas de A a Z |
| `src/pages/ir/[id].ts` | **Tracking**: registra o clique e redireciona para o link de afiliado com `u1 = click_id` |
| `src/pages/ir/loja/[slug].ts` | Mesmo fluxo para o botão "Ir para a loja" |
| `src/middleware.ts` | Guarda UTM e referrer de quem chega (cookie), para gravar junto com o clique |
| `src/pages/robots.txt.ts`, `sitemap.xml.ts` | Robots (bloqueia `/ir/`) e sitemap dinâmico |
| `sql/schema.sql` | Tabelas: lojas, categorias, cupons, cliques, conversões |
| `scripts/sync-rakuten.mjs` | Importa cupons da API da Rakuten (Cron) |
| `scripts/sync-conversoes.mjs` | Importa vendas/comissões e liga ao clique pelo `u1` (Cron) |
| `src/data/demo.json` | Dados **fictícios**, usados enquanto o MySQL não está configurado |

## Hostinger (app Node.js)

- **Comando de build:** `npm run build`
- **Arquivo/Comando de início:** `npm start` (executa `dist/server/entry.mjs`)
- **Node.js:** 22.x ou 24.x
- **Variáveis de ambiente:** ver `.env.example`

Depois de criar o banco MySQL no hPanel e cadastrar as variáveis, rodar uma vez:

```
npm run db:migrate            # cria as tabelas
npm run db:migrate -- --demo  # opcional: carrega os dados fictícios
```

Cron Jobs sugeridos (hPanel):

```
0 */2 * * *   npm run sync:cupons                 # cupons a cada 2 horas
30 4 * * *    node scripts/sync-conversoes.mjs 30 # conversões 1x por dia
```

## Regras de SEO e tracking

- Todo link de saída passa por `/ir/…` com `rel="sponsored nofollow"`; `/ir/` está bloqueado no robots e responde com `X-Robots-Tag: noindex`.
- Cupom expirado continua na página da loja, marcado como expirado (nunca vira 404).
- Cada página tem canonical, Open Graph e JSON-LD (Organization, BreadcrumbList, FAQPage).
- IP dos cliques é guardado só como hash (LGPD).
