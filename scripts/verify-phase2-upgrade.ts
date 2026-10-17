import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertSafeSeedTarget } from "../apps/api/src/services/seedSafety.js";
import { migrationNames } from "./database-baseline.js";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? "";
assertSafeSeedTarget(process.env.NODE_ENV, databaseUrl);
assert.equal(process.env.AGENTSHIELD_DISPOSABLE_DATABASE, "true");
const run = promisify(execFile);
const root = process.cwd();
const admin = new PrismaClient({ datasourceUrl: databaseUrl });
const all = await migrationNames();
const integrity = "20261006000000_backend_integrity";
const common = all.filter((name) => name < integrity);
const phase3 = ["20261007000000_github_lifecycle", "20261007010000_github_check_ids"];
const histories = [
  {
    name: "accepted_phase1",
    migrations: all.filter(
      (name) =>
        name !== integrity &&
        !phase3.includes(name) &&
        name <= "20261015190000_scan_claim_sequence",
    ),
  },
  { name: "existing_phase2", migrations: [...common, integrity] },
  {
    name: "accepted_phase2",
    migrations: all.filter(
      (name) => !phase3.includes(name) && name <= "20261016200000_action_authority_admission",
    ),
  },
  { name: "existing_phase3", migrations: [...common, integrity, ...phase3] },
];
try {
  for (const history of histories) {
    const tag = randomUUID().replaceAll("-", "");
    const schema = `p2upgrade_${tag}`;
    const directory = await mkdtemp(path.join(tmpdir(), "agentshield-upgrade-"));
    const config = path.join(root, `.phase2-upgrade-${tag}.config.ts`);
    const scoped = new URL(databaseUrl);
    scoped.searchParams.set("schema", schema);
    const db = new PrismaClient({ datasourceUrl: scoped.href });
    const env = { ...process.env, DATABASE_URL: scoped.href, DATABASE_URL_UNPOOLED: scoped.href };
    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      for (const name of history.migrations) {
        const target = path.join(directory, name);
        await mkdir(target);
        await writeFile(
          path.join(target, "migration.sql"),
          await readFile(path.join(root, "prisma/migrations", name, "migration.sql")),
        );
      }
      await writeFile(path.join(directory, "migration_lock.toml"), 'provider = "postgresql"\n');
      await writeFile(
        config,
        `import { defineConfig, env } from "prisma/config";\nexport default defineConfig({ schema: ${JSON.stringify(path.join(root, "prisma/schema.prisma"))}, datasource: { url: env("DATABASE_URL_UNPOOLED") }, migrations: { path: ${JSON.stringify(directory)} } });\n`,
      );
      await run(
        process.execPath,
        ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", config],
        { env, maxBuffer: 1024 * 1024 },
      );
      await db.$executeRaw`INSERT INTO "Organization" ("id","slug","name","updatedAt") VALUES ('preserve-org','preserve-org','Upgrade preservation',CURRENT_TIMESTAMP)`;
      await db.$executeRaw`INSERT INTO "Repository" ("id","organizationId","provider","externalId","fullName","updatedAt") VALUES ('preserve-repo','preserve-org','LOCAL','1','synthetic/preserve',CURRENT_TIMESTAMP)`;
      await db.$executeRaw`INSERT INTO "AgentSession" ("id","organizationId","repositoryId","actor","source","taskSummary","correlationId") VALUES ('preserve-session','preserve-org','preserve-repo','synthetic-actor','test','Preserved session','preserve-session')`;
      await db.$executeRaw`INSERT INTO "Scan" ("id","organizationId","repositoryId","repositoryName","branch","status","updatedAt") VALUES ('preserve-scan','preserve-org','preserve-repo','synthetic/preserve','main','FAILED',CURRENT_TIMESTAMP)`;
      await db.$executeRaw`INSERT INTO "ScanJob" ("id","scanId","idempotencyKey","status","attempts","failureCode","failureMessage","correlationId","policyBundleVersion","repositoryRef","requester","nextAttemptAt","updatedAt") VALUES ('preserve-job','preserve-scan','preserve-job','FAILED',2,'HISTORICAL_FAILURE','Preserved synthetic failure','preserve-job','synthetic','main','synthetic-actor','2099-01-01',CURRENT_TIMESTAMP)`;
      await db.$executeRaw`INSERT INTO "AuditEvent" ("id","organizationId","scanId","actor","action","entityType","entityId") VALUES ('preserve-audit','preserve-org','preserve-scan','synthetic-actor','SCAN_CREATED','Scan','preserve-scan')`;
      if (history.name === "existing_phase2") {
        await db.$executeRaw`INSERT INTO "Scan" ("id","organizationId","repositoryName","branch","status","updatedAt") VALUES ('preserve-legacy-scan','preserve-org','agentshield-vulnerable-demo-target','main','QUEUED',CURRENT_TIMESTAMP)`;
        const payload = JSON.stringify({
          organizationId: "preserve-org",
          repositoryId: "local-demo",
          provider: "LOCAL",
          repositoryName: "agentshield-vulnerable-demo-target",
          ref: "main",
          policyBundleVersion: "demo",
          trigger: "MANUAL",
          requester: "synthetic-actor",
          correlationId: "legacy-demo",
        });
        await db.$executeRaw`INSERT INTO "ScanJob" ("id","scanId","idempotencyKey","status","policyBundleVersion","repositoryRef","requester","correlationId","payload","updatedAt") VALUES ('preserve-legacy-demo','preserve-legacy-scan','legacy-demo','QUEUED','demo','local-demo','synthetic-actor','legacy-demo',${payload}::jsonb,CURRENT_TIMESTAMP)`;
      }
      if (history.name === "existing_phase3") {
        await db.$executeRaw`INSERT INTO "Scan" ("id","organizationId","repositoryId","repositoryName","branch","status","updatedAt") VALUES ('preserve-pending-check','preserve-org','preserve-repo','synthetic/preserve','main','QUEUED',CURRENT_TIMESTAMP)`;
        await db.$executeRaw`INSERT INTO "GitHubCheckPublication" ("scanId","checkRunId","status","publishedState","updatedAt") VALUES ('preserve-scan','12000000001','COMPLETE','completed:FAILED',CURRENT_TIMESTAMP), ('preserve-pending-check',NULL,'PENDING',NULL,CURRENT_TIMESTAMP)`;
      }
      if (history.name === "accepted_phase2") {
        await db.$executeRaw`INSERT INTO "ActionAuthorization" ("id","organizationId","actor","sessionId","repositoryId","evidenceScanId","idempotencyKey","requestDigest","contextDigest","context","policyRevision","decision","status","expiresAt","reviewedBy","reviewedAt") VALUES ('preserve-authorization','preserve-org','synthetic-actor','preserve-session','preserve-repo','preserve-scan','preserve-key','request','context','{}'::jsonb,'old-policy','REQUIRE_APPROVAL','CONSUMED',CURRENT_TIMESTAMP,'independent-reviewer',CURRENT_TIMESTAMP)`;
        await db.$executeRaw`INSERT INTO "ActionOperation" ("id","organizationId","actor","authorizationId","operationKey","contextDigest") VALUES ('preserve-operation','preserve-org','synthetic-actor','preserve-authorization','preserve-operation','context')`;
        await db.$executeRaw`INSERT INTO "ActionOutbox" ("id","operationId") VALUES ('preserve-outbox','preserve-operation')`;
      }
      const tables = [
        "Organization",
        "Repository",
        "AgentSession",
        "Scan",
        "ScanJob",
        "AuditEvent",
        ...(history.name === "accepted_phase2"
          ? ["ActionAuthorization", "ActionOperation", "ActionOutbox"]
          : []),
      ];
      const before = await Promise.all(
        tables.map((table) =>
          db.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT * FROM "${table}" ORDER BY "id"`,
          ),
        ),
      );
      // Deploy the actual merged migration directory, including older missing migration IDs.
      await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
        env,
        maxBuffer: 1024 * 1024,
      });
      // New columns change SELECT * result types in PostgreSQL's cached plans.
      // Reconnect the rehearsal observer after DDL, as during the documented rollout.
      await db.$disconnect();
      for (let i = 0; i < tables.length; i++) {
        const after = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT * FROM "${tables[i]}" ORDER BY "id"`,
        );
        assert.equal(after.length, before[i]!.length);
        for (let row = 0; row < after.length; row++) {
          for (const [key, value] of Object.entries(before[i]![row]!))
            assert.deepEqual(
              after[row]![key],
              value,
              `${history.name}: ${tables[i]}.${key} changed`,
            );
        }
      }
      if (history.name === "existing_phase3") {
        const publications = await db.gitHubCheckPublication.findMany({
          orderBy: { scanId: "asc" },
        });
        assert.equal(publications.length, 2);
        const known = publications.find((row) => row.scanId === "preserve-scan")!;
        const unknown = publications.find((row) => row.scanId === "preserve-pending-check")!;
        assert.equal(known.checkRunId, "12000000001");
        assert.equal(
          known.status,
          "PENDING",
          "Legacy completed output must be requalified for coverage",
        );
        assert.equal(unknown.checkRunId, null);
        assert.equal(unknown.createMayHaveOccurred, true);
        assert.equal(unknown.lastOutcome, "UNKNOWN");
        assert(publications.every((row) => row.generation === 0 && row.leaseOwner == null));
      }
      await db.$executeRaw`INSERT INTO "Organization" ("id","slug","name","updatedAt") VALUES ('foreign-org','foreign-org','Foreign',CURRENT_TIMESTAMP)`;
      await assert.rejects(
        db.$executeRaw`INSERT INTO "Scan" ("id","repositoryId","organizationId","repositoryName","branch","updatedAt") VALUES ('foreign','preserve-repo','foreign-org','foreign','main',CURRENT_TIMESTAMP)`,
      );
      if (history.name === "existing_phase2") {
        const result = await run(
          process.execPath,
          ["--import", "tsx", "scripts/verify-upgraded-demo-job.ts"],
          {
            env: { ...env, RECEIPT_SIGNING_PRIVATE_KEY: "", RECEIPT_SIGNING_KEY_ID: "" },
            maxBuffer: 1024 * 1024,
          },
        );
        assert(result.stderr.includes("PASS parent-format demo executes"));
      }
      console.warn(
        `PASS populated ${history.name} -> integrated migration history; records preserved, foreign parent rejected.`,
      );
    } finally {
      await db.$disconnect();
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await rm(config, { force: true });
      await rm(directory, { recursive: true, force: true });
    }
  }
} finally {
  await admin.$disconnect();
}
