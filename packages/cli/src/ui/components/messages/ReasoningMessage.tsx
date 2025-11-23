/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../semantic-colors.js';
import { GeminiRespondingSpinner } from '../GeminiRespondingSpinner.js';

interface ReasoningMessageProps {
  text: string;
  isPending: boolean;
}

export const ReasoningMessage: React.FC<ReasoningMessageProps> = ({
  text,
  isPending,
}) => (
    <Box flexDirection="row">
      <Box marginRight={1}>
        <Text color={theme.status.success}>💡</Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        {isPending && <GeminiRespondingSpinner />}
        <Text color={theme.status.success} dimColor>
          {text}
        </Text>
      </Box>
    </Box>
  );
