import { deflateSync } from 'node:zlib';

/**
 * Pure TypeScript deterministic PNG encoder and raster canvas.
 * Implements RFC 2083 / ISO/IEC 15948 without external dependencies.
 * Architecture: Server-First, zero bloatware, memory-contiguous RGBA frame buffer.
 */

// CRC-32 Lookup Table (IEEE 802.3 standard polynomial 0xEDB88320)
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  CRC_TABLE[n] = c >>> 0;
}

/**
 * Calculates standard IEEE 802.3 CRC32 checksum over a buffer range.
 */
export function calculateCrc32(buf: Uint8Array, offset = 0, length = buf.length): number {
  let crc = 0xffffffff;
  const end = offset + length;
  for (let i = offset; i < end; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface RGBAColor {
  r: number;
  g: number;
  b: number;
  a?: number; // 0..255 (defaults to 255)
}

/**
 * Parses hex color strings (#RGB, #RRGGBB, #RRGGBBAA) into RGBA.
 */
export function parseColor(color: string | RGBAColor, defaultAlpha = 255): RGBAColor {
  if (typeof color === 'object') {
    return {
      r: Math.max(0, Math.min(255, color.r)),
      g: Math.max(0, Math.min(255, color.g)),
      b: Math.max(0, Math.min(255, color.b)),
      a: color.a !== undefined ? Math.max(0, Math.min(255, color.a)) : defaultAlpha,
    };
  }

  const hex = color.trim().replace(/^#/, '');
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return { r, g, b, a: defaultAlpha };
  }
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return { r, g, b, a: defaultAlpha };
  }
  if (hex.length === 8) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const a = parseInt(hex.substring(6, 8), 16);
    return { r, g, b, a };
  }

  // Fallback dark grey
  return { r: 30, g: 30, b: 35, a: defaultAlpha };
}

/**
 * Contiguous memory raster canvas for drawing 16:9 cinematic cartoon compositions.
 */
export class RasterCanvas {
  readonly width: number;
  readonly height: number;
  private readonly buffer: Uint8Array;

