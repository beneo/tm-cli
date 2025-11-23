/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAIContentConverter } from './converter.js';
import type { StreamingToolCallParser } from './streamingToolCallParser.js';
import type { GenerateContentParameters, Content } from '@google/genai';
import type OpenAI from 'openai';

/**
 * Extended message/delta type with reasoning_content field for testing
 */
interface MessageWithReasoning {
  reasoning_content?: unknown;
}

describe('OpenAIContentConverter', () => {
  let converter: OpenAIContentConverter;

  beforeEach(() => {
    converter = new OpenAIContentConverter('test-model');
  });

  describe('resetStreamingToolCalls', () => {
    it('should clear streaming tool calls accumulator', () => {
      // Access private field for testing
      const parser = (
        converter as unknown as {
          streamingToolCallParser: StreamingToolCallParser;
        }
      ).streamingToolCallParser;

      // Add some test data to the parser
      parser.addChunk(0, '{"arg": "value"}', 'test-id', 'test-function');
      parser.addChunk(1, '{"arg2": "value2"}', 'test-id-2', 'test-function-2');

      // Verify data is present
      expect(parser.getBuffer(0)).toBe('{"arg": "value"}');
      expect(parser.getBuffer(1)).toBe('{"arg2": "value2"}');

      // Call reset method
      converter.resetStreamingToolCalls();

      // Verify data is cleared
      expect(parser.getBuffer(0)).toBe('');
      expect(parser.getBuffer(1)).toBe('');
    });

    it('should be safe to call multiple times', () => {
      // Call reset multiple times
      converter.resetStreamingToolCalls();
      converter.resetStreamingToolCalls();
      converter.resetStreamingToolCalls();

      // Should not throw any errors
      const parser = (
        converter as unknown as {
          streamingToolCallParser: StreamingToolCallParser;
        }
      ).streamingToolCallParser;
      expect(parser.getBuffer(0)).toBe('');
    });

    it('should be safe to call on empty accumulator', () => {
      // Call reset on empty accumulator
      converter.resetStreamingToolCalls();

      // Should not throw any errors
      const parser = (
        converter as unknown as {
          streamingToolCallParser: StreamingToolCallParser;
        }
      ).streamingToolCallParser;
      expect(parser.getBuffer(0)).toBe('');
    });
  });

  describe('convertGeminiRequestToOpenAI', () => {
    const createRequestWithFunctionResponse = (
      response: Record<string, unknown>,
    ): GenerateContentParameters => {
      const contents: Content[] = [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'call_1',
                name: 'shell',
                args: {},
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'call_1',
                name: 'shell',
                response,
              },
            },
          ],
        },
      ];
      return {
        model: 'models/test',
        contents,
      };
    };

    it('should extract raw output from function response objects', () => {
      const request = createRequestWithFunctionResponse({
        output: 'Raw output text',
      });

      const messages = converter.convertGeminiRequestToOpenAI(request);
      const toolMessage = messages.find((message) => message.role === 'tool');

      expect(toolMessage).toBeDefined();
      expect(toolMessage?.content).toBe('Raw output text');
    });

    it('should prioritize error field when present', () => {
      const request = createRequestWithFunctionResponse({
        error: 'Command failed',
      });

      const messages = converter.convertGeminiRequestToOpenAI(request);
      const toolMessage = messages.find((message) => message.role === 'tool');

      expect(toolMessage).toBeDefined();
      expect(toolMessage?.content).toBe('Command failed');
    });

    it('should stringify non-string responses', () => {
      const request = createRequestWithFunctionResponse({
        data: { value: 42 },
      });

      const messages = converter.convertGeminiRequestToOpenAI(request);
      const toolMessage = messages.find((message) => message.role === 'tool');

      expect(toolMessage).toBeDefined();
      expect(toolMessage?.content).toBe('{"data":{"value":42}}');
    });
  });

  describe('reasoning_content parsing', () => {
    it('should handle string reasoning_content in streaming chunks', () => {
      const chunk: OpenAI.Chat.ChatCompletionChunk = {
        id: 'chunk-1',
        created: 123,
        model: 'test-model',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              reasoning_content: '思考中',
            } as OpenAI.Chat.ChatCompletionChunk.Choice.Delta &
              MessageWithReasoning,
            finish_reason: null,
            logprobs: null,
          },
        ],
      };

      const result = converter.convertOpenAIChunkToGemini(chunk);
      expect(
        (result as unknown as Record<string, unknown>)['reasoningContent'],
      ).toBe('思考中');
    });

    it('should handle string reasoning_content in non-streaming responses', () => {
      const response: OpenAI.Chat.ChatCompletion = {
        id: 'resp-1',
        created: 456,
        model: 'test-model',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              reasoning_content: '逐步分析',
            } as OpenAI.Chat.ChatCompletionMessage & MessageWithReasoning,
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      };

      const result = converter.convertOpenAIResponseToGemini(response);
      expect(
        (result as unknown as Record<string, unknown>)['reasoningContent'],
      ).toBe('逐步分析');
    });

    it('should handle array reasoning_content with nested objects', () => {
      const chunk: OpenAI.Chat.ChatCompletionChunk = {
        id: 'chunk-2',
        created: 123,
        model: 'test-model',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              reasoning_content: [{ text: '第一步' }, { text: '第二步' }],
            } as OpenAI.Chat.ChatCompletionChunk.Choice.Delta &
              MessageWithReasoning,
            finish_reason: null,
            logprobs: null,
          },
        ],
      };

      const result = converter.convertOpenAIChunkToGemini(chunk);
      expect(
        (result as unknown as Record<string, unknown>)['reasoningContent'],
      ).toBe('第一步第二步');
    });

    it('should handle object reasoning_content with nested content arrays', () => {
      const chunk: OpenAI.Chat.ChatCompletionChunk = {
        id: 'chunk-3',
        created: 123,
        model: 'test-model',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              reasoning_content: {
                content: [{ text: '分析A' }, { text: '分析B' }],
                summary: '结论',
              },
            } as OpenAI.Chat.ChatCompletionChunk.Choice.Delta &
              MessageWithReasoning,
            finish_reason: null,
            logprobs: null,
          },
        ],
      };

      const result = converter.convertOpenAIChunkToGemini(chunk);
      expect(
        (result as unknown as Record<string, unknown>)['reasoningContent'],
      ).toBe('分析A分析B结论');
    });

    it('should stringify reasoning_content objects without textual fields', () => {
      const chunk: OpenAI.Chat.ChatCompletionChunk = {
        id: 'chunk-4',
        created: 123,
        model: 'test-model',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              reasoning_content: { foo: 'bar', type: 'meta' },
            } as OpenAI.Chat.ChatCompletionChunk.Choice.Delta &
              MessageWithReasoning,
            finish_reason: null,
            logprobs: null,
          },
        ],
      };

      const result = converter.convertOpenAIChunkToGemini(chunk);
      expect(
        (result as unknown as Record<string, unknown>)['reasoningContent'],
      ).toBe('{"foo":"bar","type":"meta"}');
    });

    it('should return empty string for empty or null reasoning_content', () => {
      const chunk: OpenAI.Chat.ChatCompletionChunk = {
        id: 'chunk-5',
        created: 123,
        model: 'test-model',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              reasoning_content: null,
            } as OpenAI.Chat.ChatCompletionChunk.Choice.Delta &
              MessageWithReasoning,
            finish_reason: null,
            logprobs: null,
          },
        ],
      };

      const result = converter.convertOpenAIChunkToGemini(chunk);
      expect(
        (result as unknown as Record<string, unknown>)['reasoningContent'],
      ).toBeUndefined();
    });
  });
});
