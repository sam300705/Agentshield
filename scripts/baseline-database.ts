import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { identifyLegacyBaseline } from "./database-baseline.js";

if (process.argv.slice(2).join(" ") !== "--apply") {
  throw new Error(
    "Explicit --apply required. Back up and quiesce the target first; see docs/database-upgrades.md.",
  );
}
const databaseUrl = process.env.DATABASE_URL_UNPOOLED;
if (!databaseUrl) throw new Error("DATABASE_URL_UNPOOLED is required.");
const target = new URL(databaseUrl);
const schema = target.searchParams.get("schema") ?? "public";
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
try {
  const prefix = await identifyLegacyBaseline(prisma, schema);
  const execute = promisify(execFile);
  for (const name of prefix) {
    // Trusted Prisma receives the configured environment; URL/key values are not printed.
    try {
      await execute(
        process.execPath,
        ["node_modules/prisma/build/index.js", "migrate", "resolve", "--applied", name],
        { maxBuffer: 1024 * 1024 },
      );
    } catch {
      throw new Error(
        "Baseline history write failed. Inspect migrate status before retrying; do not reset data.",
      );
    }
  }
  console.warn(
    `Recorded verified baseline: ${prefix.join(", ")}. Run pnpm db:deploy for incremental migrations.`,
  );
} finally {
  await prisma.$disconnect();
}
