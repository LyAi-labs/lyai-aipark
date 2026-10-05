/**
 * Google OAuth 2.0 Service
 * Handles OAuth consent flow, state verification, token exchange,
 * automatic token refreshing, and encrypted persistence in PostgreSQL.
 * Built with native Fetch and zero heavy external dependencies.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { db } from '../db';
import { logger } from '../utils/logger';
import { AppError } from '../errors';
import { encryptOAuthTokens, decryptOAuthTokens } from './encryption';
import type { GoogleOAuthTokenResponse, GoogleUserInfo } from './types';

export const YOUTUBE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export class GoogleOAuthService {
  private clientId: string;
  private clientSecret: string;
  private defaultRedirectUri: string;

  constructor() {
    this.clientId = config.googleOAuth.clientId;
    this.clientSecret = config.googleOAuth.clientSecret;
    this.defaultRedirectUri = config.googleOAuth.redirectUri;
  }

  /**
   * Generates a tamper-proof state string to prevent CSRF attacks.
   */
  generateState(userId: string): string {
    const payload = `${userId}:${Date.now()}`;
    const secret = config.auth.jwtSecret || 'oauth_csrf_secret_min_32_chars_ok';
    const hmac = createHmac('sha256', secret).update(payload).digest('hex');
    const stateObj = { payload, signature: hmac };
    return Buffer.from(JSON.stringify(stateObj)).toString('base64url');
  }

  /**
   * Verifies the authenticity and expiration of the OAuth state.
   */
  verifyState(state: string): { valid: boolean; userId: string } {
    try {
      const decoded = Buffer.from(state, 'base64url').toString('utf8');
      const { payload, signature } = JSON.parse(decoded);
      const secret = config.auth.jwtSecret || 'oauth_csrf_secret_min_32_chars_ok';
      const expectedHmac = createHmac('sha256', secret).update(payload).digest('hex');

      const expectedBuf = Buffer.from(expectedHmac, 'hex');
      const actualBuf = Buffer.from(signature, 'hex');

      if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
        return { valid: false, userId: '' };
      }

      const [userId, timestampStr] = payload.split(':');
      const timestamp = parseInt(timestampStr, 10);
      const maxAgeMs = 15 * 60 * 1000; // 15 minutes window

      if (Date.now() - timestamp > maxAgeMs) {
        return { valid: false, userId: '' };
      }

      return { valid: true, userId };
    } catch {
      return { valid: false, userId: '' };
    }
  }

  /**
   * Generates the Google OAuth 2.0 consent screen URL.
   */
  getAuthorizationUrl(userId: string, redirectUriOverride?: string): string {
    const redirectUri = redirectUriOverride || this.defaultRedirectUri;
    const state = this.generateState(userId);

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: YOUTUBE_OAUTH_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
      include_granted_scopes: 'true',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchanges authorization code for Access and Refresh tokens.
   */
  async exchangeCodeForTokens(
    code: string,
    redirectUriOverride?: string
  ): Promise<GoogleOAuthTokenResponse> {
    const redirectUri = redirectUriOverride || this.defaultRedirectUri;

    const body = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('Google OAuth token exchange failed', { status: response.status, body: errText });
      throw new AppError(`Google OAuth token exchange failed: ${errText}`, 502, 'OAUTH_EXCHANGE_FAILED');
    }

    return (await response.json()) as GoogleOAuthTokenResponse;
  }

  /**
   * Refreshes an expired access token using the stored refresh token.
   */
  async refreshAccessToken(refreshToken: string): Promise<GoogleOAuthTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('Google OAuth token refresh failed', { status: response.status, body: errText });
      throw new AppError(`Google OAuth token refresh failed: ${errText}`, 502, 'OAUTH_REFRESH_FAILED');
    }

    return (await response.json()) as GoogleOAuthTokenResponse;
  }

  /**
   * Retrieves Google user profile (ID & Email) using the access token.
   */
  async getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('Google userinfo retrieval failed', { status: response.status, body: errText });
      throw new AppError(`Failed to retrieve Google userinfo: ${errText}`, 502, 'GOOGLE_USERINFO_FAILED');
    }

    return (await response.json()) as GoogleUserInfo;
  }

  /**
   * Persists or updates encrypted OAuth account in database.
   */
  async saveUserOAuthAccount(
    userId: string,
    userInfo: GoogleUserInfo,
    tokenData: GoogleOAuthTokenResponse
  ) {
    const encrypted = encryptOAuthTokens(tokenData.access_token, tokenData.refresh_token || '');
    const tokenExpiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);

    return db.googleOAuthAccount.upsert({
      where: {
        uq_google_oauth_user_account: {
          userId,
          googleUserId: userInfo.id,
        },
      },
      update: {
        email: userInfo.email,
        encryptedAccessToken: encrypted.encryptedAccessToken,
        ...(tokenData.refresh_token ? { encryptedRefreshToken: encrypted.encryptedRefreshToken } : {}),
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        tokenExpiry,
        scopes: tokenData.scope ? tokenData.scope.split(' ') : YOUTUBE_OAUTH_SCOPES,
      },
      create: {
        userId,
        googleUserId: userInfo.id,
        email: userInfo.email,
        encryptedAccessToken: encrypted.encryptedAccessToken,
        encryptedRefreshToken: encrypted.encryptedRefreshToken,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        tokenExpiry,
        scopes: tokenData.scope ? tokenData.scope.split(' ') : YOUTUBE_OAUTH_SCOPES,
      },
    });
  }

  /**
   * Retrieves a decrypted, valid (auto-refreshed) access token for a user.
   */
  async getValidAccessToken(userId: string): Promise<{ accessToken: string; accountId: string } | null> {
    const account = await db.googleOAuthAccount.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });

    if (!account) return null;

    const decrypted = decryptOAuthTokens({
      encryptedAccessToken: account.encryptedAccessToken,
      encryptedRefreshToken: account.encryptedRefreshToken,
      iv: account.iv,
      authTag: account.authTag,
    });

    const now = new Date();
    // Refresh 2 minutes before actual expiration to prevent race conditions
    const needsRefresh = account.tokenExpiry.getTime() - now.getTime() < 2 * 60 * 1000;

    if (!needsRefresh) {
      return { accessToken: decrypted.accessToken, accountId: account.id };
    }

    if (!decrypted.refreshToken) {
      logger.warn('OAuth access token expired and no refresh token present', { userId, accountId: account.id });
      return { accessToken: decrypted.accessToken, accountId: account.id };
    }

    try {
      const refreshed = await this.refreshAccessToken(decrypted.refreshToken);
      const newEncrypted = encryptOAuthTokens(refreshed.access_token, decrypted.refreshToken);
      const newExpiry = new Date(Date.now() + (refreshed.expires_in || 3600) * 1000);

      await db.googleOAuthAccount.update({
        where: { id: account.id },
        data: {
          encryptedAccessToken: newEncrypted.encryptedAccessToken,
          iv: newEncrypted.iv,
          authTag: newEncrypted.authTag,
          tokenExpiry: newExpiry,
        },
      });

      return { accessToken: refreshed.access_token, accountId: account.id };
    } catch (err: any) {
      logger.error('Failed to auto-refresh access token', { error: err.message, userId });
      // Return existing token as last resort
      return { accessToken: decrypted.accessToken, accountId: account.id };
    }
  }
}

export const googleOAuthService = new GoogleOAuthService();
