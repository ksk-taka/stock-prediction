/**
 * Android用アイコン (mipmap) + スプラッシュ画像を生成
 * Usage: npx tsx scripts/generate-android-icons.ts
 */
import sharp from "sharp";
import path from "path";
import fs from "fs";

const SVG_PATH = path.resolve("public/icons/icon.svg");
const RES_DIR = path.resolve("android/app/src/main/res");

// Android mipmap sizes
const MIPMAP_SIZES: Record<string, number> = {
  "mipmap-mdpi": 48,
  "mipmap-hdpi": 72,
  "mipmap-xhdpi": 96,
  "mipmap-xxhdpi": 144,
  "mipmap-xxxhdpi": 192,
};

async function main() {
  const svgBuffer = fs.readFileSync(SVG_PATH);

  // Generate mipmap icons
  for (const [folder, size] of Object.entries(MIPMAP_SIZES)) {
    const dir = path.join(RES_DIR, folder);
    fs.mkdirSync(dir, { recursive: true });
    const outputPath = path.join(dir, "ic_launcher.png");
    await sharp(svgBuffer).resize(size, size).png().toFile(outputPath);
    console.log(`✓ ${folder}/ic_launcher.png (${size}x${size})`);
  }

  // Generate splash drawable (320x320 centered icon on background)
  const drawableDir = path.join(RES_DIR, "drawable");
  fs.mkdirSync(drawableDir, { recursive: true });

  const splashSize = 320;
  const iconSize = 192;
  const offset = Math.round((splashSize - iconSize) / 2);

  const resizedIcon = await sharp(svgBuffer)
    .resize(iconSize, iconSize)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: splashSize,
      height: splashSize,
      channels: 4,
      background: { r: 249, g: 250, b: 251, alpha: 1 }, // #f9fafb
    },
  })
    .composite([{ input: resizedIcon, top: offset, left: offset }])
    .png()
    .toFile(path.join(drawableDir, "splash.png"));

  console.log(`✓ drawable/splash.png (${splashSize}x${splashSize})`);
  console.log("\nDone!");
}

main().catch(console.error);
