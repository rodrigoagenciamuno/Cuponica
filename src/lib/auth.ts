import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';

const COOKIE = 'cp_admin';

function sessionToken(): string | null {
  const pwd = process.env.ADMIN_PASSWORD;
  if (!pwd) return null;
  return createHmac('sha256', pwd).update('cuponica-admin-v1').digest('base64url');
}

function same(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function isAdmin(cookies: AstroCookies): boolean {
  const token = sessionToken();
  const got = cookies.get(COOKIE)?.value;
  return Boolean(token && got && same(token, got));
}

export function login(cookies: AstroCookies, password: string, secure: boolean): boolean {
  const pwd = process.env.ADMIN_PASSWORD;
  if (!pwd || !same(pwd, password)) return false;
  cookies.set(COOKIE, sessionToken()!, { path: '/', httpOnly: true, sameSite: 'strict', secure, maxAge: 60 * 60 * 24 * 14 });
  return true;
}

export function logout(cookies: AstroCookies) {
  cookies.delete(COOKIE, { path: '/' });
}

/** Chave dos endpoints de cron: ?key=CRON_KEY */
export function cronAuthorized(url: URL): boolean {
  const key = process.env.CRON_KEY;
  const got = url.searchParams.get('key') || '';
  return Boolean(key && key.length >= 16 && same(key, got));
}
