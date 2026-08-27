import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { scanJobPayloadSchema, type ScanJobPayload } from "@agentshield/schemas";

import {
  GitHubRepositoryMaterializer,
  type GitHubArchiveLimits,
  type GitHubRepositoryBinding,
} from "./githubRepositoryMaterializer.js";
import { TemporaryRepositoryWorkspaceProvider } from "../services/repositoryWorkspace.js";

interface TarEntry {
  name: string;
  body?: string;
  type?: "file" | "directory" | "symlink" | "hardlink" | "device";
  linkname?: string;
}

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const encoded = `${value.toString(8).padStart(length - 1, "0")} `;
  buffer.write(encoded, offset, length, "ascii");
}

function createTar(entries: TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, "utf8");
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    const type = entry.type ?? "file";
    const body = Buffer.from(entry.body ?? "", "utf8");
    writeOctal(header, 124, 12, type === "file" ? body.length : 0);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] =
      type === "directory"
        ? 53
        : type === "symlink"
          ? 50
          : type === "hardlink"
            ? 49
            : type === "device"
              ? 51
              : 48;
    if (entry.linkname != null) header.write(entry.linkname, 157, 100, "utf8");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(header);
    if (type === "file") {
      blocks.push(body);
      const padding = (512 - (body.length % 512)) % 512;
      if (padding > 0) blocks.push(Buffer.alloc(padding));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function streamFrom(buffer: Buffer): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(buffer)) as ReadableStream<Uint8Array>;
}

function makeFixture(options: {
  archive: Buffer;
  enabled?: boolean;
  limits?: Partial<GitHubArchiveLimits>;
  binding?: GitHubRepositoryBinding | null;
}) {
  const binding: GitHubRepositoryBinding = options.binding ?? {
    organizationId: "org-test",
    repositoryId: "repo-test",
    fullName: "octo/example",
    installationId: 42,
  };
  const downloadRepositoryArchive = vi.fn(() => Promise.resolve(streamFrom(options.archive)));
  const getInstallationToken = vi.fn(() => Promise.resolve("installation-token"));
  const resolve = vi.fn(() => Promise.resolve(options.binding === null ? null : binding));
  const materializer = new GitHubRepositoryMaterializer({
    enabled: options.enabled ?? true,
    archiveClient: { downloadRepositoryArchive },
    tokenProvider: { getInstallationToken },
    bindingResolver: { resolve },
    ...(options.limits == null ? {} : { limits: options.limits }),
  });
  return { materializer, downloadRepositoryArchive, getInstallationToken, resolve };
}

const githubPayload = (overrides: Record<string, unknown> = {}): ScanJobPayload =>
  scanJobPayloadSchema.parse({
    organizationId: "org-test",
    integrationId: "42",
    repositoryId: "repo-test",
    provider: "GITHUB",
    repositoryName: "octo/example",
    repositoryUrl: "https://github.com/octo/example",
    ref: "refs/heads/main",
    commitSha: COMMIT_SHA,
    policyBundleVersion: "v1",
    trigger: "PUSH",
    requester: "github:webhook",
    correlationId: "corr-test",
    options: {},
    ...overrides,
  });

