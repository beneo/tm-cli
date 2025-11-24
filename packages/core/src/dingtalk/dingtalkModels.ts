/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDingtalkOAuth2Client } from './dingtalkOAuth2.js';
import { SharedTokenManager } from './sharedTokenManager.js';

export interface DingtalkModel {
  name: string;
  provider?: string;
  available?: boolean;
  features?: string[];
  limits?: {
    max_input?: number;
    max_output?: number;
    context_window?: number;
  };
  rate_limits?: {
    rpm?: number;
    tpm?: number;
    max_concurrency?: number;
  };
}

interface DingtalkModelsResponse {
  data?: DingtalkModel[];
}

export type ModelFetchErrorCode =
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'EMPTY_RESPONSE'
  | 'NO_TOKEN';

export interface ModelFetchError {
  code: ModelFetchErrorCode;
  message: string;
}

export interface ModelFetchResult {
  success: boolean;
  models: string[];
  error?: ModelFetchError;
}

// Visible for testing: clear cached credentials when auth is invalid.
export function clearDingtalkCachedCredentials(): void {
  try {
    SharedTokenManager.getInstance().clearCache();
  } catch (err) {
    console.warn('Failed to clear cached DingTalk credentials', err);
  }
}

function normalizeBaseUrl(resourceUrl?: string): string {
  if (!resourceUrl) {
    return 'https://tmcli.buguk12.com';
  }

  // Strip trailing /v1 to get the API root
  if (resourceUrl.endsWith('/v1')) {
    return resourceUrl.slice(0, -3);
  }

  return resourceUrl.replace(/\/+$/, '');
}

/**
 * Fetch available models from the TM-Server /api/v1/models endpoint.
 * Returns an array of model names, filtering out unavailable entries.
 * Provides structured error info for UI/logging.
 */
export async function fetchDingtalkModels(
  client: IDingtalkOAuth2Client,
): Promise<ModelFetchResult> {
  const MAX_RETRIES = 2;

  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  try {
    const tokenResult = await client.getAccessToken();
    const token = tokenResult.token;
    const creds = client.getCredentials();

    if (!token) {
      return {
        success: false,
        models: [],
        error: { code: 'NO_TOKEN', message: 'No access token available' },
      };
    }

    const baseUrl = normalizeBaseUrl(creds.resource_url);
    const endpoint = `${baseUrl}/api/v1/models`;

    let lastNetworkError: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          const error: ModelFetchError = {
            code: [401, 403].includes(response.status)
              ? 'AUTH_ERROR'
              : 'NETWORK_ERROR',
            message: `HTTP ${response.status}: ${response.statusText}`,
          };
          console.error('Dingtalk model fetch failed', {
            errorCode: error.code,
            status: response.status,
            endpoint,
            authType: 'dingtalk-oauth',
          });
          // Auth errors are not retried.
          if (error.code === 'AUTH_ERROR') {
            clearDingtalkCachedCredentials();
            return { success: false, models: [], error };
          }
          // Network errors may retry.
          if (attempt < MAX_RETRIES) {
            await delay(1000 * (attempt + 1));
            continue;
          }
          return { success: false, models: [], error };
        }

        const body = (await response.json()) as DingtalkModelsResponse;
        const models = (body.data ?? [])
          .filter((model) => model.available !== false)
          .map((model) => model.name)
          .filter(Boolean);

        if (models.length === 0) {
          const error: ModelFetchError = {
            code: 'EMPTY_RESPONSE',
            message: 'No available models returned by server.',
          };
          console.error('Dingtalk model fetch failed', {
            errorCode: error.code,
            endpoint,
            authType: 'dingtalk-oauth',
          });
          return { success: false, models: [], error };
        }

        return { success: true, models };
      } catch (error) {
        lastNetworkError =
          error instanceof Error ? error.message : String(error);
        if (attempt < MAX_RETRIES) {
          await delay(1000 * (attempt + 1));
          continue;
        }
      }
    }

    return {
      success: false,
      models: [],
      error: {
        code: 'NETWORK_ERROR',
        message: lastNetworkError || 'Network error during model fetch',
      },
    };
  } catch (error) {
    return {
      success: false,
      models: [],
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
