/**
 * The first half of `npm run build`. Brings the connected database up to the
 * migrations in this commit before Next builds, so a deploy never serves code
 * against tables that do not exist yet. With no database connected it says so
 * and lets the build go on: the site still renders, and sign in reports the
 * missing database on /api/admin/health.
 *
 * A failed migration fails the build. Vercel keeps the previous deployment
 * live, which is better than a new one that throws on every query.
 */
import { migrationConnection, runMigrations } from "../lib/migrate";

async function main() {
  const connection = migrationConnection();
  if (!connection) {
    console.log("migrate: no DATABASE_URL on this build, skipped");
    return;
  }
  const result = await runMigrations(connection);
  if (!result.ok) {
    console.error(`migrate: ${result.file} failed: ${result.error}`);
    console.error(result.statement.slice(0, 800));
    process.exit(1);
  }
  console.log(
    result.applied.length
      ? `migrate: applied ${result.applied.join(", ")}`
      : `migrate: up to date (${result.skipped} files)`,
  );
}

main().catch((cause) => {
  console.error("migrate:", cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
