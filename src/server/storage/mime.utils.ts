/**
 * Mapeo ligero de extensiones a tipos MIME estándar (Zero Dependencies).
 */
const EXT_TO_MIME: Record<string, string> = {
  // Audio
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',

  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',

  // Imágenes
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',

  // Documentos y Datos
  json: 'application/json',
  txt: 'text/plain',
  pdf: 'application/pdf',
  xml: 'application/xml',
  srt: 'text/plain',
  vtt: 'text/vtt',
  zip: 'application/zip',
};

/**
 * Obtiene el MIME type a partir del nombre o clave del archivo.
 */
export function lookupMimeType(filenameOrKey: string, fallback = 'application/octet-stream'): string {
  const parts = filenameOrKey.split('.');
  if (parts.length <= 1) return fallback;
  const ext = parts.pop()?.toLowerCase();
  if (!ext) return fallback;
  return EXT_TO_MIME[ext] || fallback;
}

export interface ParsedByteRange {
  start: number;
  end: number;
  totalSize: number;
  chunkLength: number;
}

/**
 * Analiza la cabecera HTTP Range (ej: "bytes=0-1024" o "bytes=1000-")
 * @returns ParsedByteRange si es válido, null si no hay cabecera o es inválida
 */
export function parseHttpRange(rangeHeader: string | undefined, totalSize: number): ParsedByteRange | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return null;
  }

  const rangeSpec = rangeHeader.replace('bytes=', '').trim();
  const [startStr, endStr] = rangeSpec.split('-');

  let start = parseInt(startStr, 10);
  let end = endStr ? parseInt(endStr, 10) : totalSize - 1;

  if (isNaN(start)) {
    // Si start no está especificado, es un rango de sufijo: "bytes=-500" (últimos 500 bytes)
    if (!isNaN(end)) {
      start = Math.max(0, totalSize - end);
      end = totalSize - 1;
    } else {
      return null;
    }
  }

  if (isNaN(end) || end >= totalSize) {
    end = totalSize - 1;
  }

  if (start < 0 || start > end || start >= totalSize) {
    return null;
  }

  const chunkLength = end - start + 1;

  return {
    start,
    end,
    totalSize,
    chunkLength,
  };
}
