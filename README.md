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
| `src/pages/admin/` | Painel admin (`/admin`, protegido por `ADMIN_PASSWORD`): lojas, cupons, categorias e relatório de cliques |
| `src/pages/api/cron/` | Endpoints de sincronização com a Rakuten, chamados pelo Cron Job (protegidos por `CRON_KEY`) |
| `src/lib/rakuten.ts` | Integração Rakuten: cupons (Coupon Web Service) e vendas (Events API) |
| `sql/schema.sql` | Tabelas. São criadas automaticamente na primeira conexão com o banco. |
| `src/data/demo.json` | Dados **fictícios**, usados enquanto o MySQL não está configurado |

## Hostinger (app Node.js)

- **Build:** `npm run build` · **Início:** `npm start` · **Node.js:** 22.x ou 24.x
- **Variáveis de ambiente:** ver `.env.example`. As tabelas do banco são criadas sozinhas.
- Cada push no branch `main` gera um novo deploy automaticamente.

Cron Jobs (hPanel → Avançado → Cron Jobs), comando personalizado:

```
curl -s "https://cuponica.com.br/api/cron/sync-cupons?key=SUA_CRON_KEY"             # a cada 2 horas
curl -s "https://cuponica.com.br/api/cron/sync-conversoes?key=SUA_CRON_KEY&dias=30"  # 1x por dia
```

## Regras de SEO e tracking

- Todo link de saída passa por `/ir/…` com `rel="sponsored nofollow"`; `/ir/` está bloqueado no robots e responde com `X-Robots-Tag: noindex`.
- Cupom expirado continua na página da loja, marcado como expirado (nunca vira 404).
- Cada página tem canonical, Open Graph e JSON-LD (Organization, BreadcrumbList, FAQPage).
- IP dos cliques é guardado só como hash (LGPD).
