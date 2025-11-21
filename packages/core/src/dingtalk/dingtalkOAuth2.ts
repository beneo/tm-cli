/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import * as os from 'os';

import open from 'open';
import { EventEmitter } from 'events';
import type { Config } from '../config/config.js';
import { randomUUID } from 'node:crypto';
import {
  SharedTokenManager,
  TokenManagerError,
  TokenError,
} from './sharedTokenManager.js';

const DINGTALK_OAUTH_BASE_URL = 'http://localhost:8080';
const DINGTALK_OAUTH_DEVICE_CODE_ENDPOINT = `${DINGTALK_OAUTH_BASE_URL}/api/v1/oauth2/device/code`;
const DINGTALK_OAUTH_TOKEN_ENDPOINT = `${DINGTALK_OAUTH_BASE_URL}/api/v1/oauth2/token`;

const DINGTALK_OAUTH_CLIENT_ID = 'tmcli';
const DINGTALK_OAUTH_SCOPE = 'openid profile email';
const DINGTALK_OAUTH_GRANT_TYPE =
  'urn:ietf:params:oauth:grant-type:device_code';

const DINGTALK_DIR = '.qwen';
const DINGTALK_CREDENTIAL_FILENAME = 'dingtalk_oauth_creds.json';

function objectToUrlEncoded(data: Record<string, string>): string {
  return Object.keys(data)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
    .join('&');
}

export function generatePKCEPair(): {
  code_verifier: string;
  code_challenge: string;
} {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256');
  hash.update(codeVerifier);
  return {
    code_verifier: codeVerifier,
    code_challenge: hash.digest('base64url'),
  };
}

export interface ErrorData {
  error: string;
  error_description?: string;
}

export function isErrorResponse(
  response: unknown,
): response is ErrorData & { error: string } {
  return Boolean(
    response && typeof response === 'object' && 'error' in response,
  );
}

export class CredentialsClearRequiredError extends Error {
  constructor(
    message: string,
    public originalError?: unknown,
  ) {
    super(message);
    this.name = 'CredentialsClearRequiredError';
  }
}

export interface DingtalkCredentials {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expiry_date?: number;
  token_type?: string;
  resource_url?: string;
}

export interface DeviceAuthorizationData {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval?: number;
}

export type DeviceAuthorizationResponse =
  | DeviceAuthorizationData
  | ErrorData
  | (ErrorData & { interval?: number });

export function isDeviceAuthorizationSuccess(
  response: DeviceAuthorizationResponse,
): response is DeviceAuthorizationData {
  return Boolean(
    response &&
      typeof response === 'object' &&
      'device_code' in response &&
      'user_code' in response,
  );
}

export interface DeviceTokenData {
  access_token: string | null;
  refresh_token?: string | null;
  token_type: string;
  expires_in: number | null;
  scope?: string | null;
  resource_url?: string;
}

export interface DeviceTokenPendingData {
  error?: string;
  error_description?: string;
  interval?: number;
}

export type DeviceTokenResponse =
  | DeviceTokenData
  | DeviceTokenPendingData
  | ErrorData;

export function isDeviceTokenSuccess(
  response: DeviceTokenResponse,
): response is DeviceTokenData {
  return Boolean(
    response &&
      typeof response === 'object' &&
      'access_token' in response &&
      (response as DeviceTokenData).access_token !== null,
  );
}

export function isDeviceTokenPending(
  response: DeviceTokenResponse,
): response is DeviceTokenPendingData {
  if (!response || typeof response !== 'object') {
    return false;
  }
  const data = response as Partial<DeviceTokenPendingData>;
  return data.error === 'authorization_pending' || data.error === 'slow_down';
}

export interface TokenRefreshData {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  resource_url?: string;
}

export enum DingtalkOAuth2Event {
  AuthUri = 'auth-uri',
  AuthProgress = 'auth-progress',
  AuthCancel = 'auth-cancel',
}

export const dingtalkOAuth2Events = new EventEmitter();

export interface IDingtalkOAuth2Client {
  setCredentials(credentials: DingtalkCredentials): void;
  getCredentials(): DingtalkCredentials;
  getAccessToken(): Promise<{ token?: string }>;
  requestDeviceAuthorization(options: {
    scope: string;
    code_challenge: string;
    code_challenge_method: string;
  }): Promise<DeviceAuthorizationResponse>;
  pollDeviceToken(options: {
    device_code: string;
    code_verifier: string;
  }): Promise<DeviceTokenResponse>;
  refreshAccessToken(): Promise<TokenRefreshData | ErrorData>;
}

