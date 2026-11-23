import { Pool } from "@neondatabase/serverless";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Applies db/migrations/*.sql. Run by `npm run build` on every deploy, so a
 * new database is ready the first time it is connected and nobody opens a
 * secret URL. /api/admin/migrate calls the same function by hand.
 *
 * Statements are split on the drizzle-kit breakpoint marker, not on
 * semicolons, because a semicolon inside a string literal would cut a
 * statement in half. Each file is recorded in gs_meta.migration once it has
 * run, so a migration that drops or rewrites something runs once. The
 * schema sits outside public so drizzle-kit push never offers to drop it.
 *
 * v1 and v2 deploy from the same commit against one database, so two builds
 * can run this at the same moment. A session advisory lock makes the second
 * wait for the first and then find nothing left to do.
 */
export type MigrateResult =
  | { ok: true; applied: string[]; skipped: number; tables: string[] }
  | { ok: false; file: string; error: string; statement: string };

const LOCK_KEY = 7_204_311;

export function migrationConnection(): string | null {
  return process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || null;
}

export async function runMigrations(connection: string): Promise<MigrateResult> {
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  const pool = new Pool({ connectionString: connection });
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query("create schema if not exists gs_meta");
    await client.query(
      "create table if not exists gs_meta.migration (file text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set(
      (await client.query<{ file: string }>("select file from gs_meta.migration")).rows.map((r) => r.file),
    );

    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const body = await readFile(path.join(dir, file), "utf8");
      const statements = body
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const statement of statements) {
        try {
          await client.query(statement);
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : String(cause);
          // A database migrated by hand before this table existed re-runs its
          // files once. Objects that are already there are expected.
          if (!/already exists/i.test(error)) return { ok: false, file, error, statement };
        }
      }
      await client.query("insert into gs_meta.migration (file) values ($1) on conflict do nothing", [file]);
      applied.push(file);
    }

    const tables = (
      await client.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
      )
    ).rows.map((r) => r.table_name);
    return { ok: true, applied, skipped: done.size, tables };
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}
