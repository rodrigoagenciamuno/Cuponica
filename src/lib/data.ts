import demo from '../data/demo.json';
import { hasDatabase, query } from './db';

export type Category = { id: number; slug: string; name: string; intro?: string | null };
export type Faq = { q: string; a: string };
export type Store = {
  id: number;
  slug: string;
  name: string;
  website_url: string;
  network: string;
  network_mid: string | null;
  logo_url?: string | null;
  /** Cor da marca (hex). Usada no topo da página da loja e no monograma quando não há logo. */
  brand_color?: string | null;
  intro?: string | null;
  about?: string | null;
  faq: Faq[];
  featured: boolean;
  categories: number[];
  active_coupons?: number;
  /** Maior desconto entre os cupons ativos (rótulo), quando houver. */
  best_label?: string | null;
  /** Loja fictícia de demonstração (network = demo). */
  demo: boolean;
};
export type Coupon = {
  id: number;
  store_id: number;
  type: 'code' | 'deal';
  title: string;
  description?: string | null;
  code?: string | null;
  discount_label?: string | null;
  tracking_url?: string | null;
  landing_url?: string | null;
  expires_at: Date | null;
  verified: boolean;
  exclusive: boolean;
  priority: number;
  expired: boolean;
};

/* ---------- cache em memória (evita bater no banco a cada visita) ---------- */
const TTL_MS = Number(process.env.CACHE_TTL_SECONDS || 300) * 1000;
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
export function clearCache() {
  cache.clear();
}

/* ---------- normalização ---------- */
/** Data de validade a partir de expires_in_days (dados de demonstração) ou expires_at. */
export function demoExpiry(days: number | null | undefined): Date | null {
  if (days == null) return null;
  // Dia de validade no horário de Brasília, terminando às 23h59.
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + days * 86400000));
  return new Date(`${key}T23:59:00-03:00`);
}
function toCoupon(r: any): Coupon {
  const expires = r.expires_at ? new Date(r.expires_at) : 'expires_in_days' in r ? demoExpiry(r.expires_in_days) : null;
  return {
    id: Number(r.id),
    store_id: Number(r.store_id),
    type: r.type === 'deal' ? 'deal' : 'code',
    title: r.title,
    description: r.description ?? null,
    code: r.code ?? null,
    discount_label: r.discount_label ?? null,
    tracking_url: r.tracking_url ?? null,
    landing_url: r.landing_url ?? null,
    expires_at: expires,
    verified: Boolean(r.verified),
    exclusive: Boolean(r.exclusive),
    priority: Number(r.priority || 0),
    expired: expires ? expires.getTime() < Date.now() : false,
  };
}
function toStore(r: any): Store {
  let faq: Faq[] = [];
  const rawFaq = r.faq ?? r.faq_json;
  if (Array.isArray(rawFaq)) faq = rawFaq;
  else if (typeof rawFaq === 'string') {
    try { faq = JSON.parse(rawFaq); } catch { faq = []; }
  }
  return {
    id: Number(r.id),
    slug: r.slug,
    name: r.name,
    website_url: r.website_url,
    network: r.network,
    network_mid: r.network_mid ?? null,
    logo_url: r.logo_url ?? null,
    brand_color: r.brand_color ?? null,
    intro: r.intro ?? null,
    about: r.about ?? null,
    faq,
    featured: Boolean(r.featured),
    categories: Array.isArray(r.categories)
      ? r.categories
      : String(r.category_ids || '').split(',').filter(Boolean).map(Number),
    active_coupons: r.active_coupons != null ? Number(r.active_coupons) : undefined,
    best_label: r.best_label ?? null,
    demo: r.network === 'demo',
  };
}
function sortCoupons(list: Coupon[]): Coupon[] {
  return list.sort((a, b) => {
    if (a.expired !== b.expired) return a.expired ? 1 : -1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.id - a.id;
  });
}

/* ---------- dados fictícios (sem banco) ---------- */
const demoStores = (): Store[] => (demo.stores as any[]).map(toStore);
const demoCoupons = (): Coupon[] => (demo.coupons as any[]).map(toCoupon);
function withCounts(stores: Store[], coupons: Coupon[]): Store[] {
  return stores.map((s) => {
    const mine = sortCoupons(coupons.filter((c) => c.store_id === s.id && !c.expired));
    return { ...s, active_coupons: mine.length, best_label: mine.find((c) => c.discount_label)?.discount_label ?? null };
  });
}

