import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { assertSafeSeedTarget } from "../apps/api/src/services/seedSafety.js";
import { applyMigrationSql, identifyLegacyBaseline, migrationNames } from "./database-baseline.js";

const url = process.env.DATABASE_URL_UNPOOLED ?? "";
assertSafeSeedTarget(process.env.NODE_ENV, url);
const admin = new PrismaClient({ datasourceUrl: url });
const schema = `upgrade_${randomUUID().replaceAll("-", "")}`;
const scoped = new URL(url);
scoped.searchParams.set("schema", schema);
const legacy = new PrismaClient({ datasourceUrl: scoped.href });
const run = promisify(execFile);
const env = { ...process.env, DATABASE_URL: scoped.href, DATABASE_URL_UNPOOLED: scoped.href };
try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const names = await migrationNames();
  assert(names[0]);
  // Reproduce an existing pre-history installation with actual persisted scan data.
  await legacy.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await applyMigrationSql(tx, names[0]!);
      await tx.$executeRaw`INSERT INTO "Scan" ("id","repositoryName","branch","updatedAt") VALUES ('preserved-scan','synthetic/legacy','main',CURRENT_TIMESTAMP)`;
    },
    { timeout: 60000 },
  );
  const before = await legacy.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM "${schema}"."Scan" WHERE "id"='preserved-scan'`,
  );
  assert.equal(before.length, 1, "populated legacy row is required");
  assert.deepEqual(await identifyLegacyBaseline(legacy, schema), [names[0]]);
  await run(process.execPath, ["--import", "tsx", "scripts/baseline-database.ts", "--apply"], {
    env,
    maxBuffer: 1024 * 1024,
  });
  await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env,
    maxBuffer: 1024 * 1024,
  });
  assert.deepEqual(
    await legacy.$queryRawUnsafe(`SELECT * FROM "${schema}"."Scan" WHERE "id"='preserved-scan'`),
    before,
  );
  const applied = await legacy.$queryRawUnsafe<Array<{ migration_name: string }>>(
    `SELECT migration_name FROM "${schema}"."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
  );
  assert.deepEqual(
    applied.map((row) => row.migration_name),
    names,
  );
  await assert.rejects(identifyLegacyBaseline(legacy, schema), /history exists/);
  // An unknown column in a history-free installation must never be silently adopted.
  await legacy.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await legacy.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await applyMigrationSql(tx, names[0]!);
      await tx.$executeRaw`ALTER TABLE "Scan" ADD COLUMN "unexpected" TEXT`;
    },
    { timeout: 60000 },
  );
  await assert.rejects(identifyLegacyBaseline(legacy, schema), /does not match/);
  console.warn(
    "Populated legacy baseline plus incremental deploy passed; scan preserved and schema drift refused.",
  );
} finally {
  await legacy.$disconnect();
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
}
