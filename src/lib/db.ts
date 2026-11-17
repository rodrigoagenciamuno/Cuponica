import mysql from 'mysql2/promise';

/**
 * Conexão MySQL. Só é criada quando DB_HOST está definido.
 * Sem banco configurado, o site roda com os dados fictícios de src/data/demo.json.
 */
let pool: mysql.Pool | null = null;

export function hasDatabase(): boolean {
  return Boolean(process.env.DB_HOST && process.env.DB_NAME);
}

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectionLimit: 5,
      dateStrings: false,
      timezone: 'Z',
      charset: 'utf8mb4',
    });
  }
  return pool;
}

export async function query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await getPool().query(sql, params);
  return rows as T[];
}
