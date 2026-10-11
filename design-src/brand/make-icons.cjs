// Rasterises the icon artwork into the files browsers and phones ask for.
const fs = require("node:fs");
const path = require("node:path");
const [root, src] = process.argv.slice(2);
const sharp = require(path.join(root, "node_modules/.pnpm/sharp@0.35.5/node_modules/sharp"));
const png = (file, size) => sharp(file, { density: 384 }).resize(size, size).png().toBuffer();

/** An .ico that carries PNG images, which every browser that still asks for one accepts. */
function ico(images) {
  const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0); entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(data.length, 8); entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
}

(async () => {
  const detailed = path.join(root, "src/app/icon.svg"), small = path.join(src, "small.svg"), tile = path.join(src, "tile.svg");
  const sizes = [{ size: 16, data: await png(small, 16) }, { size: 32, data: await png(small, 32) }, { size: 48, data: await png(detailed, 48) }];
  fs.writeFileSync(path.join(root, "src/app/favicon.ico"), ico(sizes));
  fs.writeFileSync(path.join(root, "src/app/apple-icon.png"), await png(tile, 180));
  fs.mkdirSync(path.join(root, "public/icons"), { recursive: true });
  fs.writeFileSync(path.join(root, "public/icons/icon-192.png"), await png(tile, 192));
  fs.writeFileSync(path.join(root, "public/icons/icon-512.png"), await png(tile, 512));
  // For looking at: the small sizes blown up, and the detailed mark.
  for (const { size, data } of sizes) fs.writeFileSync(path.join(src, `check-${size}.png`), await sharp(data).resize(size * 8, size * 8, { kernel: "nearest" }).png().toBuffer());
  fs.writeFileSync(path.join(src, "check-detailed.png"), await png(detailed, 256));
  const row = await sharp({ create: { width: 16 * 8 + 32 * 8 + 48 * 8 + 256 + 180 + 100, height: 420, channels: 4, background: "#f2f2f2" } })
    .composite([{ input: path.join(src, "check-16.png"), left: 10, top: 10 }, { input: path.join(src, "check-32.png"), left: 148, top: 10 }, { input: path.join(src, "check-48.png"), left: 414, top: 10 }, { input: path.join(src, "check-detailed.png"), left: 808, top: 10 }, { input: path.join(root, "src/app/apple-icon.png"), left: 1074, top: 10 }, { input: await sharp(sizes[0].data).toBuffer(), left: 10, top: 300 }, { input: await sharp(sizes[1].data).toBuffer(), left: 40, top: 300 }, { input: await sharp(sizes[2].data).toBuffer(), left: 90, top: 300 }])
    .png().toFile(path.join(src, "sheet.png"));
  console.log("wrote favicon.ico (" + fs.statSync(path.join(root, "src/app/favicon.ico")).size + " bytes), apple-icon.png, icons/icon-192.png, icons/icon-512.png");
})();
