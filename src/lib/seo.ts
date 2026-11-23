export function breadcrumbSchema(site: URL, items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: new URL(it.path, site).toString(),
    })),
  };
}

export function faqSchema(faq: { q: string; a: string }[]) {
  if (!faq.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/** Mês e ano atuais em português, para títulos como "Cupom X — Novembro 2026". */
export function monthYear(date = new Date()): string {
  const m = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'America/Sao_Paulo' }).format(date);
  return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${date.getFullYear()}`;
}

/* ---------- Configuração de marketing (tudo por variável de ambiente, sem novo deploy) ---------- */
export function siteConfig() {
  const clean = (v?: string) => (v && v.trim() ? v.trim() : null);
  return {
    /** Google Tag Manager (GTM-XXXXXXX). GA4, Google Ads e outros pixels são configurados dentro do GTM. */
    gtmId: clean(process.env.GTM_ID),
    /** Search Console: só o valor de content da meta google-site-verification. */
    googleVerification: clean(process.env.GOOGLE_SITE_VERIFICATION),
    /** Bing Webmaster Tools: valor de content da meta msvalidate.01. */
    bingVerification: clean(process.env.BING_SITE_VERIFICATION),
    /** Perfis oficiais (Instagram, TikTok, LinkedIn...), separados por vírgula. Entram no schema Organization (sameAs). */
    socials: (process.env.SOCIAL_LINKS || '').split(',').map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s)),
    contactEmail: clean(process.env.CONTACT_EMAIL),
  };
}

export function organizationSchema(site: URL) {
  const cfg = siteConfig();
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': new URL('/#organization', site).toString(),
    name: 'Cuponica',
    url: site.toString(),
    logo: { '@type': 'ImageObject', url: new URL('/logo-512.png', site).toString(), width: 512, height: 512 },
    description: 'Site brasileiro de cupons de desconto e ofertas verificadas das principais lojas online.',
    areaServed: { '@type': 'Country', name: 'Brasil' },
    knowsLanguage: 'pt-BR',
    ...(cfg.socials.length ? { sameAs: cfg.socials } : {}),
    ...(cfg.contactEmail ? { contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: cfg.contactEmail, availableLanguage: 'Portuguese' } } : {}),
  };
}

type OfferInput = {
  id: number; title: string; description?: string | null; code?: string | null; type: 'code' | 'deal';
  expires_at: Date | null; discount_label?: string | null;
};

/**
 * Cupons como lista de ofertas (schema.org não tem tipo "Coupon").
 * O Google não mostra rich result para isso, mas buscadores e IAs leem a lista para entender a página.
 */
export function couponListSchema(site: URL, pagePath: string, storeName: string, coupons: OfferInput[]) {
  if (!coupons.length) return null;
  const page = new URL(pagePath, site).toString();
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Cupons de desconto ${storeName}`,
    numberOfItems: coupons.length,
    itemListElement: coupons.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Offer',
        '@id': `${page}#cupom-${c.id}`,
        url: `${page}#cupom-${c.id}`,
        name: c.title,
        ...(c.description ? { description: c.description } : {}),
        category: c.type === 'code' ? 'Cupom de desconto' : 'Oferta',
        ...(c.discount_label ? { disambiguatingDescription: c.discount_label } : {}),
        ...(c.expires_at ? { validThrough: c.expires_at.toISOString() } : {}),
        availability: 'https://schema.org/InStock',
        offeredBy: { '@type': 'Organization', name: storeName },
      },
    })),
  };
}

/** WebPage com data de atualização: sinal de frescor para Google e IAs. */
export function webPageSchema(site: URL, path: string, name: string, description: string, modified: Date) {
  const url = new URL(path, site).toString();
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': url,
    url,
    name,
    description,
    inLanguage: 'pt-BR',
    dateModified: modified.toISOString(),
    isPartOf: { '@type': 'WebSite', name: 'Cuponica', url: site.toString() },
    publisher: { '@id': new URL('/#organization', site).toString() },
  };
}

/**
 * Perguntas frequentes padrão de uma loja, montadas só com dados reais da página
 * (quantidade de cupons, melhor desconto, validade). Usadas quando o admin não escreveu um FAQ próprio.
 */
export function defaultStoreFaq(
  storeName: string,
  active: { type: 'code' | 'deal'; discount_label?: string | null; expires_at: Date | null }[],
  when = new Date(),
): { q: string; a: string }[] {
  const codes = active.filter((c) => c.type === 'code').length;
  const deals = active.length - codes;
  const best = active.find((c) => c.discount_label)?.discount_label;
  const fmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  const today = fmt.format(when);
  const faq: { q: string; a: string }[] = [];

  faq.push({
    q: `Tem cupom de desconto ${storeName} válido hoje?`,
    a: active.length
      ? `Sim. Em ${today}, a Cuponica tem ${active.length} ${active.length === 1 ? 'oferta ativa' : 'ofertas ativas'} da ${storeName}${codes ? `, sendo ${codes} com código de cupom` : ''}${deals && codes ? ` e ${deals} sem código` : ''}.`
      : `Em ${today} não há cupom ativo da ${storeName} na Cuponica. A página é atualizada várias vezes por dia; volte em breve ou veja cupons de lojas parecidas.`,
  });
  if (best) {
    faq.push({ q: `Qual o maior desconto da ${storeName} agora?`, a: `O melhor desconto ativo na Cuponica hoje é ${best}. As condições (valor mínimo, produtos válidos) aparecem em cada cupom.` });
  }
  faq.push({
    q: `Como usar o cupom ${storeName}?`,
    a: `Clique em "Pegar cupom". A loja abre em uma nova aba e o código aparece aqui, já copiado. Monte o carrinho na ${storeName}, cole o código no campo de cupom e confira o desconto antes de pagar.`,
  });
  faq.push({
    q: `Por que o cupom ${storeName} não funcionou?`,
    a: `Os motivos mais comuns são: o pedido não atingiu o valor mínimo, o produto está fora da promoção, o cupom já expirou ou é válido só na primeira compra ou no app. Confira as regras do cupom e tente outro da lista.`,
  });
  faq.push({
    q: `Usar cupom pela Cuponica custa alguma coisa?`,
    a: `Não. A Cuponica é gratuita e não pede cadastro. Quando você compra pelos nossos links, a ${storeName} pode nos pagar uma comissão, sem mudar o preço que você paga.`,
  });
  return faq;
}

/** Lista de lojas (home, categoria, /lojas) como ItemList de páginas da Cuponica. */
export function storeListSchema(site: URL, name: string, stores: { slug: string; name: string }[]) {
  if (!stores.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: stores.length,
    itemListElement: stores.slice(0, 100).map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: `Cupom de desconto ${s.name}`,
      url: new URL(`/cupom-desconto/${s.slug}`, site).toString(),
    })),
  };
}
