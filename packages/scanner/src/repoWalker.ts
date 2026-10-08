import { lstat, opendir, realpath } from "node:fs/promises";
import path from "node:path";

const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".tmp",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "node_modules.pnpm11",
]);

export interface WalkRepositoryOptions {
  excludedDirectories?: ReadonlySet<string>;
  ignorePatterns?: readonly string[];
  maxFiles?: number;
  maxFileSizeBytes?: number;
  maxTotalBytes?: number;
  signal?: AbortSignal;
}

export async function walkRepository(
  targetPath: string,
  options: WalkRepositoryOptions = {},
): Promise<string[]> {
  const rootPath = await realpath(path.resolve(targetPath));
  const excludedDirectories = options.excludedDirectories ?? DEFAULT_EXCLUDED_DIRECTORIES;
  const maxFiles = options.maxFiles ?? 10_000;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? 2 * 1024 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? 100 * 1024 * 1024;
  const files: string[] = [];
  let totalBytes = 0;

  function checkCancelled(): void {
    if (options.signal?.aborted === true) throw new Error("Scan cancelled");
  }

  function isIgnored(entryPath: string): boolean {
    const relative = path.relative(rootPath, entryPath).split(path.sep).join("/");
    return (
      options.ignorePatterns?.some(
        (pattern) => relative === pattern || relative.startsWith(`${pattern.replace(/\/$/, "")}/`),
      ) ?? false
    );
  }

  async function visitDirectory(directoryPath: string): Promise<void> {
    checkCancelled();
    const directory = await opendir(directoryPath);
    // Streaming sequential traversal bounds both buffered entries and filesystem work.
    for await (const entry of directory) {
      checkCancelled();
      const entryPath = path.join(directoryPath, entry.name);
      if (isIgnored(entryPath)) continue;
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) await visitDirectory(entryPath);
        continue;
      }
      if (entry.isFile()) {
        if (files.length >= maxFiles) throw new Error(`Scan exceeds file limit of ${maxFiles}`);
        const resolved = await realpath(entryPath);
        if (resolved !== rootPath && !resolved.startsWith(`${rootPath}${path.sep}`))
          throw new Error(`Path escaped scan root: ${entry.name}`);
        const stats = await lstat(resolved);
        if (stats.size > maxFileSizeBytes) continue;
        totalBytes += stats.size;
        if (totalBytes > maxTotalBytes)
          throw new Error(`Scan exceeds total byte limit of ${maxTotalBytes}`);
        files.push(entryPath);
      }
    }
  }

  await visitDirectory(rootPath);

  return files.sort((left, right) => left.localeCompare(right));
}
