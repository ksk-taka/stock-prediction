/**
 * SVGアイコンからPNGアイコンを生成するスクリプト
 * Usage: npx tsx scripts/generate-icons.ts
 */
import sharp from "sharp";
import path from "path";
import fs from "fs";

const SVG_PATH = path.resolve("public/icons/icon.svg");
const OUTPUT_DIR = path.resolve("public/icons");

const SIZES = [48, 72, 96, 144, 192, 512];

async function main() {
  const svgBuffer = fs.readFileSync(SVG_PATH);

  for (const size of SIZES) {
    const outputPath = path.join(OUTPUT_DIR, `icon-${size}x${size}.png`);
    await sharp(svgBuffer).resize(size, size).png().toFile(outputPath);
    console.log(`✓ Generated ${outputPath}`);
  }

  // maskable icon (with padding for safe zone)
  // maskable icons need ~10% padding around the content
  for (const size of [192, 512]) {
    const paddedSize = Math.round(size * 0.8);
    const offset = Math.round((size - paddedSize) / 2);
    const outputPath = path.join(OUTPUT_DIR, `icon-maskable-${size}x${size}.png`);

    const resized = await sharp(svgBuffer).resize(paddedSize, paddedSize).png().toBuffer();

    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 59, g: 130, b: 246, alpha: 1 }, // #3b82f6
      },
    })
      .composite([{ input: resized, top: offset, left: offset }])
      .png()
      .toFile(outputPath);

    console.log(`✓ Generated maskable ${outputPath}`);
  }

  console.log("\nDone! Update manifest.json with the new icons.");
}

main().catch(console.error);
