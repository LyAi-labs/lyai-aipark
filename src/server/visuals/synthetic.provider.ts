import { GeneratedImageResult, ImageGenerationOptions, ImageProvider } from '../providers/image.provider';
import { RasterCanvas } from './png.encoder';

/**
 * Deterministic Synthetic Image Provider.
 * Generates true 16:9, 1:1 and thumbnail raster PNG buffers with zero external dependencies.
 * Designed for offline operation, dev/test environments and CI pipelines.
 */
export class SyntheticImageProvider implements ImageProvider {
  /**
   * Generates a 16:9 cinematic cartoon scene PNG.
   */
  async generateSceneVisual(options: ImageGenerationOptions): Promise<GeneratedImageResult> {
    const width = options.width || 640;
    const height = options.height || (options.aspectRatio === '1:1' ? width : Math.round((width * 9) / 16));
    const canvas = new RasterCanvas(width, height);

    const prompt = (options.prompt || '').toLowerCase();
    const isSunset = prompt.includes('sunset') || prompt.includes('tarde') || prompt.includes('puesta') || prompt.includes('golden hour');
    const isNight = prompt.includes('night') || prompt.includes('noche') || prompt.includes('luna') || prompt.includes('starry');
    const isNoon = prompt.includes('noon') || prompt.includes('mediodía');

    // 1. Sky Gradient
    if (isSunset) {
      canvas.verticalGradient(0, height * 0.75, '#4C1D95', '#F97316');
      canvas.verticalGradient(height * 0.5, height * 0.8, '#F97316', '#FDE047');
      canvas.drawSun(width * 0.75, height * 0.35, width * 0.045, width * 0.18, { r: 254, g: 240, b: 138, a: 220 });
    } else if (isNight) {
      canvas.verticalGradient(0, height * 0.75, '#0B0F19', '#1E1B4B');
      // Moon
      canvas.drawSun(width * 0.78, height * 0.28, width * 0.04, width * 0.14, { r: 241, g: 245, b: 249, a: 240 });
    } else if (isNoon) {
      canvas.verticalGradient(0, height * 0.75, '#0284C7', '#BAE6FD');
      canvas.drawSun(width * 0.72, height * 0.25, width * 0.05, width * 0.2, { r: 254, g: 240, b: 138, a: 240 });
    } else {
      // Warm Morning (Default)
      canvas.verticalGradient(0, height * 0.75, '#0369A1', '#FEF08A');
      canvas.drawSun(width * 0.75, height * 0.28, width * 0.045, width * 0.18, { r: 253, g: 224, b: 71, a: 230 });
    }

    // 2. Distant Mountains (2 layers)
    const mountainBaseY = height * 0.78;
    const mtnColorBack = isNight ? '#0F172A' : (isSunset ? '#7C2D12' : '#064E3B');
    const mtnColorFront = isNight ? '#1E293B' : (isSunset ? '#9A3412' : '#047857');

    drawMountainRange(canvas, 0, width, height * 0.45, mountainBaseY, mtnColorBack);
    drawMountainRange(canvas, -width * 0.1, width * 1.1, height * 0.52, mountainBaseY + height * 0.05, mtnColorFront);

    // 3. Meadow / Ground
    const groundColor = isNight ? '#064E3B' : (isSunset ? '#3F6212' : '#15803D');
    canvas.fillRect(0, height * 0.72, width, height * 0.28, groundColor);
    // Darker soil rim at bottom
    canvas.fillRect(0, height * 0.94, width, height * 0.06, '#052E16');

    // 4. Character Silhouette / Representation
    const isHare = prompt.includes('liebre') || prompt.includes('conejo') || prompt.includes('tula') || prompt.includes('hare');
    const charCenterX = width * 0.45;
    const charCenterY = height * 0.72;

    if (isHare) {
      // Tula the Hare
      drawCartoonHare(canvas, charCenterX, charCenterY, Math.round(width * 0.0018 * 100));
    } else {
      // Milo the Fox
      drawCartoonFox(canvas, charCenterX, charCenterY, Math.round(width * 0.0018 * 100));
    }

    // 5. Cinematic Scene Stamp Bar (Top Left)
    canvas.fillRect(width * 0.03, height * 0.05, width * 0.24, height * 0.08, { r: 9, g: 9, b: 11, a: 190 });

    const seedUsed = options.seed || Math.floor(Math.random() * 1000000);
    return {
      imageBuffer: canvas.toPngBuffer(),
      mimeType: 'image/png',
      seedUsed,
    };
  }

