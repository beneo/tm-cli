/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import {
  AuthType,
  ModelSlashCommandEvent,
  logModelSlashCommand,
  getDingtalkOAuthClient,
  fetchDingtalkModels,
  type ModelFetchError,
} from '@qwen-code/qwen-code-core';
import { useKeypress } from '../hooks/useKeypress.js';
import { theme } from '../semantic-colors.js';
import { DescriptiveRadioButtonSelect } from './shared/DescriptiveRadioButtonSelect.js';
import { ConfigContext } from '../contexts/ConfigContext.js';
import {
  getAvailableModelsForAuthType,
  MAINLINE_CODER,
} from '../models/availableModels.js';
import { t } from '../../i18n/index.js';

interface ModelDialogProps {
  onClose: () => void;
}

export function ModelDialog({ onClose }: ModelDialogProps): React.JSX.Element {
  const config = useContext(ConfigContext);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | undefined>(undefined);
  const [dynamicModelsState, setDynamicModelsState] = useState<string[]>([]);

  // Get auth type from config, default to QWEN_OAUTH if not available
  const authType = config?.getAuthType() ?? AuthType.QWEN_OAUTH;
  const modelFetchError = config?.getModelFetchError?.(authType);
  const displayError = fetchError || modelFetchError?.message;

  // Refresh dynamic models when dialog opens (for DingTalk OAuth)
  useEffect(() => {
    let cancelled = false;

    async function refreshModels() {
      if (!config || authType !== AuthType.DINGTALK_OAUTH) {
        return;
      }
      setLoading(true);
      setFetchError(undefined);

      try {
        const client = await getDingtalkOAuthClient(config, {
          requireCachedCredentials: true,
        });
        const result = await fetchDingtalkModels(client);

        if (cancelled) {
          return;
        }

        if (result.success) {
          setDynamicModelsState(result.models);
          config.setAvailableModelsForAuth(
            AuthType.DINGTALK_OAUTH,
            result.models,
          );
          config.setModelFetchError(AuthType.DINGTALK_OAUTH, undefined);
        } else {
          const message =
            result.error?.message || 'Failed to fetch models (unknown error).';
          setFetchError(message);
          config.setModelFetchError(AuthType.DINGTALK_OAUTH, result.error);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setFetchError(message);
        if (config) {
          config.setModelFetchError(AuthType.DINGTALK_OAUTH, {
            code: 'NETWORK_ERROR',
            message,
          } as ModelFetchError);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    refreshModels();

    return () => {
      cancelled = true;
    };
  }, [authType, config]);

  // Get available models based on auth type (dynamic from config if present)
  const cachedDynamic =
    (config?.getAvailableModelsForAuth &&
      config.getAvailableModelsForAuth(authType)) ||
    [];
  const effectiveDynamicModels = dynamicModelsState.length
    ? dynamicModelsState
    : cachedDynamic;

  const availableModels = useMemo(
    () =>
      getAvailableModelsForAuthType(authType, {
        dynamicModels: effectiveDynamicModels,
      }),
    [authType, effectiveDynamicModels],
  );

  const MODEL_OPTIONS = useMemo(
    () =>
      availableModels.map((model) => ({
        value: model.id,
        title: model.label,
        description: model.description || '',
        key: model.id,
      })),
    [availableModels],
  );

  // Determine the Preferred Model (read once when the dialog opens).
  const preferredModel = config?.getModel() || MAINLINE_CODER;

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onClose();
      }
    },
    { isActive: true },
  );

  // Calculate the initial index based on the preferred model.
  const initialIndex = useMemo(
    () => MODEL_OPTIONS.findIndex((option) => option.value === preferredModel),
    [MODEL_OPTIONS, preferredModel],
  );

  // Handle selection internally (Autonomous Dialog).
  const handleSelect = useCallback(
    (model: string) => {
      if (config) {
        config.setModel(model);
        const event = new ModelSlashCommandEvent(model);
        logModelSlashCommand(config, event);
      }
      onClose();
    },
    [config, onClose],
  );

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>{t('Select Model')}</Text>
      {(loading || displayError) && (
        <Box marginTop={1} flexDirection="column">
          {loading && (
            <Text color={theme.text.secondary}>
              {t('Refreshing model list...')}
            </Text>
          )}
          {displayError && (
            <Text color={theme.status.error}>
              {t('Failed to refresh model list: {{message}}', {
                message: displayError,
              })}
            </Text>
          )}
        </Box>
      )}
      <Box marginTop={1}>
        <DescriptiveRadioButtonSelect
          items={MODEL_OPTIONS}
          onSelect={handleSelect}
          initialIndex={initialIndex}
          showNumbers={true}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text.secondary}>{t('(Press Esc to close)')}</Text>
      </Box>
    </Box>
  );
}
