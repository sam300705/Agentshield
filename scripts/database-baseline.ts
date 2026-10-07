import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import type { Prisma, PrismaClient } from "@prisma/client";

export async function migrationNames(): Promise<string[]> {
  return (await readdir(new URL("../prisma/migrations/", import.meta.url), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function applyMigrationSql(tx: Prisma.TransactionClient, name: string): Promise<void> {
  if (!(await migrationNames()).includes(name)) throw new Error("Unknown migration.");
  const sql = await readFile(
    new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
    "utf8",
  );
  // These committed migrations contain simple DDL only, with no procedural bodies.
  // Reference schemas are already created; never create or mutate public from the rehearsal.
  const scoped = sql.replace('CREATE SCHEMA IF NOT EXISTS "public";', "");
  for (const statement of scoped.split(";").filter((part) => part.trim())) {
    await tx.$executeRawUnsafe(statement);
  }
}

async function catalog(tx: Prisma.TransactionClient, schema: string): Promise<string> {
  const columns = await tx.$queryRaw`SELECT c.relname AS table_name, a.attname AS column_name,
    a.attnum AS position, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS required,
    pg_get_expr(d.adbin, d.adrelid) AS default_value
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname=${schema} AND c.relkind='r' AND c.relname <> '_prisma_migrations'
    ORDER BY c.relname, a.attnum`;
  const constraints = await tx.$queryRaw`SELECT c.relname AS table_name, k.conname AS name,
    pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k
    JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=${schema} AND c.relname <> '_prisma_migrations' ORDER BY c.relname,k.conname`;
  const indexes = await tx.$queryRaw`SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname=${schema} AND tablename <> '_prisma_migrations' ORDER BY tablename,indexname`;
  const enums = await tx.$queryRaw`SELECT t.typname AS name, e.enumlabel AS value FROM pg_type t
    JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid
    WHERE n.nspname=${schema} ORDER BY t.typname,e.enumsortorder`;
  const objects = await tx.$queryRaw`SELECT c.relname AS name,c.relkind AS kind,
    c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema}
    AND c.relkind IN ('r','v','m','S') AND c.relname <> '_prisma_migrations' ORDER BY c.relname`;
  const triggers = await tx.$queryRaw`SELECT c.relname AS table_name,t.tgname AS name,
    pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND NOT t.tgisinternal
    ORDER BY c.relname,t.tgname`;
  const policies =
    await tx.$queryRaw`SELECT tablename,policyname,permissive,roles,cmd,qual,with_check
    FROM pg_policies WHERE schemaname=${schema} ORDER BY tablename,policyname`;
  const routines =
    await tx.$queryRaw`SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=${schema}
    AND p.prokind IN ('f','p') ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)`;
  return JSON.stringify({
    columns,
    constraints,
    indexes,
    enums,
    objects,
    triggers,
    policies,
    routines,
  })
    .replaceAll(`\\"${schema}\\".`, "")
    .replaceAll(`${schema}.`, "");
}

// Rehearse each immutable migration prefix in a disposable schema. Only an exact
// catalog match permits recording that prefix; unknown drift never gets baselined.
export async function identifyLegacyBaseline(
  prisma: PrismaClient,
  schema = "public",
): Promise<string[]> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error("Unsupported baseline schema.");
  const names = await migrationNames();
  const reference = `baseline_${randomUUID().replaceAll("-", "")}`;
  return prisma.$transaction(
    async (tx) => {
      const history = await tx.$queryRaw<
        Array<{ present: string | null }>
      >`SELECT to_regclass(${`${schema}._prisma_migrations`})::text AS present`;
      if (history[0]?.present != null) {
        const rows = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS count FROM "${schema}"."_prisma_migrations"`,
        );
        if (rows[0]?.count !== 0n)
          throw new Error("Migration history exists; baseline refused. Inspect migrate status.");
      }
      const target = await catalog(tx, schema);
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${reference}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${reference}"`);
      const applied: string[] = [];
      let matched = false;
      for (const name of names) {
        await applyMigrationSql(tx, name);
        applied.push(name);
        if ((await catalog(tx, reference)) === target) {
          matched = true;
          break;
        }
      }
      await tx.$executeRawUnsafe(`DROP SCHEMA "${reference}" CASCADE`);
      if (!matched)
        throw new Error(
          "Existing schema does not match a committed migration prefix; no history changed.",
        );
      return applied;
    },
    { timeout: 60000 },
  );
}
