/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModelDialog } from './ModelDialog.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { DescriptiveRadioButtonSelect } from './shared/DescriptiveRadioButtonSelect.js';
import { ConfigContext } from '../contexts/ConfigContext.js';
import type {
  Config,
  ModelFetchError,
} from '@qwen-code/qwen-code-core';
import {
  fetchDingtalkModels,
  getDingtalkOAuthClient,
  AuthType,
} from '@qwen-code/qwen-code-core';
import {
  AVAILABLE_MODELS_QWEN,
  MAINLINE_CODER,
  MAINLINE_VLM,
} from '../models/availableModels.js';

vi.mock('../hooks/useKeypress.js', () => ({
  useKeypress: vi.fn(),
}));
const mockedUseKeypress = vi.mocked(useKeypress);

vi.mock('./shared/DescriptiveRadioButtonSelect.js', () => ({
  DescriptiveRadioButtonSelect: vi.fn(() => null),
}));
const mockedSelect = vi.mocked(DescriptiveRadioButtonSelect);

// Mock DingTalk functions - must use vi.fn() directly in factory
vi.mock('@qwen-code/qwen-code-core', async () => {
  const actual = await vi.importActual('@qwen-code/qwen-code-core');
  return {
    ...actual,
    fetchDingtalkModels: vi.fn(),
    getDingtalkOAuthClient: vi.fn(),
  };
});

const renderComponent = (
  props: Partial<React.ComponentProps<typeof ModelDialog>> = {},
  contextValue: Partial<Config> | undefined = undefined,
) => {
  const defaultProps = {
    onClose: vi.fn(),
  };
  const combinedProps = { ...defaultProps, ...props };

  const mockConfig = contextValue
    ? ({
        // --- Functions used by ModelDialog ---
        getModel: vi.fn(() => MAINLINE_CODER),
        setModel: vi.fn(),
        getAuthType: vi.fn(() => 'qwen-oauth'),

        // --- Functions used by ClearcutLogger ---
        getUsageStatisticsEnabled: vi.fn(() => true),
        getSessionId: vi.fn(() => 'mock-session-id'),
        getDebugMode: vi.fn(() => false),
        getContentGeneratorConfig: vi.fn(() => ({ authType: 'mock' })),
        getUseSmartEdit: vi.fn(() => false),
        getUseModelRouter: vi.fn(() => false),
        getProxy: vi.fn(() => undefined),

        // --- Spread test-specific overrides ---
        ...contextValue,
      } as unknown as Config)
    : undefined;

  const renderResult = render(
    <ConfigContext.Provider value={mockConfig}>
      <ModelDialog {...combinedProps} />
    </ConfigContext.Provider>,
  );

  return {
    ...renderResult,
    props: combinedProps,
    mockConfig,
  };
};

