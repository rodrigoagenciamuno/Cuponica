// Utilitários compartilhados pelos scripts de linha de comando (migração e sincronização).
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';

/** Carrega variáveis de um arquivo .env local, se existir (na Hostinger elas vêm do painel). */
export function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export async function connect() {
  loadEnv();
  if (!process.env.DB_HOST || !process.env.DB_NAME) {
    throw new Error('Defina DB_HOST, DB_NAME, DB_USER e DB_PASSWORD (veja .env.example).');
  }
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
    timezone: 'Z',
    charset: 'utf8mb4',
  });
}

export function slugify(text) {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/**
 * Token de acesso da API Rakuten Advertising.
 * RAKUTEN_TOKEN_KEY = "Token Key" exibido no portal de desenvolvedores (já em base64).
 * RAKUTEN_SID       = ID do site (SID) do publisher.
 */
export async function rakutenToken() {
  loadEnv();
  const key = process.env.RAKUTEN_TOKEN_KEY;
  const sid = process.env.RAKUTEN_SID;
  if (!key || !sid) throw new Error('Defina RAKUTEN_TOKEN_KEY e RAKUTEN_SID (veja .env.example).');
  const res = await fetch('https://api.linksynergy.com/token', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ scope: sid }),
  });
  if (!res.ok) throw new Error(`Rakuten /token respondeu ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

export const log = (...a) => console.log(new Date().toISOString(), ...a);
