import { AppError } from '../errors';

/**
 * Error genérico de operaciones de almacenamiento
 */
export class StorageError extends AppError {
  constructor(message: string, statusCode = 500, code = 'STORAGE_ERROR') {
    super(message, statusCode, code);
  }
}

/**
 * Violación de seguridad en clave o ruta de almacenamiento (Path Traversal, Null Bytes, Drive Letters)
 */
export class StorageSecurityError extends StorageError {
  constructor(message: string) {
    super(`Violación de seguridad de almacenamiento: ${message}`, 400, 'STORAGE_SECURITY_ERROR');
  }
}

/**
 * Recurso no encontrado en el proveedor de almacenamiento
 */
export class StorageNotFoundError extends StorageError {
  constructor(key: string) {
    super(`Recurso no encontrado en almacenamiento: ${key}`, 404, 'STORAGE_NOT_FOUND');
  }
}

/**
 * Error de validación criptográfica en URL firmada (manipulación, expiración o parámetros inválidos)
 */
export class StorageSignatureError extends StorageError {
  constructor(message = 'Firma de URL de almacenamiento no válida o expirada') {
    super(message, 403, 'STORAGE_SIGNATURE_ERROR');
  }
}
