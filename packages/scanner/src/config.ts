import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

const CONFIG_MAX_BYTES = 64 * 1024;
const configSchema = z
  .object({
    ignorePaths: z.array(z.string().trim().min(1).max(256)).max(128).optional(),
  })
  .strict();

export interface RepositoryScanConfig {
  ignorePatterns: string[];
}

function parseIgnoreFile(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.replace(/^\/+/, ""))
    .filter((line) => line.length <= 256)
    .slice(0, 128);
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf8");
    if (Buffer.byteLength(content, "utf8") > CONFIG_MAX_BYTES) {
      throw new Error(`Scanner configuration exceeds ${CONFIG_MAX_BYTES} bytes.`);
    }
    return content;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function loadRepositoryScanConfig(targetPath: string): Promise<RepositoryScanConfig> {
  const rootPath = path.resolve(targetPath);
  const yamlText = await readOptionalFile(path.join(rootPath, ".agentshield.yml"));
  const ignoreText = await readOptionalFile(path.join(rootPath, ".agentshieldignore"));
  const yamlConfig = yamlText == null ? {} : configSchema.parse(YAML.parse(yamlText) ?? {});
  return {
    ignorePatterns: [
      ...(yamlConfig.ignorePaths ?? []),
      ...(ignoreText == null ? [] : parseIgnoreFile(ignoreText)),
    ],
  };
}
