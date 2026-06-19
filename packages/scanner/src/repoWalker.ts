import { readdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export interface WalkRepositoryOptions {
  excludedDirectories?: ReadonlySet<string>;
}

export async function walkRepository(
  targetPath: string,
  options: WalkRepositoryOptions = {},
): Promise<string[]> {
  const rootPath = path.resolve(targetPath);
  const excludedDirectories = options.excludedDirectories ?? DEFAULT_EXCLUDED_DIRECTORIES;
  const files: string[] = [];

  async function visitDirectory(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath, {
      withFileTypes: true,
    });

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
          if (!excludedDirectories.has(entry.name)) {
            await visitDirectory(entryPath);
          }

          return;
        }

        if (entry.isFile()) {
          files.push(entryPath);
        }
      }),
    );
  }

  await visitDirectory(rootPath);

  return files.sort((left, right) => left.localeCompare(right));
}