export class DingtalkOAuth2Client implements IDingtalkOAuth2Client {
  private credentials: DingtalkCredentials = {};
  private sharedManager: SharedTokenManager;

  constructor() {
    this.sharedManager = SharedTokenManager.getInstance();
  }

  setCredentials(credentials: DingtalkCredentials): void {
    this.credentials = credentials;
  }

  getCredentials(): DingtalkCredentials {
    return this.credentials;
  }

  async getAccessToken(): Promise<{ token?: string }> {
    try {
      const credentials = await this.sharedManager.getValidCredentials(this);
      return { token: credentials.access_token };
    } catch (error) {
      console.warn('Failed to get access token from shared manager:', error);
      return { token: undefined };
    }
  }

  async requestDeviceAuthorization(options: {
    scope: string;
    code_challenge: string;
    code_challenge_method: string;
  }): Promise<DeviceAuthorizationResponse> {
    const bodyData = {
      client_id: DINGTALK_OAUTH_CLIENT_ID,
      scope: options.scope,
      code_challenge: options.code_challenge,
      code_challenge_method: options.code_challenge_method,
    };

    const response = await fetch(DINGTALK_OAUTH_DEVICE_CODE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'x-request-id': randomUUID(),
      },
      body: objectToUrlEncoded(bodyData),
    });

    const result = (await response.json()) as DeviceAuthorizationResponse;

    if (!response.ok) {
      const message = isErrorResponse(result)
        ? `${result.error}: ${result.error_description || 'No details provided'}`
        : `${response.status} ${response.statusText}`;
      throw new Error(`Device authorization failed: ${message}`);
    }
    return result;
  }

  async pollDeviceToken(options: {
    device_code: string;
    code_verifier: string;
  }): Promise<DeviceTokenResponse> {
    const bodyData = {
      grant_type: DINGTALK_OAUTH_GRANT_TYPE,
      client_id: DINGTALK_OAUTH_CLIENT_ID,
      device_code: options.device_code,
      code_verifier: options.code_verifier,
    };

    const response = await fetch(DINGTALK_OAUTH_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: objectToUrlEncoded(bodyData),
    });

    const result = (await response.json()) as DeviceTokenResponse;

    if (!response.ok) {
      // Normalize OAuth device errors for polling loop
      if (isErrorResponse(result)) {
        return result;
      }
      throw new Error(
        `Device token poll failed: ${response.status} ${response.statusText}`,
      );
    }

    return result;
  }

  async refreshAccessToken(): Promise<TokenRefreshData | ErrorData> {
    if (!this.credentials.refresh_token) {
      throw new CredentialsClearRequiredError(
        'No refresh token available. Please re-authenticate.',
      );
    }

    const bodyData = {
      grant_type: 'refresh_token',
      client_id: DINGTALK_OAUTH_CLIENT_ID,
      refresh_token: this.credentials.refresh_token,
    };

    const response = await fetch(DINGTALK_OAUTH_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: objectToUrlEncoded(bodyData),
    });

    const result = (await response.json()) as TokenRefreshData | ErrorData;

    if (!response.ok) {
      if (response.status === 400) {
        throw new CredentialsClearRequiredError(
          'Refresh token invalid or expired. Please re-authenticate.',
          result,
        );
      }
      if (isErrorResponse(result)) {
        throw new Error(
          `Token refresh failed: ${result.error} - ${result.error_description || 'No details provided'}`,
        );
      }
      throw new Error(
        `Token refresh failed: ${response.status} ${response.statusText}`,
      );
    }

    return result;
  }
}

