import { createHash } from 'node:crypto';

/**
 * IndexNow: avisa Bing (que alimenta o ChatGPT Search e o Copilot), Yandex, Seznam e Naver
 * na hora em que uma página muda, em vez de esperar o robô voltar.
 * A chave é derivada da CRON_KEY, então não precisa de variável nova. Ela fica pública em /indexnow-key.txt.
 */
export function indexNowKey(): string | null {
  const base = process.env.CRON_KEY;
  if (!base) return null;
  return createHash('sha256').update(`indexnow:${base}`).digest('hex').slice(0, 32);
}

export async function pingIndexNow(paths: string[]): Promise<{ sent: number; status?: number; error?: string }> {
  const key = indexNowKey();
  const site = process.env.SITE_URL || 'https://cuponica.com.br';
  const unique = [...new Set(paths)].slice(0, 10000);
  if (!key || unique.length === 0) return { sent: 0 };
  const host = new URL(site).host;
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key,
        keyLocation: new URL('/indexnow-key.txt', site).toString(),
        urlList: unique.map((p) => new URL(p, site).toString()),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return { sent: unique.length, status: res.status };
  } catch (e: any) {
    return { sent: 0, error: String(e?.message || e) };
  }
}
