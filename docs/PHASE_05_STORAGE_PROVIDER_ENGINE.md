# PHASE 05 — STORAGEPROVIDER ABSTRACTION ENGINE TECHNICAL REPORT

> **Documento:** Informe Técnico de Arquitectura de Almacenamiento Agnóstico y Blindaje de Medios  
> **Proyecto:** `LyAi-labs/Aipark-` — Cartoon Studio  
> **Branch Activa:** `Try1`  
> **Fecha:** 2026-10-04  
> **Drivers Soportados:** `LocalStorageProvider` (Local/POSIX) | `S3CompatibleStorageProvider` (AWS SigV4 / MinIO / Cloudflare R2 / GCS)  
> **Dependencias Externas:** 0 (Implementación nativa con Node.js `crypto`, `fs`, `stream` y `fetch`)

---

## 1. Executive Summary

| Vector / Dimensión | Evaluación | Justificación Empírica |
| :--- | :---: | :--- |
| **Abstracción Agnóstica** | **PASS** | Interfaz única `StorageProvider` desacoplada del sistema operativo; cambio transparente vía variable de entorno `STORAGE_DRIVER=local\|s3`. |
| **Zero Path Hardcoding** | **PASS** | Eliminación del 100% de rutas Windows (`C:\Users...`) o acoplamientos al filesystem anfitrión; todas las claves y URLs generadas son POSIX normalizadas (`/api/assets/...`). |
| **Defensa Anti-Traversal** | **PASS** | Sanitizador de claves que neutraliza `..`, `..\`, `%2e%2e`, `%252e%252e`, prefijos de disco (`C:`), rutas de red UNC (`\\`, `//`), null bytes (`\0`, `%00`) y caracteres de control ASCII. |
| **Confinamiento de Directorio** | **PASS** | Verificación en tiempo de ejecución con `path.resolve` garantizando que ninguna operación física escape del directorio base configurado. |
| **AWS SigV4 Nativo** | **PASS** | Motor completo de firma AWS Signature Version 4 implementado desde primeros principios con Node `crypto` (`HMAC-SHA256`) sin necesidad del SDK de AWS (~50 MB ahorrados). |
| **Presigned URLs** | **PASS** | Generación determinista de URLs prefirmadas compatibles con S3 (`X-Amz-Algorithm=AWS4-HMAC-SHA256`) y URLs locales firmadas con TTL y HMAC-SHA256. |
| **Streaming & Byte Ranges** | **PASS** | Soporte completo para cabeceras HTTP `Range` (`206 Partial Content`) con cálculo preciso de bytes para permitir seeking fluido en reproductores HTML5 (`<audio>` y `<video>`). |
| **Protección contra Timing Attacks** | **PASS** | Verificación de firmas criptográficas mediante `crypto.timingSafeEqual` con buffers de longitud constante. |
| **Seguridad de Endpoints** | **PASS** | Endpoints de subida (`POST /upload`), firma (`POST /sign`) y borrado (`DELETE /*key`) blindados con middleware `requireAuth` (JWT HS256). |
| **Cobertura de Pruebas** | **105 PASS / 0 FAIL** | 40 pruebas unitarias y de integración en `storage.spec.ts` + 31 en `ai.security.spec.ts` + 34 en `auth.security.spec.ts`. |

---

## 2. Topología y Arquitectura del Subsistema de Almacenamiento

```
                               Cliente Web / Worker / API
                                            │
               ┌────────────────────────────┴────────────────────────────┐
               ▼                                                         ▼
     [GET /api/assets/*key]                                   [POST /upload | DELETE /*key]
     (Streaming / Byte Ranges)                                  (Protegido con requireAuth)
               │                                                         │
               └────────────────────────────┬────────────────────────────┘
                                            ▼
                           [Storage Router (storage.router.ts)]
                                            │
                                            ▼
                      [Path Sanitizer (path.sanitizer.ts)]
                         - Strip Windows Drive Letters (C:)
                         - Strip UNC Paths (\\, //)
                         - Block Path Traversal (.., %2e%2e)
                         - Strip Null Bytes & Control Chars
                         - Normalize POSIX Slashes (/)
                                            │
                                            ▼
                    [Storage Factory (storage.factory.ts)]
                      (STORAGE_DRIVER=local | STORAGE_DRIVER=s3)
                                            │
                     ┌──────────────────────┴──────────────────────┐
                     ▼                                             ▼
       [LocalStorageProvider]                         [S3CompatibleStorageProvider]
       - POSIX Relative Paths                         - AWS SigV4 Native Engine
       - Confinement Check (path.resolve)             - Presigned URLs (X-Amz-*)
       - Streams & Ranges (fs.createReadStream)       - Zero AWS SDK Bloat
       - HMAC-SHA256 URL Signer                       - S3 / MinIO / R2 / GCS
                     │                                             │
                     ▼                                             ▼
             ./storage/assets/                               S3 Remote Bucket
```

