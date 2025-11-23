/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { AuthType } from '@qwen-code/qwen-code-core';
import { getAvailableModelsForAuthType } from './availableModels.js';

describe('getAvailableModelsForAuthType', () => {
  it('returns dynamic models for dingtalk oauth when provided', () => {
    const result = getAvailableModelsForAuthType(AuthType.DINGTALK_OAUTH, {
      dynamicModels: ['doubao-seed-1.6', 'qwen3-max'],
    });

    expect(result).toEqual([
      { id: 'doubao-seed-1.6', label: 'doubao-seed-1.6' },
      { id: 'qwen3-max', label: 'qwen3-max' },
    ]);
  });

  it('returns empty list for dingtalk oauth when no dynamic models', () => {
    const result = getAvailableModelsForAuthType(AuthType.DINGTALK_OAUTH);
    expect(result).toEqual([]);
  });
});
