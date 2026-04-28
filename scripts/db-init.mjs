// CLPNICE DB initializer
// Run with: npm run db:init
// Creates data/clpnice.db (SQLite) and applies all db/migrations/*.sqlite.sql in order.
// Idempotent: 이미 존재하는 컬럼/테이블 등 "duplicate" 류 오류는 안전하게 무시.

import { readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const dataDir = resolve(projectRoot, "data");
const dbPath = resolve(dataDir, "clpnice.db");
const migrationsDir = resolve(projectRoot, "db", "migrations");

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
  console.log(`[db-init] created ${dataDir}`);
}

const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sqlite.sql"))
  .sort();

if (migrationFiles.length === 0) {
  console.error("[db-init] no migration files found");
  process.exit(1);
}

const client = createClient({ url: `file:${dbPath.replaceAll("\\", "/")}` });
console.log(`[db-init] target db: ${dbPath}`);

/**
 * 멱등 가능 오류로 분류해 무시할 메시지 키워드
 * - "duplicate column"  : ALTER ADD COLUMN 시 이미 존재
 * - "already exists"    : CREATE TABLE/INDEX 등에서 충돌
 */
const IGNORABLE = ["duplicate column", "already exists"];

function isIgnorable(err) {
  const msg = String(err?.message ?? err).toLowerCase();
  return IGNORABLE.some((k) => msg.includes(k));
}

/**
 * SQL 텍스트를 ; 단위로 단순 분할.
 * 트리거 본문 안의 ; 는 BEGIN…END 블록을 보존하기 위해 별도 처리.
 */
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let inBeginEnd = 0; // BEGIN..END 깊이
  const tokens = sql.split(/(\bBEGIN\b|\bEND\b|;)/gi);
  for (const t of tokens) {
    if (!t) continue;
    const upper = t.toUpperCase();
    if (upper === "BEGIN") {
      inBeginEnd++;
      buf += t;
    } else if (upper === "END") {
      inBeginEnd = Math.max(0, inBeginEnd - 1);
      buf += t;
    } else if (t === ";" && inBeginEnd === 0) {
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = "";
    } else {
      buf += t;
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  // 주석만 남은 statement 제거 — 마지막 트레일러 코멘트가 SQLite 에 헛 실행되지 않도록
  return out.filter((stmt) => {
    const cleaned = stmt.replace(/--[^\n]*/g, "").trim();
    return cleaned.length > 0;
  });
}

try {
  for (const file of migrationFiles) {
    const fullPath = resolve(migrationsDir, file);
    const sql = readFileSync(fullPath, "utf8");
    console.log(`[db-init] applying: ${file}`);

    const statements = splitStatements(sql);
    for (const stmt of statements) {
      try {
        await client.execute(stmt);
      } catch (err) {
        if (isIgnorable(err)) {
          console.log(`  [skip] ${err.message ?? err}`);
        } else {
          console.error(`  [error] in ${file}:\n${stmt}\n→ ${err.message ?? err}`);
          throw err;
        }
      }
    }
  }

  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  console.log(`[db-init] tables: ${tables.rows.map((r) => r.name).join(", ")}`);

  // cargo_items 컬럼 점검 — 마이그레이션 적용 결과 확인
  const cols = await client.execute("PRAGMA table_info(cargo_items)");
  console.log(
    `[db-init] cargo_items columns: ${cols.rows.map((r) => r.name).join(", ")}`,
  );

  console.log("[db-init] done");
} catch (err) {
  console.error("[db-init] failed:", err);
  process.exit(1);
} finally {
  client.close();
}