---

## 3. Contratos de la Interfaz Canónica `StorageProvider`

Ubicación: [src/server/storage/storage.interface.ts](file:///c:/Users/Glado/CartoonFactory/src/server/storage/storage.interface.ts)

```typescript
export interface StorageProvider {
  readonly driver: 'local' | 's3';

  upload(key: string, data: Buffer | Uint8Array | Readable, mimeType?: string): Promise<string>;
  put(key: string, data: Buffer | Uint8Array | Readable, mimeType?: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  get(key: string): Promise<Buffer>;
  getStream(key: string, range?: RangeOptions): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  getPublicUrl(key: string): string;
  getUrl(key: string): string;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getMetadata(key: string): Promise<StorageItemMetadata | null>;
}
```

---

## 4. Blindaje del Sanitizador de Claves (`path.sanitizer.ts`)

Ubicación: [src/server/storage/path.sanitizer.ts](file:///c:/Users/Glado/CartoonFactory/src/server/storage/path.sanitizer.ts)

El sanitizador aplica un protocolo de validación determinista que impide vectores de explotación:
1. **Límite de longitud estricto:** Claves restringidas a un máximo de 1024 caracteres.
2. **Detección de Null Bytes:** Comprobación antes y después de decodificación (`\0` y `%00`).
3. **Neutralización de Caracteres de Control:** Detección de rangos ASCII `[\x00-\x1F\x7F]`.
4. **Descodificación Iterativa:** Análisis recursivo hasta 2 niveles para neutralizar dobles encodings como `%252e%252e%252f`.
5. **Conversión Universal a POSIX:** Sustitución sistemática de contrabarras `\` por barras `/`.
6. **Rechazo de Unidades de Disco:** Detección inmediata de prefijos de Windows `^[a-zA-Z]:`.
7. **Rechazo de Rutas de Red UNC:** Neutralización de rutas de red remotas `//servidor/...` o `\\servidor\...`.
8. **Validación de Segmentos:** Rechazo categórico si cualquier segmento resultante es `..`, `.`, o `%2e%2e`.
9. **Eliminación de Prefijos:** Remoción forzada de barras iniciales para garantizar rutas estrictamente relativas.

---

## 5. Implementación de Drivers de Almacenamiento

### 5.1. `LocalStorageProvider`
Ubicación: [src/server/storage/local.storage.ts](file:///c:/Users/Glado/CartoonFactory/src/server/storage/local.storage.ts)

* **Directorio Base Confinado:** Resuelve físicamente sobre `STORAGE_PATH` (por defecto `./storage/assets`).
* **Verificación de Frontera:**
  ```typescript
  if (!fullPath.startsWith(resolvedRoot + sep) && fullPath !== resolvedRoot) {
    throw new StorageSecurityError('Intento de escape fuera del directorio base');
  }
  ```
* **Streaming por Rangos (HTTP 206):** Soporta `getStream(key, { start, end })` utilizando `createReadStream` nativo de Node.js.
* **URLs Públicas Seguras:** Generadas siempre como `${publicBaseUrl}/${safeKey}` (e.g. `/api/assets/episodes/1/audio.wav`), garantizando cero rastro de `C:\Users...`.

### 5.2. `S3CompatibleStorageProvider` (AWS SigV4 Nativo)
Ubicación: [src/server/storage/s3.storage.ts](file:///c:/Users/Glado/CartoonFactory/src/server/storage/s3.storage.ts)

* **Cero Dependencias de Terceros:** No requiere `@aws-sdk/client-s3`.
* **Derivación Criptográfica de Claves:**
  $$\text{SigningKey} = \text{HMAC}(\text{HMAC}(\text{HMAC}(\text{HMAC}(\text{"AWS4"} + \text{SecretKey}, \text{DateStamp}), \text{Region}), \text{"s3"}), \text{"aws4\_request"})$$
* **Soporte Presigned URLs:** Construye URLs con autenticación en parámetros de consulta (`X-Amz-Algorithm`, `X-Amz-Credential`, `X-Amz-Date`, `X-Amz-Expires`, `X-Amz-SignedHeaders`, `X-Amz-Signature`).
* **Interoperabilidad:** Total compatibilidad con AWS S3, Cloudflare R2, MinIO y Ceph mediante el flag configurable `forcePathStyle`.

---

## 6. URLs Firmadas y Resistencia a Canal Lateral (`signer.ts`)

Ubicación: [src/server/storage/signer.ts](file:///c:/Users/Glado/CartoonFactory/src/server/storage/signer.ts)

* **Generación de Firma:**
  $$\text{Signature} = \text{HMAC-SHA256}(\text{key} + \text{":"} + \text{expiresAt}, \text{Secret})$$
* **Prevención de Ataques de Tiempo:**
  ```typescript
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new StorageSignatureError('Firma criptográfica inválida o manipulada');
  }
  ```
* **Control de Expiración:** Comprobación estricta contra el reloj UNIX del servidor; URLs vencidas son rechazadas inmediatamente con `403 Forbidden`.

---

## 7. Endpoints de la API REST (`storage.router.ts`)

Ubicación: [src/server/storage/storage.router.ts](file:///c:/Users/Glado/CartoonFactory/src/server/storage/storage.router.ts)

| Método | Endpoint | Autenticación | Funcionalidad |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/assets/*key` | Pública | Sirve archivos con MIME type, cabeceras `X-Content-Type-Options: nosniff`, `Cache-Control` y soporte de streaming parcial `206 Partial Content`. |
| `GET` | `/api/assets/signed` | Pública (Firma) | Valida firma HMAC-SHA256 y TTL antes de transmitir el archivo binario. |
| `POST` | `/api/assets/sign` | JWT (`requireAuth`) | Genera una URL firmada con tiempo de caducidad configurable. |
| `POST` | `/api/assets/upload` | JWT (`requireAuth`) | Recibe datos binarios o base64 (límite defensivo de 50 MB) y los almacena en el driver activo. |
| `DELETE` | `/api/assets/*key` | JWT (`requireAuth`) | Elimina el asset del almacenamiento de forma idempotente. |

---

## 8. Verificación Empírica y Suite de Pruebas

Comando de verificación ejecutado:
```bash
npx vitest run
```

Resultados consolidados de la suite:
```
Test Files  3 passed (3)
     Tests  105 passed (105)
  Duration  11.14s
```

* **`src/server/storage/storage.spec.ts` (40 tests):**
  * 9 pruebas de sanitización y rechazo de path traversal.
  * 4 pruebas de utilidades MIME y análisis de cabeceras HTTP Range.
  * 3 pruebas de firmado HMAC-SHA256, expiración y tamper-resistance.
  * 8 pruebas unitarias del driver `LocalStorageProvider`.
  * 5 pruebas del motor de firma AWS SigV4 en `S3CompatibleStorageProvider`.
  * 2 pruebas de resolución dinámica de la factoría.
  * 9 pruebas de integración sobre endpoints Express (streaming, 206 ranges, 404, 400 bad request, 401 auth, upload y delete).
* **`src/server/auth/auth.security.spec.ts` (34 tests):** 100% PASS.
* **`src/server/ai/ai.security.spec.ts` (31 tests):** 100% PASS.
* **Verificación de Tipos TypeScript (`npx tsc --noEmit`):** 0 errores.
* **Verificación de Linter (`npx eslint src/server/storage`):** 0 errores, 0 warnings.

---

## 9. Conclusión y Pasos Siguientes

Con la finalización y aprobación de la **Phase 05 — StorageProvider Abstraction Engine**, la plataforma Cartoon Studio cuenta con una infraestructura de almacenamiento de medios completamente desacoplada del sistema operativo local y lista para producción distribuida en la nube. 

La arquitectura queda lista para la **Phase 06 — Real Voice & Audio Pipeline**, donde el Worker generará archivos físicos `.wav` por escena y los persistirá a través de este `StorageProvider`.
