import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import fs from "node:fs";
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
  it.each(["octo-example", "octo-example/"])(
    "extracts the exact commit with valid wrapper directory %s",
    async (directory) => {
      const archive = createTar([
        { name: directory, type: "directory" },
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
        await rm(workspace, { recursive: true, force: true, maxRetries: 3 });
      }
    },
  );

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
          { ...githubPayload(), commitSha: "0123456" },
          workspace,
          new AbortController().signal,
        ),
      ).rejects.toThrow("Full GitHub commit required");
      await expect(
        makeFixture({ archive, binding: null }).materializer.materialize(
          githubPayload(),
          workspace,
          new AbortController().signal,
        ),
      ).rejects.toThrow("GITHUB_REPOSITORY_MAPPING_INVALID");
    } finally {
      await rm(workspace, { recursive: true, force: true, maxRetries: 3 });
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
      await rm(workspace, { recursive: true, force: true, maxRetries: 3 });
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
      await rm(workspace, { recursive: true, force: true, maxRetries: 3 });
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
      await rm(workspace, { recursive: true, force: true, maxRetries: 3 });
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
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
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
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

it("rejects directory-only archives beyond the bounded entry budget", async () => {
  const archive = createTar(
    Array.from({ length: 8 }, (_, index) => ({
      name: `repo/folder-${index}/`,
      type: "directory" as const,
    })),
  );
  const fixture = makeFixture({ archive, limits: { maxFiles: 3 } });
  const workspace = await mkdtemp(path.join(os.tmpdir(), "agentshield-dir-limit-"));
  try {
    await expect(
      fixture.materializer.materialize(githubPayload(), workspace, new AbortController().signal),
    ).rejects.toThrow("GITHUB_ARCHIVE_ENTRY_COUNT_LIMIT");
  } finally {
    // Tar may finish already-scheduled asynchronous mkdir operations after the
    // limiter tears down. Match the bounded retry used by production cleanup.
    await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

it.each([
  { name: "oversized file", type: "file" as const, error: "GITHUB_ARCHIVE_FILE_SIZE_LIMIT" },
  { name: "symlink", type: "symlink" as const, error: "GITHUB_ARCHIVE_LINK_OR_DEVICE_REJECTED" },
  { name: "hardlink", type: "hardlink" as const, error: "GITHUB_ARCHIVE_LINK_OR_DEVICE_REJECTED" },
])("rejects $name before any filesystem operation is scheduled", async ({ type, error }) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "agentshield-rejected-entry-"));
  const fixture = makeFixture({
    archive: createTar([
      {
        name: "repo/rejected.txt",
        body: "abcdef",
        type,
        ...(type === "file" ? {} : { linkname: "outside-target" }),
      },
    ]),
    limits: { maxFileBytes: 3 },
  });
  const probes = [
    vi.spyOn(fs, "stat"),
    vi.spyOn(fs, "lstat"),
    vi.spyOn(fs, "mkdir"),
    vi.spyOn(fs, "open"),
  ];
  try {
    await expect(
      fixture.materializer.materialize(githubPayload(), workspace, new AbortController().signal),
    ).rejects.toThrow(error);
    for (const probe of probes) expect(probe).not.toHaveBeenCalled();
    expect(await readdir(workspace)).toEqual([]);
  } finally {
    for (const probe of probes) probe.mockRestore();
    await rm(workspace, { recursive: true, force: true, maxRetries: 3 });
  }
});

it("cleans accepted partial extraction after a later entry exceeds its budget", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agentshield-partial-extract-"));
  try {
    const fixture = makeFixture({
      archive: createTar([
        { name: "repo/accepted.txt", body: "a" },
        { name: "repo/rejected.txt", body: "abcdef" },
      ]),
      limits: { maxFileBytes: 3 },
    });
    const provider = new TemporaryRepositoryWorkspaceProvider(fixture.materializer, tempRoot);
    await expect(provider.prepare(githubPayload(), new AbortController().signal)).rejects.toThrow(
      "GITHUB_ARCHIVE_FILE_SIZE_LIMIT",
    );
    expect(await readdir(tempRoot)).toEqual([]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  }
});
