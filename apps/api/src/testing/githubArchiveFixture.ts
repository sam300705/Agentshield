interface TarEntry {
  name: string;
  body?: string;
  type?: "file" | "directory" | "symlink" | "hardlink" | "device";
  linkname?: string;
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const encoded = `${value.toString(8).padStart(length - 1, "0")} `;
  buffer.write(encoded, offset, length, "ascii");
}

export function createTar(entries: TarEntry[]): Buffer {
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
