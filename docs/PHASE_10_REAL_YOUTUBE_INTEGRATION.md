# PHASE 10 — Real YouTube Integration (OAuth 2.0 & Data API v3)

> **Estado:** COMPLETADA  
> **Fecha:** 4 de Octubre de 2026  
> **Perfil Operativo:** Principal Research Software Engineer & AI Systems Architect  
> **Test Suite:** 29 pruebas específicas (225 globales passing al 100%)  
> **Archivos Clave:**
> - [src/server/youtube/encryption.ts](file:///c:/Users/Glado/CartoonFactory/src/server/youtube/encryption.ts)
> - [src/server/youtube/oauth.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/youtube/oauth.service.ts)
> - [src/server/youtube/channel.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/youtube/channel.service.ts)
> - [src/server/youtube/uploader.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/youtube/uploader.service.ts)
> - [src/server/youtube/youtube.service.ts](file:///c:/Users/Glado/CartoonFactory/src/server/youtube/youtube.service.ts)
> - [src/server/youtube/youtube.router.ts](file:///c:/Users/Glado/CartoonFactory/src/server/youtube/youtube.router.ts)
> - [src/server/youtube/youtube.spec.ts](file:///c:/Users/Glado/CartoonFactory/src/server/youtube/youtube.spec.ts)
> - [src/app/components/youtube-view.ts](file:///c:/Users/Glado/CartoonFactory/src/app/components/youtube-view.ts)

---

## 1. Resumen Ejecutivo de Arquitectura

La **Fase 10** sustituye definitivamente el mock estático de canal de YouTube por una integración oficial, robusta y mecánicamente transparente con **Google OAuth 2.0** y **YouTube Data API v3**, manteniendo estricta conformidad con los estándares de seguridad de datos infantiles (**COPPA**) y la directiva **Server-First Zero-Bloatware**.

A diferencia de implementaciones convencionales que instalan el voluminoso paquete SDK `googleapis` (~50 MB), este motor implementa el protocolo REST nativo de Google utilizando `node:crypto` y la API `fetch` estándar de Node.js 20+.

```
                                [USUARIO / CLIENTE SPA]
                                           │
                                  1. Conectar Canal
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        GOOGLE OAUTH 2.0 CONSENT PIPELINE                               │
│                                                                                        │
│  [GET /api/youtube/auth-url] ──► URL Consent Screen (scopes: youtube.upload, readonly) │
│                                  │                                                     │
│  [GET /api/youtube/callback] ◄── Code + State (HMAC-SHA256 CSRF Verificado)            │
│         │                                                                              │
│         ├── Exchange Code (POST oauth2.googleapis.com/token)                           │
│         ├── UserInfo (GET googleapis.com/oauth2/v2/userinfo)                           │
│         └── Cifrado AES-256-GCM ──► PostgreSQL (google_oauth_accounts)                 │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                  2. Descubrir Canal
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                      YOUTUBE DATA API v3 CHANNEL DISCOVERY                             │
│                                                                                        │
│  GET /youtube/v3/channels?part=snippet,statistics&mine=true                            │
│         │                                                                              │
│         └── Upsert Canónico ──► PostgreSQL (youtube_channels & connections)            │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                  3. Publicar Episodio
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                       RESUMABLE VIDEO UPLOADER & QC GATEKEEPER                         │
│                                                                                        │
│  [QC Invariant Check] ──► Bloqueo HTTP 422 si drift > 0.05s o infracción COPPA         │
│  [Resumable Session]  ──► POST /upload/youtube/v3/videos?uploadType=resumable          │
│                            - Status: PRIVATE por defecto                               │
│                            - COPPA: selfDeclaredMadeForKids: true (Obligatorio)        │
│  [Binary Upload]      ──► PUT <Location URI> (Stream binario MP4 H.264 / AAC)          │
│  [Custom Thumbnail]   ──► POST /upload/youtube/v3/thumbnails/set (1280x720 PNG)        │
│  [Persistencia DB]    ──► youtube_publications + provider_executions                  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Componentes y Módulos Implementados

### 2.1. Cifrado Criptográfico en Reposo (`encryption.ts`)
* **Algoritmo:** `AES-256-GCM` (Galois/Counter Mode con autenticación de datos asociados AEAD).
* **Mitigación de Nonce-Reuse:** Generación atómica de un buffer de 24 bytes aleatorios (`randomBytes(24)`): los primeros 12 bytes (`iv1`) se asignan al Access Token y los siguientes 12 bytes (`iv2`) al Refresh Token. La base de datos almacena `iv1 + iv2` (48 caracteres hex) en el campo `iv: VARCHAR(64)`.
* **Detección de Manipulación:** Almacena el `authTag` de 128 bits (16 bytes = 32 caracteres hex). Cualquier alteración en un solo bit del texto cifrado o del tag dispara un fallo rápido con código `TOKEN_INTEGRITY_CHECK_FAILED`.

### 2.2. Servicio Google OAuth 2.0 (`oauth.service.ts`)
* **Scopes Oficiales:**
  - `https://www.googleapis.com/auth/youtube.upload`
  - `https://www.googleapis.com/auth/youtube.readonly`
  - `https://www.googleapis.com/auth/userinfo.email`
  - `https://www.googleapis.com/auth/userinfo.profile`
* **Defensa CSRF State:** Parámetro `state` firmado criptográficamente con HMAC-SHA256 (`timingSafeEqual`) con ventana de validez de 15 minutos que vincula el `userId` de la sesión.
* **Renovación Transparente de Tokens:** El método `getValidAccessToken(userId)` comprueba la expiración (`tokenExpiry`). Si restan menos de 2 minutos, ejecuta automáticamente la llamada de refresco con `refresh_token`, re-cifra el nuevo token y actualiza PostgreSQL sin interrumpir al usuario.

### 2.3. Gestión de Canales (`channel.service.ts`)
* **Canal Real:** Invoca `/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true`.
* **Persistencia Relacional:** Mapea la relación M:N canónica entre `GoogleOAuthAccount` y `YouTubeChannel` a través de `YouTubeChannelConnection` (`ACTIVE` / `REVOKED`).
* **Desconexión Segura:** `disconnectChannel(userId)` revoca las conexiones activas en base de datos.

### 2.4. Protocolo Resumable de YouTube (`uploader.service.ts`)
* **Paso 1 (Handshake):** `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`
  - Headers: `Authorization: Bearer <token>`, `X-Upload-Content-Type: video/mp4`, `X-Upload-Content-Length: <bytes>`.
  - Body: Metadatos con `selfDeclaredMadeForKids: true` forzado e inmutable y visibilidad `private` por defecto.
  - Recibe el URI de subida desde el encabezado HTTP `Location`.
* **Paso 2 (Transferencia Binaria):** `PUT <Location URI>` con el buffer binario del MP4 renderizado.
* **Paso 3 (Miniatura):** Si existe miniatura 1280x720, la envía vía `POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=<id>`.
* **Paso 4 (Auditoría):** Registra el registro en `youtube_publications` y la telemetría en `provider_executions` (cuota de 1,600 unidades de YouTube Data API).

### 2.5. Modo Sandbox de Alta Fidelidad (`youtube.service.ts`)
* Cuando `GOOGLE_CLIENT_ID` o `GOOGLE_CLIENT_SECRET` no están configurados en `.env` (desarrollo local offline o pruebas unitarias):
  - El sistema conmuta automáticamente a **Sandbox Mode**.
  - Emula la subida produciendo IDs `yt_sbx_...` y URLs `https://youtube.com/watch?v=yt_sbx_...`.
  - Crea el canal demo en PostgreSQL y persiste el registro en `youtube_publications`.
  - Registra warnings estructurados en el logger sin generar excepciones no controladas.

### 2.6. Barrera de Calidad QC Invariable (`QC Gatekeeper`)
* Antes de permitir la publicación, `publishEpisode` consulta `qcService.getLatestReport(episodeId)`.
* Si el reporte presenta `isBlocked: true` (por desincronización de audio drift $> 0.05$s o infracción de PII infantil COPPA), la publicación se aborta de forma determinista con **HTTP 422 Unprocessable Entity** y código `QC_VALIDATION_FAILED`.

---

## 3. Endpoints REST Implementados (`src/server/youtube/youtube.router.ts`)

| Método | Endpoint | Autenticación | Descripción |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/youtube/auth-url` | JWT | Genera la URL de consentimiento Google OAuth 2.0 con CSRF state. |
| `GET` | `/api/youtube/callback` | Pública | Recibe la redirección de Google, valida el state, intercambia tokens y sincroniza el canal. |
| `GET` | `/api/auth/google/callback` | Pública | Alias compatible para callbacks configurados en GCP Console. |
| `GET` | `/api/youtube/status` | JWT | Retorna el estado del canal conectado (o datos sandbox si no está conectado). |
| `POST` | `/api/youtube/publish` | JWT | Publica un episodio en YouTube aplicando el gatekeeper QC y persistiendo en base de datos. |
| `POST` | `/api/youtube/disconnect` | JWT | Revoca la conexión del canal vinculado al usuario. |
| `GET` | `/api/youtube/publications/:episodeId`| JWT | Lista el histórico de publicaciones en YouTube para el episodio especificado. |

---

## 4. Verificación y Resultados Empíricos

* **Pruebas Automatizadas Unitarias & de Integración:** 29 pruebas ejecutadas y aprobadas en `src/server/youtube/youtube.spec.ts`.
* **Suite Global del Proyecto:** 225 pruebas pasando al 100% en 11.5 segundos.
* **Compilación Angular SPA & SSR:** `npm run build` completado con éxito (código de salida 0).
