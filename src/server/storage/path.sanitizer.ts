import { StorageSecurityError } from './storage.errors';

/**
 * Longitud máxima permitida para una clave de almacenamiento
 */
const MAX_KEY_LENGTH = 1024;

/**
 * Expresión regular para caracteres seguros en claves POSIX
 * Permite alfanuméricos, guiones, guiones bajos, puntos, barras inclinadas y arroba.
 */
const SAFE_KEY_REGEX = /^[a-zA-Z0-9_\-./@]+$/;

/**
 * Sanitiza y valida rigurosamente una clave de almacenamiento (Storage Key).
 *
 * Garantías de Seguridad:
 * 1. Rechaza ataques de Path Traversal (`..`, `../`, `..\`, `%2e%2e`, etc.).
 * 2. Rechaza inyecciones de Null Byte (`\0`, `%00`).
 * 3. Rechaza rutas absolutas de Windows (`C:\`, `D:\`) y prefijos de unidad.
 * 4. Rechaza rutas de red UNC (`\\servidor\...` o `//servidor/...`).
 * 5. Rechaza caracteres de control ASCII (`\x00-\x1F`, `\x7F`).
 * 6. Convierte separadores de Windows `\` en barras POSIX `/`.
 * 7. Elimina barras iniciales redundantes para garantizar que la clave sea siempre relativa.
 * 8. Rechaza dobles barras vacías `//` que puedan crear segmentos ambiguos.
 *
 * @param rawKey Clave o ruta de entrada sin sanitizar
 * @returns Clave POSIX normalizada, segura y estrictamente relativa
 * @throws StorageSecurityError ante cualquier intento malicioso o clave malformada
 */
export function sanitizeStorageKey(rawKey: unknown): string {
  if (typeof rawKey !== 'string') {
    throw new StorageSecurityError('La clave de almacenamiento debe ser una cadena de texto');
  }

  const trimmed = rawKey.trim();
  if (trimmed.length === 0) {
    throw new StorageSecurityError('La clave de almacenamiento no puede estar vacía');
  }

  if (trimmed.length > MAX_KEY_LENGTH) {
    throw new StorageSecurityError(`La clave excede la longitud máxima de ${MAX_KEY_LENGTH} caracteres`);
  }

  // 1. Detección de Null Bytes en crudo
  if (trimmed.includes('\0')) {
    throw new StorageSecurityError('Null byte detectado en la clave de almacenamiento');
  }

  // 2. Detección de caracteres de control ASCII
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    throw new StorageSecurityError('Caracteres de control no permitidos en la clave');
  }

  // 3. Descodificación iterativa (hasta 2 niveles) para neutralizar URL encoding / double encoding
  let decoded = trimmed;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      throw new StorageSecurityError('Secuencia de escape URI malformada en la clave');
    }
  }

  // Re-verificar null bytes tras decodificación (%00)
  if (decoded.includes('\0')) {
    throw new StorageSecurityError('Null byte codificado detectado en la clave');
  }

  // 4. Normalizar todas las contrabarras de Windows a barras POSIX
  let normalized = decoded.replace(/\\/g, '/');

  // 5. Detección de rutas absolutas de Windows (ej: C:/..., D:/...)
  if (/^[a-zA-Z]:/i.test(normalized)) {
    throw new StorageSecurityError('Ruta absoluta con letra de unidad de Windows no permitida');
  }

  // 6. Detección de rutas de red UNC (ej: \\servidor\recurso o //servidor/recurso)
  if (/^[\\/]{2}[^\\/]+[\\/]/.test(trimmed)) {
    throw new StorageSecurityError('Rutas de red UNC no permitidas');
  }

  // 7. Eliminar barras iniciales para asegurar que es estrictamente relativa
  while (normalized.startsWith('/')) {
    normalized = normalized.slice(1);
  }

  if (normalized.length === 0) {
    throw new StorageSecurityError('La clave de almacenamiento normalizada no puede estar vacía');
  }

  // 8. Validación de segmentos de Path Traversal
  const segments = normalized.split('/');
  for (const segment of segments) {
    if (segment === '..' || segment === '%2e%2e' || segment === '.') {
      throw new StorageSecurityError('Intento de Path Traversal detectado (segmento ".." o ".")');
    }
    if (segment.length === 0) {
      throw new StorageSecurityError('Segmento de ruta vacío detectado (barras consecutivas "//")');
    }
  }

  // 9. Comprobar juego de caracteres permitidos
  if (!SAFE_KEY_REGEX.test(normalized)) {
    throw new StorageSecurityError('La clave contiene caracteres ilegales no permitidos');
  }

  return normalized;
}
