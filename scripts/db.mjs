#!/usr/bin/env node
/**
 * Local MySQL (MariaDB) control for development.
 *
 * The project targets MySQL 8 semantics; locally we run a portable MariaDB
 * server (wire-compatible, and what Prisma's `mysql` provider talks to) so the
 * schema and every query can be verified against a real server rather than a
 * SQLite stand-in.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TOOLS = process.env.NOVIRA_DB_HOME || path.resolve(ROOT, '..', '.tools');
const MARIA = path.join(TOOLS, 'mariadb-11.4.5-winx64');
const DATA = path.join(TOOLS, 'mysql-data');
const PORT = process.env.NOVIRA_DB_PORT || '3307';
const ROOT_PASS = process.env.NOVIRA_DB_PASSWORD || 'novira';
const DB_NAME = process.env.NOVIRA_DB_NAME || 'novira';

const bin = (name) => path.join(MARIA, 'bin', `${name}.exe`);

function client(sql, { db } = {}) {
  const args = ['-u', 'root', `-p${ROOT_PASS}`, '-h', '127.0.0.1', '-P', PORT];
  if (db) args.push(db);
  args.push('-e', sql);
  return spawnSync(bin('mariadb'), args, { encoding: 'utf8' });
}

function isUp() {
  const r = client('SELECT 1');
  return r.status === 0;
}

function start() {
  if (!existsSync(MARIA)) {
    console.error(`MariaDB not found at ${MARIA}.`);
    console.error('Download the portable winx64 zip from https://archive.mariadb.org and extract it there.');
    process.exit(1);
  }
  if (isUp()) {
    console.log(`MySQL already running on 127.0.0.1:${PORT}`);
    return ensureDatabase();
  }
  if (!existsSync(DATA)) {
    mkdirSync(DATA, { recursive: true });
    console.log('Initialising data directory…');
    const init = spawnSync(bin('mariadb-install-db'), [`--datadir=${DATA}`, `--password=${ROOT_PASS}`], {
      encoding: 'utf8',
    });
    if (init.status !== 0) {
      console.error(init.stderr || init.stdout);
      process.exit(1);
    }
  }
  const child = spawn(bin('mariadbd'), [`--datadir=${DATA}`, `--port=${PORT}`, '--bind-address=127.0.0.1'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  process.stdout.write('Starting MySQL');
  const deadline = Date.now() + 30_000;
  const tick = setInterval(() => {
    process.stdout.write('.');
    if (isUp()) {
      clearInterval(tick);
      console.log(`\nMySQL up on 127.0.0.1:${PORT}`);
      ensureDatabase();
    } else if (Date.now() > deadline) {
      clearInterval(tick);
      console.error('\nTimed out waiting for MySQL.');
      process.exit(1);
    }
  }, 1000);
}

function ensureDatabase() {
  const r = client(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
  );
  if (r.status !== 0) {
    console.error(r.stderr);
    process.exit(1);
  }
  console.log(`Database "${DB_NAME}" ready.`);
}

function stop() {
  const r = spawnSync(
    bin('mariadb-admin'),
    ['-u', 'root', `-p${ROOT_PASS}`, '-h', '127.0.0.1', '-P', PORT, 'shutdown'],
    { encoding: 'utf8' }
  );
  console.log(r.status === 0 ? 'MySQL stopped.' : (r.stderr || 'Not running.').trim());
}

function status() {
  if (!isUp()) return console.log(`MySQL is NOT running on 127.0.0.1:${PORT}`);
  const v = client('SELECT VERSION() AS version');
  const t = client(`SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema='${DB_NAME}'`);
  console.log(`MySQL up on 127.0.0.1:${PORT}`);
  console.log((v.stdout || '').trim());
  console.log((t.stdout || '').trim());
}

function sql() {
  const stmt = process.argv.slice(3).join(' ');
  if (!stmt) {
    console.error('Usage: npm run db:sql -- "SELECT 1"');
    process.exit(1);
  }
  const r = client(stmt, { db: DB_NAME });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  process.exit(r.status ?? 0);
}

const cmd = process.argv[2];
if (cmd === 'start') start();
else if (cmd === 'stop') stop();
else if (cmd === 'status') status();
else if (cmd === 'sql') sql();
else {
  console.log('Usage: node scripts/db.mjs <start|stop|status|sql>');
  process.exit(1);
}