export async function getDingtalkOAuthClient(
  config: Config,
  options?: { requireCachedCredentials?: boolean },
): Promise<DingtalkOAuth2Client> {
  const client = new DingtalkOAuth2Client();
  const sharedManager = SharedTokenManager.getInstance();

  try {
    const credentials = await sharedManager.getValidCredentials(client);
    client.setCredentials(credentials);
    return client;
  } catch (error: unknown) {
    if (error instanceof TokenManagerError) {
      switch (error.type) {
        case TokenError.NO_REFRESH_TOKEN:
          console.debug(
            'No refresh token available, proceeding with device flow',
          );
          break;
        case TokenError.REFRESH_FAILED:
          console.debug('Token refresh failed, proceeding with device flow');
          break;
        case TokenError.NETWORK_ERROR:
          console.warn(
            'Network error during token refresh, trying device flow',
          );
          break;
        default:
          console.warn('Token manager error:', (error as Error).message);
      }
    }

    if (await loadCachedDingtalkCredentials(client)) {
      const result = await authWithDingtalkDeviceFlow(client, config);
      if (!result.success) {
        const errorMessage =
          result.message || 'Dingtalk OAuth authentication failed';
        throw new Error(errorMessage);
      }
      sharedManager.clearCache();
      return client;
    }

    if (options?.requireCachedCredentials) {
      throw new Error(
        'No cached Dingtalk-OAuth credentials found. Please re-authenticate.',
      );
    }

    const result = await authWithDingtalkDeviceFlow(client, config);
    if (!result.success) {
      if (result.reason === 'timeout') {
        dingtalkOAuth2Events.emit(
          DingtalkOAuth2Event.AuthProgress,
          'timeout',
          'Authentication timed out. Please try again or select a different authentication method.',
        );
      }

      const errorMessage =
        result.message ||
        (() => {
          switch (result.reason) {
            case 'timeout':
              return 'Dingtalk OAuth authentication timed out';
            case 'cancelled':
              return 'Dingtalk OAuth authentication was cancelled by user';
            case 'rate_limit':
              return 'Too many requests for Dingtalk OAuth authentication, please try again later.';
            case 'error':
            default:
              return 'Dingtalk OAuth authentication failed';
          }
        })();

      throw new Error(errorMessage);
    }

    sharedManager.clearCache();
    return client;
  }
}

type AuthResult =
  | { success: true }
  | {
      success: false;
      reason: 'timeout' | 'cancelled' | 'error' | 'rate_limit';
      message?: string;
    };

