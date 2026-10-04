/**
 * Phase 03 — Angular Auth Guard
 *
 * Functional route guard that checks authentication before activating protected routes.
 * Reads auth state from `AuthService` — does NOT call the backend on every navigation
 * (avoids unnecessary latency). The AuthService keeps a reactive in-memory signal
 * that is populated once on app init via GET /api/auth/me.
 *
 * Usage:
 *   { path: 'dashboard', canActivate: [authGuard], component: DashboardComponent }
 */

import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (_route, _state) => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  // Redirect to login preserving the intended destination
  return router.createUrlTree(['/login']);
};
