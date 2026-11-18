import mysql from 'mysql2/promise';
import schemaSql from '../../sql/schema.sql?raw';

/**
 * Conexão MySQL. Só é criada quando DB_HOST e DB_NAME estão definidos.
 * Sem banco configurado, o site roda com os dados fictícios de src/data/demo.json.
 *
 * Na primeira consulta, as tabelas são criadas automaticamente (CREATE TABLE IF NOT EXISTS),
 * então não é preciso rodar nenhum comando no servidor.
 */
let pool: mysql.Pool | null = null;
let ready: Promise<void> | null = null;

/** Lê a primeira variável definida (aceita nomes alternativos que painéis de hospedagem costumam usar). */
const env = (...names: string[]) => names.map((n) => process.env[n]).find((v) => v != null && v !== '');
const cfg = () => {
  const urlStr = env('DATABASE_URL', 'MYSQL_URL');
  if (urlStr) {
    const u = new URL(urlStr);
    return {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  }
  return cfgVars();
};
const cfgVars = () => ({
  host: env('DB_HOST', 'MYSQL_HOST', 'DATABASE_HOST'),
  port: Number(env('DB_PORT', 'MYSQL_PORT', 'DATABASE_PORT') || 3306),
  user: env('DB_USER', 'DB_USERNAME', 'MYSQL_USER', 'DATABASE_USER'),
  password: env('DB_PASSWORD', 'DB_PASS', 'MYSQL_PASSWORD', 'DATABASE_PASSWORD'),
  database: env('DB_NAME', 'DB_DATABASE', 'MYSQL_DATABASE', 'DATABASE_NAME'),
});

export function hasDatabase(): boolean {
  const c = cfg();
  return Boolean(c.host && c.database);
}

function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      ...cfg(),
      connectionLimit: 5,
      timezone: 'Z',
      charset: 'utf8mb4',
    });
    // Todas as datas do banco em UTC (CURRENT_TIMESTAMP inclusive).
    pool.pool.on('connection', (conn: any) => conn.query("SET time_zone = '+00:00'"));
  }
  return pool;
}

const BASE_CATEGORIES = [
  ['moda', 'Moda', 'Cupons de desconto em roupas, calçados e acessórios.'],
  ['eletronicos', 'Eletrônicos', 'Cupons para celulares, notebooks, games e tecnologia.'],
  ['casa', 'Casa e Decoração', 'Descontos em móveis, decoração e utilidades domésticas.'],
  ['beleza', 'Beleza e Saúde', 'Cupons de perfumaria, cosméticos e farmácia.'],
  ['viagens', 'Viagens', 'Cupons de hotéis, passagens e pacotes de viagem.'],
  ['esportes', 'Esportes', 'Cupons de artigos esportivos e suplementos.'],
];

async function migrate(): Promise<void> {
  const p = getPool();
  const statements = schemaSql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
  for (const sql of statements) await p.query(sql);
  // Colunas adicionadas depois da primeira versão (CREATE TABLE IF NOT EXISTS não altera tabela existente).
  const [cols] = await p.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores'",
  );
  const have = new Set((cols as any[]).map((c) => c.COLUMN_NAME));
  if (!have.has('brand_color')) await p.query('ALTER TABLE stores ADD COLUMN brand_color VARCHAR(9) NULL AFTER logo_url');
  const [rows] = await p.query('SELECT COUNT(*) AS n FROM categories');
  if (Number((rows as any)[0].n) === 0) {
    for (const [slug, name, intro] of BASE_CATEGORIES) {
      await p.query('INSERT INTO categories (slug, name, intro) VALUES (?,?,?)', [slug, name, intro]);
    }
  }
  console.log('[db] schema verificado');
}

function ensureReady(): Promise<void> {
  if (!ready) {
    ready = migrate().catch((err) => {
      ready = null; // tenta de novo na próxima consulta
      throw err;
    });
  }
  return ready;
}

export async function query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ensureReady();
  const [rows] = await getPool().query(sql, params);
  return rows as T[];
}

/** Para INSERT/UPDATE/DELETE: retorna insertId e affectedRows. */
export async function exec(sql: string, params: unknown[] = []): Promise<{ insertId: number; affectedRows: number }> {
  await ensureReady();
  const [res] = await getPool().query(sql, params);
  const r = res as mysql.ResultSetHeader;
  return { insertId: r.insertId, affectedRows: r.affectedRows };
}
