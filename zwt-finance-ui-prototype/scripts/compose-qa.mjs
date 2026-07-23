import sharp from "sharp";

const [sourcePath, implementationPath, outputPath] = process.argv.slice(2);

if (!sourcePath || !implementationPath || !outputPath) {
  throw new Error("Usage: node compose-qa.mjs <source> <implementation> <output>");
}
const width = 1487;
const height = 1058;
const gap = 20;

const [source, implementation] = await Promise.all([
  sharp(sourcePath).resize(width, height, { fit: "fill" }).png().toBuffer(),
  sharp(implementationPath).resize(width, height, { fit: "fill" }).png().toBuffer(),
]);

await sharp({
  create: {
    width: width * 2 + gap,
    height,
    channels: 4,
    background: { r: 28, g: 26, b: 24, alpha: 1 },
  },
})
  .composite([
    { input: source, left: 0, top: 0 },
    { input: implementation, left: width + gap, top: 0 },
  ])
  .png()
  .toFile(outputPath);
