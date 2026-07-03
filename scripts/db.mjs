// Local development PostgreSQL server (real Postgres binaries, no install).
// Usage: npm run db   — keep it running while using `npm run dev`.
// The app connects via DATABASE_URL in .env (localhost:5544, db "talaqi").
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "..", ".pgdata");
const firstRun = !existsSync(dataDir);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port: 5544,
  persistent: true,
});

if (firstRun) await pg.initialise();
await pg.start();
if (firstRun) await pg.createDatabase("talaqi");
console.log("✔ Postgres running at postgresql://postgres:postgres@localhost:5544/talaqi");
console.log("  Press Ctrl+C to stop.");

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    console.log("\nStopping Postgres…");
    await pg.stop();
    process.exit(0);
  });
}
