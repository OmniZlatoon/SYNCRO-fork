const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');
const SVG_PATH = path.join(__dirname, '..', 'public', 'icon.svg');

// Ensure icons directory exists
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

async function generateIcons() {
  console.log('Generating PWA icons from SVG...');

  // Read SVG content
  const svgBuffer = fs.readFileSync(SVG_PATH);

  // Generate standard icons
  for (const size of ICON_SIZES) {
    const outputPath = path.join(ICONS_DIR, `icon-${size}.png`);

    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);

    console.log(`Generated: icon-${size}.png`);
  }

  // Generate maskable icons (with padding for safe zone)
  const maskableSizes = [192, 512];
  for (const size of maskableSizes) {
    const outputPath = path.join(ICONS_DIR, `icon-${size}-maskable.png`);

    // Add padding for maskable icons (safe zone is 80% of total size)
    const padding = Math.round(size * 0.1); // 10% padding on each side
    const iconSize = size - (padding * 2);

    await sharp(svgBuffer)
      .resize(iconSize, iconSize)
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 99, g: 102, b: 241, alpha: 1 } // Indigo background
      })
      .png()
      .toFile(outputPath);

    console.log(`Generated: icon-${size}-maskable.png`);
  }

  // Generate add icon for shortcuts (96x96)
  const addIconPath = path.join(ICONS_DIR, 'add.png');
  await sharp(svgBuffer)
    .resize(96, 96)
    .png()
    .toFile(addIconPath);

  console.log('Generated: add.png');
  console.log('All PWA icons generated successfully!');
}

generateIcons().catch(console.error);