describe('<ModelDialog />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the title and help text', () => {
    const { getByText } = renderComponent();
    expect(getByText('Select Model')).toBeDefined();
    expect(getByText('(Press Esc to close)')).toBeDefined();
  });

  it('passes all model options to DescriptiveRadioButtonSelect', () => {
    renderComponent();
    expect(mockedSelect).toHaveBeenCalledTimes(1);

    const props = mockedSelect.mock.calls[0][0];
    expect(props.items).toHaveLength(AVAILABLE_MODELS_QWEN.length);
    expect(props.items[0].value).toBe(MAINLINE_CODER);
    expect(props.items[1].value).toBe(MAINLINE_VLM);
    expect(props.showNumbers).toBe(true);
  });

  it('initializes with the model from ConfigContext', () => {
    const mockGetModel = vi.fn(() => MAINLINE_VLM);
    renderComponent({}, { getModel: mockGetModel });

    expect(mockGetModel).toHaveBeenCalled();
    expect(mockedSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialIndex: 1,
      }),
      undefined,
    );
  });

  it('initializes with default coder model if context is not provided', () => {
    renderComponent({}, undefined);

    expect(mockedSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialIndex: 0,
      }),
      undefined,
    );
  });

  it('initializes with default coder model if getModel returns undefined', () => {
    const mockGetModel = vi.fn(() => undefined);
    // @ts-expect-error This test validates component robustness when getModel
    // returns an unexpected undefined value.
    renderComponent({}, { getModel: mockGetModel });

    expect(mockGetModel).toHaveBeenCalled();

    // When getModel returns undefined, preferredModel falls back to MAINLINE_CODER
    // which has index 0, so initialIndex should be 0
    expect(mockedSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialIndex: 0,
      }),
      undefined,
    );
    expect(mockedSelect).toHaveBeenCalledTimes(1);
  });

  it('calls config.setModel and onClose when DescriptiveRadioButtonSelect.onSelect is triggered', () => {
    const { props, mockConfig } = renderComponent({}, {}); // Pass empty object for contextValue

    const childOnSelect = mockedSelect.mock.calls[0][0].onSelect;
    expect(childOnSelect).toBeDefined();

    childOnSelect(MAINLINE_CODER);

    // Assert against the default mock provided by renderComponent
    expect(mockConfig?.setModel).toHaveBeenCalledWith(MAINLINE_CODER);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not pass onHighlight to DescriptiveRadioButtonSelect', () => {
    renderComponent();

    const childOnHighlight = mockedSelect.mock.calls[0][0].onHighlight;
    expect(childOnHighlight).toBeUndefined();
  });

  it('calls onClose prop when "escape" key is pressed', () => {
    const { props } = renderComponent();

    expect(mockedUseKeypress).toHaveBeenCalled();

    const keyPressHandler = mockedUseKeypress.mock.calls[0][0];
    const options = mockedUseKeypress.mock.calls[0][1];

    expect(options).toEqual({ isActive: true });

    keyPressHandler({
      name: 'escape',
      ctrl: false,
      meta: false,
      shift: false,
      paste: false,
      sequence: '',
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    keyPressHandler({
      name: 'a',
      ctrl: false,
      meta: false,
      shift: false,
      paste: false,
      sequence: '',
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('updates initialIndex when config context changes', () => {
    const mockGetModel = vi.fn(() => MAINLINE_CODER);
    const mockGetAuthType = vi.fn(() => 'qwen-oauth');
    const { rerender } = render(
      <ConfigContext.Provider
        value={
          {
            getModel: mockGetModel,
            getAuthType: mockGetAuthType,
          } as unknown as Config
        }
      >
        <ModelDialog onClose={vi.fn()} />
      </ConfigContext.Provider>,
    );

    expect(mockedSelect.mock.calls[0][0].initialIndex).toBe(0);

    mockGetModel.mockReturnValue(MAINLINE_VLM);
    const newMockConfig = {
      getModel: mockGetModel,
      getAuthType: mockGetAuthType,
    } as unknown as Config;

    rerender(
      <ConfigContext.Provider value={newMockConfig}>
        <ModelDialog onClose={vi.fn()} />
      </ConfigContext.Provider>,
    );

    // Should be called at least twice: initial render + re-render after context change
    expect(mockedSelect).toHaveBeenCalledTimes(2);
    expect(mockedSelect.mock.calls[1][0].initialIndex).toBe(1);
  });
});

describe('<ModelDialog /> - DingTalk dynamic models', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock OAuth client
    vi.mocked(getDingtalkOAuthClient).mockResolvedValue({
      getAccessToken: vi.fn().mockResolvedValue({ token: 'valid-token' }),
      getCredentials: vi.fn().mockReturnValue({
        access_token: 'valid-token',
        resource_url: 'http://localhost:8080/v1',
      }),
      setCredentials: vi.fn(),
      requestDeviceAuthorization: vi.fn(),
      pollDeviceToken: vi.fn(),
      refreshAccessToken: vi.fn(),
      credentials: {},
      sharedManager: {} as any,
    } as any);
  });

  afterEach(() => {
    cleanup();
  });

  it('should display fetched models for dingtalk-oauth auth type', async () => {
    const mockFetchedModels = ['dingtalk-model-1', 'dingtalk-model-2'];
    vi.mocked(fetchDingtalkModels).mockResolvedValue({
      success: true,
      models: mockFetchedModels,
    });

    const mockSetAvailableModelsForAuth = vi.fn();
    const mockSetModelFetchError = vi.fn();

    renderComponent(
      {},
      {
        getAuthType: vi.fn(() => AuthType.DINGTALK_OAUTH),
        getAvailableModelsForAuth: vi.fn(() => mockFetchedModels),
        setAvailableModelsForAuth: mockSetAvailableModelsForAuth,
        setModelFetchError: mockSetModelFetchError,
        getModelFetchError: vi.fn(() => undefined),
      },
    );

    // Wait for models to load
    await waitFor(() => {
      expect(mockSetAvailableModelsForAuth).toHaveBeenCalledWith(
        'dingtalk-oauth',
        mockFetchedModels,
      );
      expect(mockSetModelFetchError).toHaveBeenCalledWith(
        'dingtalk-oauth',
        undefined,
      );
    });

    // Verify models are passed to select component
    await waitFor(() => {
      expect(mockedSelect).toHaveBeenCalled();
      const props =
        mockedSelect.mock.calls[mockedSelect.mock.calls.length - 1][0];
      const modelValues = props.items.map(
        (item: any) => item.value,
      );
      expect(modelValues).toEqual(mockFetchedModels);
    });
  });

  it('should show loading state during fetch', async () => {
    // Mock a delayed response
    let resolvePromise: (value: { success: boolean; models: string[] }) => void;
    const promise = new Promise<{ success: boolean; models: string[] }>(
      (resolve) => {
        resolvePromise = resolve;
      },
    );
    vi.mocked(fetchDingtalkModels).mockReturnValue(promise);

    const { getByText } = renderComponent(
      {},
      {
        getAuthType: vi.fn(() => AuthType.DINGTALK_OAUTH),
        getAvailableModelsForAuth: vi.fn(() => []),
        setAvailableModelsForAuth: vi.fn(),
        setModelFetchError: vi.fn(),
        getModelFetchError: vi.fn(() => undefined),
      },
    );

    // Should show loading state
    await waitFor(() => {
      expect(getByText('Refreshing model list...')).toBeDefined();
    });

    // Resolve the promise
    resolvePromise!({ success: true, models: ['test-model'] });

    // Wait for loading to finish
    await waitFor(() => {
      expect(() => getByText('Refreshing model list...')).toThrow();
    });
  });

  it('should show error state when fetch fails', async () => {
    const errorMessage = 'Network connection failed';
    vi.mocked(fetchDingtalkModels).mockResolvedValue({
      success: false,
      models: [],
      error: {
        code: 'NETWORK_ERROR',
        message: errorMessage,
      },
    });

    const mockSetModelFetchError = vi.fn();

    const { getByText } = renderComponent(
      {},
      {
        getAuthType: vi.fn(() => AuthType.DINGTALK_OAUTH),
        getAvailableModelsForAuth: vi.fn(() => []),
        setAvailableModelsForAuth: vi.fn(),
        setModelFetchError: mockSetModelFetchError,
        getModelFetchError: vi.fn(() => undefined),
      },
    );

    // Wait for error to be displayed
    await waitFor(() => {
      expect(mockSetModelFetchError).toHaveBeenCalledWith(
        'dingtalk-oauth',
        expect.objectContaining({
          code: 'NETWORK_ERROR',
          message: errorMessage,
        }),
      );
    });

    // Verify error message is shown
    await waitFor(() => {
      const errorText = getByText(
        `Failed to refresh model list: ${errorMessage}`,
      );
      expect(errorText).toBeDefined();
    });
  });

  it('should prioritize fetchError over modelFetchError', async () => {
    const fetchErrorMessage = 'Latest fetch error';
    const cachedErrorMessage = 'Cached error from startup';

    vi.mocked(fetchDingtalkModels).mockResolvedValue({
      success: false,
      models: [],
      error: {
        code: 'NETWORK_ERROR',
        message: fetchErrorMessage,
      },
    });

    const { getAllByText, queryByText } = renderComponent(
      {},
      {
        getAuthType: vi.fn(() => AuthType.DINGTALK_OAUTH),
        getAvailableModelsForAuth: vi.fn(() => []),
        setAvailableModelsForAuth: vi.fn(),
        setModelFetchError: vi.fn(),
        getModelFetchError: vi.fn(
          (): ModelFetchError => ({
            code: 'AUTH_ERROR',
            message: cachedErrorMessage,
          }),
        ),
      },
    );

    // Should display the latest fetchError (not the cached modelFetchError)
    await waitFor(() => {
      const errorTexts = getAllByText(
        `Failed to refresh model list: ${fetchErrorMessage}`,
      );
      expect(errorTexts.length).toBeGreaterThan(0);
    });

    // Should not display the cached error message
    expect(
      queryByText(`Failed to refresh model list: ${cachedErrorMessage}`),
    ).toBeNull();
  });
});
