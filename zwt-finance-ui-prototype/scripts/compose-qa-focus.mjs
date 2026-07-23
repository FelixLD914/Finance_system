import sharp from "sharp";

const [sourcePath, implementationPath, outputPrefix] = process.argv.slice(2);

if (!sourcePath || !implementationPath || !outputPrefix) {
  throw new Error(
    "Usage: node compose-qa-focus.mjs <source> <implementation> <output-prefix>",
  );
}

async function compareRegion(name, region) {
  const gap = 20;
  const [source, implementation] = await Promise.all([
    sharp(sourcePath).extract(region).png().toBuffer(),
    sharp(implementationPath)
      .extract(region)
      .png()
      .toBuffer(),
  ]);

  await sharp({
    create: {
      width: region.width * 2 + gap,
      height: region.height,
      channels: 4,
      background: { r: 28, g: 26, b: 24, alpha: 1 },
    },
  })
    .composite([
      { input: source, left: 0, top: 0 },
      { input: implementation, left: region.width + gap, top: 0 },
    ])
    .png()
    .toFile(`${outputPrefix}-${name}.png`);
}

await compareRegion("table", { left: 208, top: 284, width: 915, height: 470 });
await compareRegion("detail", { left: 1137, top: 145, width: 330, height: 790 });
