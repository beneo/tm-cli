/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { DingtalkContentGenerator } from './dingtalkContentGenerator.js';

describe('DingtalkContentGenerator default patching', () => {
  // Access the private method via the prototype; it is pure and does not use `this`.
  const applyDefaults = (
    DingtalkContentGenerator as unknown as {
      prototype: {
        applyDingtalkDefaults: (
          req: Record<string, unknown>,
        ) => Record<string, unknown>;
      };
    }
  ).prototype.applyDingtalkDefaults.bind(null) as (
    req: Record<string, unknown>,
  ) => Record<string, unknown>;

  it('applies defaults for doubao-seed-1.6 models', () => {
    const req = { model: 'doubao-seed-1.6-abc', messages: [] };
    const result = applyDefaults(req);
    expect(result['stream']).toBe(true);
    expect(result['reasoning_effort']).toBe('high');

    const config = result['config'] as Record<string, unknown>;
    expect(config).toBeDefined();
    expect(config['stream']).toBe(true);
    expect(config['reasoning_effort']).toBe('high');
  });

  it('respects user-provided values', () => {
    const req = {
      model: 'doubao-seed-1.6',
      messages: [],
      stream: false,
      reasoning_effort: 'low',
      thinking_type: 'enabled',
    };
    const result = applyDefaults(req);
    expect(result['stream']).toBe(false);
    expect(result['reasoning_effort']).toBe('low');
    expect(result['thinking_type']).toBe('enabled');

    const config = result['config'] as Record<string, unknown>;
    expect(config['stream']).toBe(false);
    expect(config['reasoning_effort']).toBe('low');
    expect(config['thinking_type']).toBe('enabled');
  });

  it('syncs user config values to top-level when top-level missing', () => {
    const req = {
      model: 'doubao-seed-1.6',
      messages: [],
      config: { reasoning_effort: 'medium', thinking_type: 'manual' },
    };
    const result = applyDefaults(req);
    expect(result['reasoning_effort']).toBe('medium');
    expect(result['thinking_type']).toBe('manual');

    const config = result['config'] as Record<string, unknown>;
    expect(config['reasoning_effort']).toBe('medium');
    expect(config['thinking_type']).toBe('manual');
  });

  it('keeps top-level values authoritative when config differs', () => {
    const req = {
      model: 'doubao-seed-1.6',
      messages: [],
      reasoning_effort: 'low',
      config: { reasoning_effort: 'medium', thinking_type: 'auto' },
    };
    const result = applyDefaults(req);
    expect(result['reasoning_effort']).toBe('low');

    const config = result['config'] as Record<string, unknown>;
    expect(config['reasoning_effort']).toBe('low');
    expect(config['thinking_type']).toBe('auto');
  });

  it('handles non-object config safely', () => {
    const req = {
      model: 'doubao-seed-1.6',
      messages: [],
      config: null,
    };
    const result = applyDefaults(req);
    expect(result['stream']).toBe(true);
    const config = result['config'] as Record<string, unknown>;
    expect(config['stream']).toBe(true);
  });

  it('does not patch other models', () => {
    const req = { model: 'qwen3-max', messages: [] };
    const result = applyDefaults(req);
    expect(result['stream']).toBe(true); // stream default still applied
    expect(result['reasoning_effort']).toBeUndefined();
    expect(result['thinking_type']).toBeUndefined();
  });
});
