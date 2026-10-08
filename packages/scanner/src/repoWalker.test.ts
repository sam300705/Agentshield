import { expect, it, vi } from "vitest";
const fs = vi.hoisted(() => ({ realpath: vi.fn(), lstat: vi.fn(), opendir: vi.fn() }));
vi.mock("node:fs/promises", () => fs);
import { walkRepository } from "./repoWalker.js";
it("stops scheduling filesystem work at the file budget with streaming directory iteration", async () => {
  let read = 0;
  let closed = false;
  fs.realpath.mockImplementation((value: string) => Promise.resolve(value));
  fs.lstat.mockResolvedValue({ size: 1 });
  fs.opendir.mockImplementation(() =>
    (async function* () {
      await Promise.resolve();
      try {
        for (let index = 0; index < 10000; index++) {
          read++;
          yield { name: `file-${index}`, isDirectory: () => false, isFile: () => true };
        }
      } finally {
        closed = true;
      }
    })(),
  );
  await expect(walkRepository("/synthetic-root", { maxFiles: 2 })).rejects.toThrow("file limit");
  expect(fs.lstat).toHaveBeenCalledTimes(2);
  expect(read).toBe(3);
  expect(closed).toBe(true);
});
