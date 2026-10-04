/**
 * Phase 03 — Angular Auth Service
 *
 * Manages client-side authentication state using Angular Signals.
 * Communicates with the backend auth API via HttpClient.
 *
 * Responsibilities:
 *  - Maintain reactive `currentUser` signal (null = unauthenticated)
 *  - Hydrate user on app init via GET /api/auth/me (tokens live in HttpOnly cookies)
 *  - Expose login/register/logout methods
 *  - Reactive `isAuthenticated` computed signal for guards and templates
 *
 * Security model:
 *  - This service NEVER stores tokens in JS memory or localStorage.
 *  - All tokens are exclusively managed by the browser's HttpOnly cookie jar.
 *  - CSRF is mitigated by SameSite=Strict cookie policy.
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthMeResponse {
  user: AuthUser;
}

interface AuthLoginResponse {
  user: AuthUser;
}

interface AuthRegisterResponse {
  user: AuthUser;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials {
  email: string;
  name: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  // Reactive state
  private readonly _currentUser = signal<AuthUser | null>(null);
  private readonly _initialized = signal(false);

  /** Null when unauthenticated, AuthUser when authenticated */
  readonly currentUser = this._currentUser.asReadonly();

  /** True after the initial /api/auth/me check has resolved (regardless of result) */
  readonly initialized = this._initialized.asReadonly();

  /** Computed boolean for guards and templates */
  readonly isAuthenticated = computed(() => this._currentUser() !== null);

  // ---------------------------------------------------------------------------
  // App Init
  // ---------------------------------------------------------------------------

  /**
   * Called once during app bootstrap (APP_INITIALIZER).
   * Fetches current user from backend using the HttpOnly cookie.
   * Silently resolves if the user is not authenticated (401).
   */
  async initialize(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<AuthMeResponse>('/api/auth/me', { withCredentials: true })
      );
      this._currentUser.set(response.user);
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        // Not authenticated — expected state for first visit
        this._currentUser.set(null);
      } else {
        // Unexpected error — log but do not crash app
        console.error('[AuthService] Failed to initialize session:', err);
        this._currentUser.set(null);
      }
    } finally {
      this._initialized.set(true);
    }
  }

  // ---------------------------------------------------------------------------
  // Auth Actions
  // ---------------------------------------------------------------------------

  async login(credentials: LoginCredentials): Promise<AuthUser> {
    const response = await firstValueFrom(
      this.http.post<AuthLoginResponse>('/api/auth/login', credentials, {
        withCredentials: true,
      })
    );
    this._currentUser.set(response.user);
    return response.user;
  }

  async register(credentials: RegisterCredentials): Promise<AuthUser> {
    const response = await firstValueFrom(
      this.http.post<AuthRegisterResponse>('/api/auth/register', credentials, {
        withCredentials: true,
      })
    );
    this._currentUser.set(response.user);
    return response.user;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post('/api/auth/logout', {}, { withCredentials: true })
      );
    } finally {
      // Always clear client state, even if backend call fails
      this._currentUser.set(null);
    }
  }

  async refreshTokens(): Promise<void> {
    await firstValueFrom(
      this.http.post('/api/auth/refresh', {}, { withCredentials: true })
    );
  }
}
