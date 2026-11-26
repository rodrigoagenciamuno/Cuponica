import { exec, hasDatabase, query } from './db';

/** Grava uma execução de cron (ou tentativa com chave errada). Nunca derruba o cron se falhar. */
export async function logCronRun(job: string, ok: boolean, summary: unknown, request?: Request): Promise<void> {
  if (!hasDatabase()) return;
  try {
    const text = typeof summary === 'string' ? summary : JSON.stringify(summary);
    await exec('INSERT INTO cron_runs (job, ok, summary, user_agent) VALUES (?,?,?,?)', [
      job,
      ok ? 1 : 0,
      (text || '').slice(0, 1000),
      (request?.headers.get('user-agent') || '').slice(0, 200) || null,
    ]);
    // Guarda só os últimos 30 dias.
    await exec('DELETE FROM cron_runs WHERE created_at < UTC_TIMESTAMP() - INTERVAL 30 DAY');
  } catch (err) {
    console.error('[cron] não consegui registrar a execução', err);
  }
}

/** Últimas execuções de cada cron, para o Resumo do admin. */
export async function lastCronRuns() {
  const jobs = ['sync-cupons', 'sync-conversoes'];
  const out: Record<string, { last: any | null; lastOk: any | null; runs24h: number; badKey24h: number }> = {};
  for (const job of jobs) {
    const [last] = await query('SELECT * FROM cron_runs WHERE job = ? ORDER BY id DESC LIMIT 1', [job]);
    const [lastOk] = await query('SELECT * FROM cron_runs WHERE job = ? AND ok = 1 ORDER BY id DESC LIMIT 1', [job]);
    const [c] = await query(
      `SELECT SUM(ok = 1) AS runs, SUM(ok = 0 AND summary = 'chave errada') AS bad
       FROM cron_runs WHERE job = ? AND created_at > UTC_TIMESTAMP() - INTERVAL 1 DAY`,
      [job],
    );
    out[job] = { last: last ?? null, lastOk: lastOk ?? null, runs24h: Number(c?.runs || 0), badKey24h: Number(c?.bad || 0) };
  }
  return out;
}
