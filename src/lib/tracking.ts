import { createHash, randomBytes } from 'node:crypto';
import { hasDatabase, query } from './db';
import type { Coupon, Store } from './data';

/** click_id curto e único (22 caracteres, seguro para URL). Vai para a rede como sub-ID. */
export function newClickId(): string {
  return randomBytes(16).toString('base64url');
}

export function detectDevice(ua: string): string {
  if (!ua) return 'unknown';
  if (/bot|crawl|spider|slurp|facebookexternalhit|preview/i.test(ua)) return 'bot';
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (/mobi|android|iphone/i.test(ua)) return 'mobile';
  return 'desktop';
}

function hashIp(ip: string): string | null {
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT || 'cuponica';
  return createHash('sha256').update(salt + ip).digest('hex');
}

/**
 * Monta o link final de afiliado com o click_id como sub-ID.
 * Ordem de preferência:
 *  1. tracking_url do cupom (link que a Rakuten já entrega na API de cupons)
 *  2. deeplink Rakuten montado com o MID da loja + landing_url/website_url
 *  3. URL da loja sem tracking (último recurso, nunca deveria acontecer em produção)
 */
export function buildAffiliateUrl(store: Store, coupon: Coupon | undefined, clickId: string): string {
  const subIdParam = 'u1'; // parâmetro de sub-ID da Rakuten Advertising

  if (coupon?.tracking_url) {
    const url = new URL(coupon.tracking_url);
    url.searchParams.set(subIdParam, clickId);
    return url.toString();
  }

  const destination = coupon?.landing_url || store.website_url;
  const publisherId = process.env.RAKUTEN_PUBLISHER_ID;
  if (store.network === 'rakuten' && store.network_mid && publisherId) {
    const url = new URL('https://click.linksynergy.com/deeplink');
    url.searchParams.set('id', publisherId);
    url.searchParams.set('mid', store.network_mid);
    url.searchParams.set('murl', destination);
    url.searchParams.set(subIdParam, clickId);
    return url.toString();
  }

  return destination || '/';
}

export type ClickInfo = {
  clickId: string;
  store: Store;
  coupon?: Coupon;
  pagePath: string | null;
  referrer: string | null;
  utm: { source?: string | null; medium?: string | null; campaign?: string | null };
  userAgent: string;
  ip: string;
};

/** Grava o clique. Nunca deixa um erro de banco impedir o redirecionamento. */
export async function logClick(info: ClickInfo): Promise<void> {
  const device = detectDevice(info.userAgent);
  const row = [
    info.clickId,
    info.coupon?.id ?? null,
    info.store.id,
    info.pagePath?.slice(0, 500) ?? null,
    info.referrer?.slice(0, 500) ?? null,
    info.utm.source?.slice(0, 120) ?? null,
    info.utm.medium?.slice(0, 120) ?? null,
    info.utm.campaign?.slice(0, 160) ?? null,
    device,
    hashIp(info.ip),
    info.userAgent.slice(0, 400),
  ];
  if (!hasDatabase()) {
    console.log('[click]', JSON.stringify({ clickId: info.clickId, store: info.store.slug, coupon: info.coupon?.id, device, page: info.pagePath }));
    return;
  }
  try {
    await query(
      `INSERT INTO clicks (id, coupon_id, store_id, page_path, referrer, utm_source, utm_medium, utm_campaign, device, ip_hash, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row,
    );
  } catch (err) {
    console.error('[click] falha ao gravar', err);
  }
}