describe("GitHubRepositoryMaterializer", () => {
  it("downloads the exact mapped repository commit with an installation token and extracts it", async () => {
    const archive = createTar([
      { name: "octo-example", type: "directory" },
      { name: "octo-example/src/app.ts", body: "export const safe = true;" },
    ]);
    const fixture = makeFixture({ archive });
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agentshield-materializer-test-"));
    try {
      await fixture.materializer.materialize(
        githubPayload(),
        workspace,
        new AbortController().signal,
      );
      await expect(readFile(path.join(workspace, "src/app.ts"), "utf8")).resolves.toBe(
        "export const safe = true;",
      );
      expect(fixture.resolve).toHaveBeenCalledWith("org-test", "repo-test");
      expect(fixture.getInstallationToken).toHaveBeenCalledWith(42);
      expect(fixture.downloadRepositoryArchive).toHaveBeenCalledWith(
        "octo",
        "example",
        COMMIT_SHA,
        "installation-token",
        expect.any(AbortSignal),
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("fails closed when disabled, unpinned, or mapped to a different tenant/repository", async () => {
    const archive = createTar([{ name: "repo/file.txt", body: "x" }]);
    const disabled = makeFixture({ archive, enabled: false });
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agentshield-materializer-test-"));
    try {
      await expect(
        disabled.materializer.materialize(githubPayload(), workspace, new AbortController().signal),
      ).rejects.toThrow("GITHUB_MATERIALIZATION_DISABLED");
      await expect(
        makeFixture({ archive }).materializer.materialize(
          githubPayload({ commitSha: "0123456" }),
          workspace,
          new AbortController().signal,
        ),
      ).rejects.toThrow("GITHUB_COMMIT_SHA_REQUIRED");
      await expect(
        makeFixture({ archive, binding: null }).materializer.materialize(
          githubPayload(),
          workspace,
          new AbortController().signal,
        ),
      ).rejects.toThrow("GITHUB_REPOSITORY_MAPPING_INVALID");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it.each([
    ["compressed", { maxCompressedBytes: 100 }],
    ["extracted", { maxExtractedBytes: 3 }],
    ["file count", { maxFiles: 1 }],
    ["file size", { maxFileBytes: 3 }],
  ])("enforces the %s archive bound", async (_name, limits) => {
    const archive = createTar([
      { name: "repo", type: "directory" },
      { name: "repo/one.txt", body: "abcdef" },
      { name: "repo/two.txt", body: "ghijkl" },
    ]);
    const fixture = makeFixture({ archive, limits });
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agentshield-materializer-test-"));
    try {
      await expect(
        fixture.materializer.materialize(githubPayload(), workspace, new AbortController().signal),
      ).rejects.toThrow(/GITHUB_ARCHIVE_/);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it.each([
    ["path traversal", createTar([{ name: "repo/../../escape.txt", body: "x" }])],
    ["absolute path", createTar([{ name: "/absolute.txt", body: "x" }])],
    ["symlink", createTar([{ name: "repo/link", type: "symlink", linkname: "/tmp/escape" }])],
    ["hardlink", createTar([{ name: "repo/link", type: "hardlink", linkname: "repo/file" }])],
    ["device", createTar([{ name: "repo/device", type: "device" }])],
    ["malformed archive", Buffer.from("not a tar archive")],
  ])("rejects hostile or malformed %s archives", async (_name, archive) => {
    const fixture = makeFixture({ archive });
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agentshield-materializer-test-"));
    try {
      await expect(
        fixture.materializer.materialize(githubPayload(), workspace, new AbortController().signal),
      ).rejects.toThrow();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("honors cancellation before fetching and cleans a failed temporary workspace", async () => {
    const archive = createTar([{ name: "repo/file.txt", body: "x" }]);
    const fixture = makeFixture({ archive });
    const controller = new AbortController();
    controller.abort();
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agentshield-materializer-test-"));
    try {
      await expect(
        fixture.materializer.materialize(githubPayload(), workspace, controller.signal),
      ).rejects.toThrow("Scan cancelled");
      expect(fixture.downloadRepositoryArchive).not.toHaveBeenCalled();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agentshield-materializer-root-"));
    try {
      const provider = new TemporaryRepositoryWorkspaceProvider(
        makeFixture({ archive: Buffer.from("invalid") }).materializer,
        tempRoot,
      );
      await expect(
        provider.prepare(githubPayload(), new AbortController().signal),
      ).rejects.toThrow();
      await expect(readdir(tempRoot)).resolves.toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects workspace cleanup paths that escape the configured root", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agentshield-materializer-root-"));
    try {
      const provider = new TemporaryRepositoryWorkspaceProvider(
        makeFixture({ archive: createTar([{ name: "repo/file.txt", body: "x" }]) }).materializer,
        tempRoot,
      );
      const workspace = await provider.prepare(githubPayload(), new AbortController().signal);
      await workspace.cleanup();
      await expect(readdir(tempRoot)).resolves.toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