const STORE_SQL = `
  SELECT s.*, GROUP_CONCAT(DISTINCT sc.category_id) AS category_ids,
    (SELECT COUNT(*) FROM coupons c WHERE c.store_id = s.id AND c.active = 1
       AND (c.expires_at IS NULL OR c.expires_at > UTC_TIMESTAMP())) AS active_coupons,
    (SELECT c.discount_label FROM coupons c WHERE c.store_id = s.id AND c.active = 1 AND c.discount_label IS NOT NULL
       AND (c.expires_at IS NULL OR c.expires_at > UTC_TIMESTAMP()) ORDER BY c.priority DESC, c.id DESC LIMIT 1) AS best_label
  FROM stores s LEFT JOIN store_categories sc ON sc.store_id = s.id
  WHERE s.active = 1`;

/* ---------- API usada pelas páginas ---------- */
export function getStores(): Promise<Store[]> {
  return cached('stores', async () => {
    if (!hasDatabase()) return withCounts(demoStores(), demoCoupons());
    const rows = await query(`${STORE_SQL} GROUP BY s.id ORDER BY s.name`);
    return rows.map(toStore);
  });
}

export async function getStore(slug: string): Promise<Store | undefined> {
  return (await getStores()).find((s) => s.slug === slug);
}

export function getCategories(): Promise<Category[]> {
  return cached('categories', async () => {
    if (!hasDatabase()) return demo.categories as Category[];
    return query<Category>('SELECT id, slug, name, intro FROM categories ORDER BY name');
  });
}

export async function getCategory(slug: string): Promise<Category | undefined> {
  return (await getCategories()).find((c) => c.slug === slug);
}

export function getStoreCoupons(storeId: number): Promise<Coupon[]> {
  return cached(`coupons:${storeId}`, async () => {
    if (!hasDatabase()) return sortCoupons(demoCoupons().filter((c) => c.store_id === storeId));
    const rows = await query(
      'SELECT * FROM coupons WHERE store_id = ? AND active = 1 ORDER BY id DESC LIMIT 200',
      [storeId],
    );
    return sortCoupons(rows.map(toCoupon));
  });
}

/** Cupons em destaque para a home (somente válidos). */
export function getFeaturedCoupons(limit = 12): Promise<(Coupon & { store: Store })[]> {
  return cached(`featured:${limit}`, async () => {
    const stores = await getStores();
    let list: Coupon[];
    if (!hasDatabase()) list = demoCoupons();
    else {
      const rows = await query(
        `SELECT * FROM coupons WHERE active = 1
           AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
         ORDER BY priority DESC, id DESC LIMIT ?`,
        [limit * 2],
      );
      list = rows.map(toCoupon);
    }
    return sortCoupons(list.filter((c) => !c.expired))
      .map((c) => ({ ...c, store: stores.find((s) => s.id === c.store_id)! }))
      .filter((c) => c.store)
      .slice(0, limit);
  });
}

/** Busca um cupom pelo id (usado no redirect /ir/). Sem cache: precisa estar sempre correto. */
export async function getCouponById(id: number): Promise<Coupon | undefined> {
  if (!hasDatabase()) return demoCoupons().find((c) => c.id === id);
  const rows = await query('SELECT * FROM coupons WHERE id = ? LIMIT 1', [id]);
  return rows[0] ? toCoupon(rows[0]) : undefined;
}

export async function getStoreById(id: number): Promise<Store | undefined> {
  return (await getStores()).find((s) => s.id === id);
}

/** Busca simples por nome de loja (sem acento, sem diferenciar maiúsculas). */
export async function searchStores(q: string): Promise<Store[]> {
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const term = norm(q);
  if (!term) return [];
  const stores = await getStores();
  return stores
    .filter((s) => norm(s.name).includes(term) || norm(s.intro || '').includes(term))
    .sort((a, b) => Number(norm(b.name).startsWith(term)) - Number(norm(a.name).startsWith(term)));
}
