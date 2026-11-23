import { adminDenied } from "@/lib/admin";
import { htmlPage } from "@/lib/linkedin/debug-auth";
import { migrationConnection, runMigrations } from "@/lib/migrate";

/**
 * Applies db/migrations/*.sql against the deployment's own database, so the
 * connection string never has to leave Vercel. Every build already does this
 * (scripts/migrate-on-build.ts); this is the same run by hand, for a database
 * connected after the last deploy. Open to an admin session or ?k= with
 * LINKEDIN_DEBUG_SECRET.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);

  const denied = await adminDenied(url);
  if (denied) return htmlPage("Blocked", `<h1>Blocked</h1><p>${denied}</p>`);

  const connection = migrationConnection();
  if (!connection) {
    return htmlPage(
      "Not configured",
      "<h1>Not configured</h1><p>DATABASE_URL is not set on this deployment.</p>",
    );
  }

  const result = await runMigrations(connection);
  if (!result.ok) {
    return htmlPage(
      "Migration failed",
      `<h1>Migration failed</h1>
       <div class="row"><span>file</span><span>${result.file}</span></div>
       <div class="row"><span>error</span><span>${result.error.replace(/</g, "&lt;")}</span></div>
       <pre>${result.statement.slice(0, 800).replace(/</g, "&lt;")}</pre>`,
    );
  }

  return htmlPage(
    "Migrated",
    `<h1>Database is up.</h1>
     <div class="row"><span>migrations applied now</span><span>${result.applied.join(", ") || "none, already up to date"}</span></div>
     <div class="row"><span>tables</span><span class="ok">${result.tables.length}</span></div>
     ${result.tables.map((n) => `<div class="row"><span>${n}</span><span>ok</span></div>`).join("")}`,
  );
}
