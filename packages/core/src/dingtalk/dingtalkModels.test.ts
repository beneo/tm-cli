/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchDingtalkModels,
  type ModelFetchResult,
} from './dingtalkModels.js';
import type { IDingtalkOAuth2Client } from './dingtalkOAuth2.js';

const mockClient: Partial<IDingtalkOAuth2Client> = {
  getCredentials: vi.fn(),
  getAccessToken: vi.fn(),
};

describe('fetchDingtalkModels', () => {
  const originalFetch = global.fetch;
  const endpointBase = 'http://localhost:8080/v1';

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.getAccessToken.mockResolvedValue({ token: 'valid-token' });
    mockClient.getCredentials.mockReturnValue({
      resource_url: endpointBase,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
    global.fetch = originalFetch;
  });

  it('retries on network error and resolves on second attempt', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ name: 'model-1', available: true }] }),
      } as unknown as Response);

    const result = (await fetchDingtalkModels(
      mockClient as IDingtalkOAuth2Client,
    )) as ModelFetchResult;

    expect(result.success).toBe(true);
    expect(result.models).toEqual(['model-1']);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry on auth error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({}),
    } as unknown as Response);

    const result = (await fetchDingtalkModels(
      mockClient as IDingtalkOAuth2Client,
    )) as ModelFetchResult;

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AUTH_ERROR');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns network error after max retries', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const result = (await fetchDingtalkModels(
      mockClient as IDingtalkOAuth2Client,
    )) as ModelFetchResult;

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NETWORK_ERROR');
    expect(global.fetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
