import type { APIRoute } from 'astro';
import { logout } from '../../lib/auth';

export const GET: APIRoute = ({ cookies, redirect }) => {
  logout(cookies);
  return redirect('/admin/entrar', 302);
};