async function authWithDingtalkDeviceFlow(
  client: DingtalkOAuth2Client,
  config: Config,
): Promise<AuthResult> {
  let isCancelled = false;

  const cancelHandler = () => {
    isCancelled = true;
  };
  dingtalkOAuth2Events.once(DingtalkOAuth2Event.AuthCancel, cancelHandler);

  try {
    const { code_verifier, code_challenge } = generatePKCEPair();

    const deviceAuth = await client.requestDeviceAuthorization({
      scope: DINGTALK_OAUTH_SCOPE,
      code_challenge,
      code_challenge_method: 'S256',
    });

    if (!isDeviceAuthorizationSuccess(deviceAuth)) {
      const errorData = deviceAuth as ErrorData;
      throw new Error(
        `Device authorization failed: ${errorData?.error || 'Unknown error'} - ${errorData?.error_description || 'No details provided'}`,
      );
    }

    dingtalkOAuth2Events.emit(
      DingtalkOAuth2Event.AuthUri,
      deviceAuth as DeviceAuthorizationData,
    );

    const showFallbackMessage = () => {
      console.log('\n=== Dingtalk OAuth Device Authorization ===');
      console.log(
        'Please visit the following URL in your browser to authorize:',
      );
      console.log(`\n${deviceAuth.verification_uri_complete}\n`);
      console.log('Waiting for authorization to complete...\n');
    };

    if (!config.isBrowserLaunchSuppressed()) {
      try {
        await open(deviceAuth.verification_uri_complete);
      } catch (error) {
        console.warn(
          'Failed to open browser automatically. Please open the URL manually.',
          error,
        );
        showFallbackMessage();
      }
    } else {
      showFallbackMessage();
    }

    let pollInterval = (deviceAuth.interval || 2) * 1000;
    const maxPollMs = deviceAuth.expires_in * 1000;
    const start = Date.now();

    while (Date.now() - start < maxPollMs) {
      if (isCancelled) {
        const message = 'Authentication cancelled by user.';
        dingtalkOAuth2Events.emit(
          DingtalkOAuth2Event.AuthProgress,
          'error',
          message,
        );
        return { success: false, reason: 'cancelled', message };
      }

      dingtalkOAuth2Events.emit(
        DingtalkOAuth2Event.AuthProgress,
        'polling',
        'Waiting for authorization...',
      );

      const tokenResponse = await client.pollDeviceToken({
        device_code: deviceAuth.device_code,
        code_verifier,
      });

      if (isDeviceTokenSuccess(tokenResponse)) {
        const tokenData = tokenResponse as DeviceTokenData;
        const credentials: DingtalkCredentials = {
          access_token: tokenData.access_token || undefined,
          refresh_token: tokenData.refresh_token || undefined,
          token_type: tokenData.token_type,
          resource_url: tokenData.resource_url,
          expiry_date: tokenData.expires_in
            ? Date.now() + tokenData.expires_in * 1000
            : undefined,
        };

        client.setCredentials(credentials);
        await cacheDingtalkCredentials(credentials);

        dingtalkOAuth2Events.emit(
          DingtalkOAuth2Event.AuthProgress,
          'success',
          'Authentication successful! Access token obtained.',
        );

        return { success: true };
      }

      if (isDeviceTokenPending(tokenResponse)) {
        const pending = tokenResponse as DeviceTokenPendingData;
        if (pending.error === 'slow_down') {
          pollInterval = Math.min(pollInterval + 2000, 10000);
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        continue;
      }

      if (isErrorResponse(tokenResponse)) {
        const message =
          tokenResponse.error === 'access_denied'
            ? 'User denied access. Please start authentication again.'
            : tokenResponse.error_description ||
              `Authentication failed: ${tokenResponse.error}`;
        const reason =
          tokenResponse.error === 'rate_limit' ? 'rate_limit' : 'error';
        dingtalkOAuth2Events.emit(
          DingtalkOAuth2Event.AuthProgress,
          'error',
          message,
        );
        if (tokenResponse.error === 'slow_down') {
          await new Promise((resolve) =>
            setTimeout(resolve, pollInterval + 2000),
          );
          continue;
        }
        return { success: false, reason, message };
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    dingtalkOAuth2Events.emit(
      DingtalkOAuth2Event.AuthProgress,
      'timeout',
      'Authentication timed out. Please try again.',
    );
    return { success: false, reason: 'timeout' };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const message = `Device authorization flow failed: ${errorMessage}`;
    console.error(message);
    return { success: false, reason: 'error', message };
  } finally {
    dingtalkOAuth2Events.off(DingtalkOAuth2Event.AuthCancel, cancelHandler);
  }
}

async function loadCachedDingtalkCredentials(
  client: DingtalkOAuth2Client,
): Promise<boolean> {
  try {
    const keyFile = getDingtalkCachedCredentialPath();
    const creds = await fs.readFile(keyFile, 'utf-8');
    const credentials = JSON.parse(creds) as DingtalkCredentials;
    client.setCredentials(credentials);

    const { token } = await client.getAccessToken();
    if (!token) {
      return false;
    }

    return true;
  } catch (_) {
    return false;
  }
}

async function cacheDingtalkCredentials(credentials: DingtalkCredentials) {
  const filePath = getDingtalkCachedCredentialPath();
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const credString = JSON.stringify(credentials, null, 2);
    await fs.writeFile(filePath, credString);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode =
      error instanceof Error && 'code' in error
        ? (error as Error & { code?: string }).code
        : undefined;

    if (errorCode === 'EACCES') {
      throw new Error(
        `Failed to cache credentials: Permission denied (EACCES). Current user has no permission to access \`${filePath}\`. Please check permissions.`,
      );
    }

    throw new Error(
      `Failed to cache credentials: error when creating folder \`${path.dirname(filePath)}\` and writing to \`${filePath}\`. ${errorMessage}. Please check permissions.`,
    );
  }
}

export async function clearDingtalkCredentials(): Promise<void> {
  try {
    const filePath = getDingtalkCachedCredentialPath();
    await fs.unlink(filePath);
    console.debug('Cached Dingtalk credentials cleared successfully.');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    console.warn(
      'Warning: Failed to clear cached Dingtalk credentials:',
      error,
    );
  }
}

function getDingtalkCachedCredentialPath(): string {
  return path.join(os.homedir(), DINGTALK_DIR, DINGTALK_CREDENTIAL_FILENAME);
}