  constructor(width: number, height: number) {
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid canvas dimensions: ${width}x${height}`);
    }
    this.width = Math.floor(width);
    this.height = Math.floor(height);
    // 4 bytes per pixel: RGBA
    this.buffer = new Uint8Array(this.width * this.height * 4);
  }

  /**
   * Clears the canvas with a solid background color.
   */
  clear(color: string | RGBAColor): this {
    const c = parseColor(color);
    const len = this.buffer.length;
    for (let i = 0; i < len; i += 4) {
      this.buffer[i] = c.r;
      this.buffer[i + 1] = c.g;
      this.buffer[i + 2] = c.b;
      this.buffer[i + 3] = c.a ?? 255;
    }
    return this;
  }

  /**
   * Sets a single pixel with alpha blending.
   */
  setPixel(x: number, y: number, color: string | RGBAColor): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const c = parseColor(color);
    const idx = (Math.floor(y) * this.width + Math.floor(x)) * 4;
    const alpha = (c.a ?? 255) / 255;

    if (alpha >= 1) {
      this.buffer[idx] = c.r;
      this.buffer[idx + 1] = c.g;
      this.buffer[idx + 2] = c.b;
      this.buffer[idx + 3] = 255;
    } else if (alpha > 0) {
      const invAlpha = 1 - alpha;
      this.buffer[idx] = Math.round(c.r * alpha + this.buffer[idx] * invAlpha);
      this.buffer[idx + 1] = Math.round(c.g * alpha + this.buffer[idx + 1] * invAlpha);
      this.buffer[idx + 2] = Math.round(c.b * alpha + this.buffer[idx + 2] * invAlpha);
      this.buffer[idx + 3] = Math.min(255, Math.round(c.a! + this.buffer[idx + 3] * invAlpha));
    }
  }

  /**
   * Fills a vertical linear gradient between y0 and y1.
   */
  verticalGradient(y0: number, y1: number, colorStart: string | RGBAColor, colorEnd: string | RGBAColor): this {
    const c0 = parseColor(colorStart);
    const c1 = parseColor(colorEnd);
    const startY = Math.max(0, Math.floor(y0));
    const endY = Math.min(this.height, Math.ceil(y1));
    const span = Math.max(1, endY - startY);

    for (let y = startY; y < endY; y++) {
      const t = (y - startY) / span;
      const r = Math.round(c0.r + (c1.r - c0.r) * t);
      const g = Math.round(c0.g + (c1.g - c0.g) * t);
      const b = Math.round(c0.b + (c1.b - c0.b) * t);
      const a = Math.round((c0.a ?? 255) + ((c1.a ?? 255) - (c0.a ?? 255)) * t);

      const rowOffset = y * this.width * 4;
      for (let x = 0; x < this.width; x++) {
        const idx = rowOffset + x * 4;
        this.buffer[idx] = r;
        this.buffer[idx + 1] = g;
        this.buffer[idx + 2] = b;
        this.buffer[idx + 3] = a;
      }
    }
    return this;
  }

  /**
   * Fills an axis-aligned rectangle with optional alpha blending.
   */
  fillRect(x: number, y: number, w: number, h: number, color: string | RGBAColor): this {
    const c = parseColor(color);
    const minX = Math.max(0, Math.floor(x));
    const maxX = Math.min(this.width, Math.ceil(x + w));
    const minY = Math.max(0, Math.floor(y));
    const maxY = Math.min(this.height, Math.ceil(y + h));

    for (let curY = minY; curY < maxY; curY++) {
      for (let curX = minX; curX < maxX; curX++) {
        this.setPixel(curX, curY, c);
      }
    }
    return this;
  }

  /**
   * Fills a circle or disk.
   */
  fillCircle(cx: number, cy: number, radius: number, color: string | RGBAColor): this {
    const c = parseColor(color);
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.width, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(this.height, Math.ceil(cy + radius));

    for (let y = minY; y < maxY; y++) {
      const dy = y - cy;
      const dy2 = dy * dy;
      for (let x = minX; x < maxX; x++) {
        const dx = x - cx;
        if (dx * dx + dy2 <= r2) {
          this.setPixel(x, y, c);
        }
      }
    }
    return this;
  }

  /**
   * Fills an ellipse.
   */
  fillEllipse(cx: number, cy: number, rx: number, ry: number, color: string | RGBAColor): this {
    const c = parseColor(color);
    const minX = Math.max(0, Math.floor(cx - rx));
    const maxX = Math.min(this.width, Math.ceil(cx + rx));
    const minY = Math.max(0, Math.floor(cy - ry));
    const maxY = Math.min(this.height, Math.ceil(cy + ry));

    for (let y = minY; y < maxY; y++) {
      const dy = (y - cy) / ry;
      const dy2 = dy * dy;
      for (let x = minX; x < maxX; x++) {
        const dx = (x - cx) / rx;
        if (dx * dx + dy2 <= 1.0) {
          this.setPixel(x, y, c);
        }
      }
    }
    return this;
  }

  /**
   * Draws a glowing celestial body (Sun or Moon) with soft radial falloff.
   */
  drawSun(cx: number, cy: number, radius: number, glowRadius: number, color: string | RGBAColor): this {
    const c = parseColor(color);
    // Outer radial glow
    const minX = Math.max(0, Math.floor(cx - glowRadius));
    const maxX = Math.min(this.width, Math.ceil(cx + glowRadius));
    const minY = Math.max(0, Math.floor(cy - glowRadius));
    const maxY = Math.min(this.height, Math.ceil(cy + glowRadius));

    for (let y = minY; y < maxY; y++) {
      const dy = y - cy;
      for (let x = minX; x < maxX; x++) {
        const dx = x - cx;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= radius) {
          this.setPixel(x, y, c);
        } else if (dist <= glowRadius) {
          const t = 1 - (dist - radius) / (glowRadius - radius);
          const alpha = Math.round((c.a ?? 255) * 0.45 * t * t);
          this.setPixel(x, y, { r: c.r, g: c.g, b: c.b, a: alpha });
        }
      }
    }
    return this;
  }

  /**
   * Encodes the canvas into an official binary PNG file buffer.
   */
  toPngBuffer(): Buffer {
    // 1. Scanlines with Filter 0 (None)
    // Each row has 1 filter byte + width * 4 bytes
    const rowBytes = 1 + this.width * 4;
    const rawScanlines = new Uint8Array(rowBytes * this.height);

    for (let y = 0; y < this.height; y++) {
      const scanlineOffset = y * rowBytes;
      rawScanlines[scanlineOffset] = 0; // Filter 0: None

      const bufferRowOffset = y * this.width * 4;
      rawScanlines.set(
        this.buffer.subarray(bufferRowOffset, bufferRowOffset + this.width * 4),
        scanlineOffset + 1
      );
    }

    // 2. Compress scanlines via zlib DEFLATE
    const compressedIdat = deflateSync(rawScanlines, { level: 6 });

    // 3. Assemble PNG Chunks
    // PNG Header (8 bytes): 89 50 4E 47 0D 0A 1A 0A
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // Chunk IHDR: 13 bytes data
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(this.width, 0);
    ihdrData.writeUInt32BE(this.height, 4);
    ihdrData[8] = 8; // Bit depth: 8 bits per channel
    ihdrData[9] = 6; // Color type: 6 = RGBA (Truecolor with alpha)
    ihdrData[10] = 0; // Compression method: 0 (DEFLATE)
    ihdrData[11] = 0; // Filter method: 0 (standard adaptive)
    ihdrData[12] = 0; // Interlace method: 0 (no interlace)
    const ihdrChunk = createPngChunk('IHDR', ihdrData);

    // Chunk IDAT: compressed data
    const idatChunk = createPngChunk('IDAT', compressedIdat);

    // Chunk IEND: empty data
    const iendChunk = createPngChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([pngSignature, ihdrChunk, idatChunk, iendChunk]);
  }
}

/**
 * Builds a valid PNG chunk: [4-byte length][4-byte type][data][4-byte CRC32]
 */
function createPngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = data.length;

  const chunk = Buffer.alloc(8 + length + 4);
  chunk.writeUInt32BE(length, 0);
  typeBytes.copy(chunk, 4);
  if (length > 0) {
    Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(chunk, 8);
  }

  // CRC is computed over type + data (bytes 4 to 8 + length)
  const crcTarget = chunk.subarray(4, 8 + length);
  const crc = calculateCrc32(crcTarget);
  chunk.writeUInt32BE(crc, 8 + length);

  return chunk;
}