  /**
   * Generates a 1:1 character model sheet portrait PNG.
   */
  async generateCharacterTurnaround(characterPrompt: string, _style: string): Promise<GeneratedImageResult> {
    const size = 512;
    const canvas = new RasterCanvas(size, size);

    // Neutral studio gradient background
    canvas.verticalGradient(0, size, '#1E293B', '#0F172A');
    // Rim light ring
    canvas.fillCircle(size * 0.5, size * 0.5, size * 0.42, { r: 56, g: 189, b: 248, a: 35 });
    canvas.fillCircle(size * 0.5, size * 0.5, size * 0.40, { r: 30, g: 41, b: 59, a: 255 });

    const prompt = (characterPrompt || '').toLowerCase();
    const isHare = prompt.includes('liebre') || prompt.includes('conejo') || prompt.includes('tula') || prompt.includes('hare');

    if (isHare) {
      drawCartoonHare(canvas, size * 0.5, size * 0.65, 170);
    } else {
      drawCartoonFox(canvas, size * 0.5, size * 0.65, 170);
    }

    // Studio base podium
    canvas.fillEllipse(size * 0.5, size * 0.88, size * 0.35, size * 0.06, { r: 15, g: 23, b: 42, a: 200 });

    return {
      imageBuffer: canvas.toPngBuffer(),
      mimeType: 'image/png',
      seedUsed: 42,
    };
  }

