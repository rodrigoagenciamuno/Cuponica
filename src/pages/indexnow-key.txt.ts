import type { APIRoute } from 'astro';
import { indexNowKey } from '../lib/indexnow';

export const GET: APIRoute = () => {
  const key = indexNowKey();
  if (!key) return new Response('not configured', { status: 404 });
  return new Response(key, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