  /**
   * Generates a 1280x720 high-contrast YouTube thumbnail PNG.
   */
  async generateThumbnail(title: string, overlayText: string, heroVisualPrompt: string): Promise<GeneratedImageResult> {
    const width = 1280;
    const height = 720;
    const canvas = new RasterCanvas(width, height);

    // 1. Cosmic Deep Gradient (Purple-Navy-Amber)
    canvas.verticalGradient(0, height, '#0F172A', '#311042');

    // 2. Dramatic Golden Sunrise on Right
    canvas.drawSun(width * 0.75, height * 0.38, width * 0.12, width * 0.38, { r: 245, g: 158, b: 11, a: 230 });

    // 3. Ground curve
    canvas.fillRect(0, height * 0.82, width, height * 0.18, '#18181B');

    // 4. Hero Character on the Right (Enlarged)
    const prompt = (heroVisualPrompt || '').toLowerCase();
    const isHare = prompt.includes('liebre') || prompt.includes('hare') || prompt.includes('tula');
    if (isHare) {
      drawCartoonHare(canvas, width * 0.72, height * 0.68, 260);
    } else {
      drawCartoonFox(canvas, width * 0.72, height * 0.68, 260);
    }

    // 5. High-Impact Typography & Overlay Plate on Left
    canvas.fillRect(width * 0.05, height * 0.18, width * 0.42, height * 0.56, { r: 9, g: 9, b: 11, a: 215 });

    // Top Brand Tag
    canvas.fillRect(width * 0.07, height * 0.22, width * 0.22, height * 0.06, '#F59E0B');

    // YouTube Kids Verified Stamp (Top Right)
    canvas.fillRect(width * 0.82, height * 0.05, width * 0.14, height * 0.06, '#0284C7');

    return {
      imageBuffer: canvas.toPngBuffer(),
      mimeType: 'image/png',
      seedUsed: 1337,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Raster Drawing Helpers
// ──────────────────────────────────────────────────────────────────────────────

function drawMountainRange(
  canvas: RasterCanvas,
  x0: number,
  x1: number,
  peakY: number,
  baseY: number,
  color: string
): void {
  const span = x1 - x0;
  const peaks = [
    { x: x0 + span * 0.22, y: peakY },
    { x: x0 + span * 0.55, y: peakY + (baseY - peakY) * 0.2 },
    { x: x0 + span * 0.82, y: peakY + (baseY - peakY) * 0.1 },
  ];

  const minX = Math.max(0, Math.floor(x0));
  const maxX = Math.min(canvas.width, Math.ceil(x1));
  const minY = Math.max(0, Math.floor(peakY));
  const maxY = Math.min(canvas.height, Math.ceil(baseY));

  for (let x = minX; x < maxX; x++) {
    // Interpolate mountain ridge height
    let ridgeY = baseY;
    for (const p of peaks) {
      const dist = Math.abs(x - p.x);
      const halfW = span * 0.28;
      if (dist < halfW) {
        const factor = 1 - (dist / halfW);
        const yContrib = p.y * factor + baseY * (1 - factor);
        if (yContrib < ridgeY) ridgeY = yContrib;
      }
    }

    const curTop = Math.max(minY, Math.floor(ridgeY));
    for (let y = curTop; y < maxY; y++) {
      canvas.setPixel(x, y, color);
    }
  }
}

function drawCartoonFox(canvas: RasterCanvas, cx: number, cy: number, scale: number): void {
  const s = scale / 100;
  // Orange Fur: #EA580C -> r:234, g:88, b:12
  const orange = { r: 234, g: 88, b: 12, a: 255 };
  // Cream Muzzle: #FEF3C7 -> r:254, g:243, b:199
  const cream = { r: 254, g: 243, b: 199, a: 255 };
  // Green Pack: #65A30D
  const green = { r: 101, g: 163, b: 13, a: 255 };
  // Dark Eyes: #18181B
  const dark = { r: 24, g: 24, b: 27, a: 255 };
  const white = { r: 255, g: 255, b: 255, a: 255 };

  // Body
  canvas.fillEllipse(cx, cy + 30 * s, 36 * s, 30 * s, orange);
  // Backpack
  canvas.fillRect(cx - 16 * s, cy + 22 * s, 32 * s, 26 * s, green);

  // Ears
  canvas.fillCircle(cx - 24 * s, cy - 35 * s, 18 * s, orange);
  canvas.fillCircle(cx - 24 * s, cy - 35 * s, 10 * s, cream);
  canvas.fillCircle(cx + 24 * s, cy - 35 * s, 18 * s, orange);
  canvas.fillCircle(cx + 24 * s, cy - 35 * s, 10 * s, cream);

  // Head
  canvas.fillCircle(cx, cy - 8 * s, 42 * s, orange);

  // White Muzzle
  canvas.fillEllipse(cx, cy + 6 * s, 26 * s, 16 * s, cream);

  // Black Nose
  canvas.fillCircle(cx, cy, 5 * s, dark);

  // Eyes & Highlights
  canvas.fillCircle(cx - 15 * s, cy - 14 * s, 8 * s, dark);
  canvas.fillCircle(cx - 13 * s, cy - 17 * s, 3 * s, white);

  canvas.fillCircle(cx + 15 * s, cy - 14 * s, 8 * s, dark);
  canvas.fillCircle(cx + 17 * s, cy - 17 * s, 3 * s, white);
}

function drawCartoonHare(canvas: RasterCanvas, cx: number, cy: number, scale: number): void {
  const s = scale / 100;
  // Silver Fur: #94A3B8 -> r:148, g:163, b:184
  const silver = { r: 148, g: 163, b: 184, a: 255 };
  // Pink Inner Ear: #FDA4AF -> r:253, g:164, b:175
  const pink = { r: 253, g: 164, b: 175, a: 255 };
  // Blue Vest: #0284C7
  const blue = { r: 2, g: 132, b: 199, a: 255 };
  const dark = { r: 15, g: 23, b: 42, a: 255 };
  const white = { r: 255, g: 255, b: 255, a: 255 };

  // Long Hare Ears
  canvas.fillEllipse(cx - 18 * s, cy - 50 * s, 10 * s, 36 * s, silver);
  canvas.fillEllipse(cx - 18 * s, cy - 50 * s, 5 * s, 26 * s, pink);

  canvas.fillEllipse(cx + 18 * s, cy - 50 * s, 10 * s, 36 * s, silver);
  canvas.fillEllipse(cx + 18 * s, cy - 50 * s, 5 * s, 26 * s, pink);

  // Body & Blue Vest
  canvas.fillEllipse(cx, cy + 30 * s, 34 * s, 28 * s, silver);
  canvas.fillEllipse(cx, cy + 30 * s, 26 * s, 22 * s, blue);

  // Head
  canvas.fillCircle(cx, cy - 6 * s, 38 * s, silver);

  // Cheeks
  canvas.fillCircle(cx - 18 * s, cy + 4 * s, 8 * s, { r: 244, g: 63, b: 94, a: 80 });
  canvas.fillCircle(cx + 18 * s, cy + 4 * s, 8 * s, { r: 244, g: 63, b: 94, a: 80 });

  // Big Expressive Eyes
  canvas.fillCircle(cx - 14 * s, cy - 12 * s, 9 * s, dark);
  canvas.fillCircle(cx - 12 * s, cy - 15 * s, 3 * s, white);

  canvas.fillCircle(cx + 14 * s, cy - 12 * s, 9 * s, dark);
  canvas.fillCircle(cx + 16 * s, cy - 15 * s, 3 * s, white);

  // Pink Nose
  canvas.fillCircle(cx, cy + 2 * s, 4 * s, pink);
}
