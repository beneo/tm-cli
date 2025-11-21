/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenAIContentGenerator } from '../core/openaiContentGenerator/index.js';
import { DefaultOpenAICompatibleProvider } from '../core/openaiContentGenerator/provider/index.js';
import type {
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';
import type { IDingtalkOAuth2Client } from './dingtalkOAuth2.js';
import { SharedTokenManager } from './sharedTokenManager.js';
import type { Config } from '../config/config.js';
import type { ContentGeneratorConfig } from '../core/contentGenerator.js';

const DEFAULT_DINGTALK_BASE_URL = 'http://localhost:8080/v1';

export class DingtalkContentGenerator extends OpenAIContentGenerator {
  private dingtalkClient: IDingtalkOAuth2Client;
  private sharedManager: SharedTokenManager;
  private currentToken?: string;

  constructor(
    dingtalkClient: IDingtalkOAuth2Client,
    contentGeneratorConfig: ContentGeneratorConfig,
    cliConfig: Config,
  ) {
    const provider = new DefaultOpenAICompatibleProvider(
      contentGeneratorConfig,
      cliConfig,
    );
    super(contentGeneratorConfig, cliConfig, provider);

    this.dingtalkClient = dingtalkClient;
    this.sharedManager = SharedTokenManager.getInstance();

    if (contentGeneratorConfig?.baseUrl && contentGeneratorConfig?.apiKey) {
      this.pipeline.client.baseURL = contentGeneratorConfig.baseUrl;
      this.pipeline.client.apiKey = contentGeneratorConfig.apiKey;
    }
  }

  private getCurrentEndpoint(resourceUrl?: string): string {
    const baseEndpoint = resourceUrl || DEFAULT_DINGTALK_BASE_URL;
    const suffix = '/v1';
    const normalizedUrl = baseEndpoint.startsWith('http')
      ? baseEndpoint
      : `https://${baseEndpoint}`;
    return normalizedUrl.endsWith(suffix)
      ? normalizedUrl
      : `${normalizedUrl}${suffix}`;
  }

  private isAuthError(error: unknown): boolean {
    if (!error) return false;

    const errorMessage =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();

    const errorWithCode = error as {
      status?: number | string;
      code?: number | string;
    };
    const errorCode = errorWithCode?.status || errorWithCode?.code;

    return (
      errorCode === 401 ||
      errorCode === 403 ||
      errorCode === '401' ||
      errorCode === '403' ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('forbidden') ||
      errorMessage.includes('invalid api key') ||
      errorMessage.includes('invalid access token') ||
      errorMessage.includes('token expired') ||
      errorMessage.includes('authentication') ||
      errorMessage.includes('access denied') ||
      (errorMessage.includes('token') && errorMessage.includes('expired'))
    );
  }

  private async getValidToken(): Promise<{ token: string; endpoint: string }> {
    try {
      const credentials = await this.sharedManager.getValidCredentials(
        this.dingtalkClient,
      );
      if (!credentials.access_token) {
        throw new Error('No access token available');
      }
      return {
        token: credentials.access_token,
        endpoint: this.getCurrentEndpoint(credentials.resource_url),
      };
    } catch (error) {
      if (this.isAuthError(error)) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      console.warn('Failed to get token from shared manager:', error);
      throw new Error(
        'Failed to obtain valid Dingtalk access token. Please re-authenticate.',
      );
    }
  }

  private async executeWithCredentialManagement<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const attemptOperation = async (): Promise<T> => {
      const { token, endpoint } = await this.getValidToken();
      this.pipeline.client.apiKey = token;
      this.pipeline.client.baseURL = endpoint;
      return await operation();
    };

    try {
      return await attemptOperation();
    } catch (error) {
      if (this.isAuthError(error)) {
        await this.sharedManager.getValidCredentials(this.dingtalkClient, true);
        return await attemptOperation();
      }
      throw error;
    }
  }

  override async generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse> {
    return this.executeWithCredentialManagement(() =>
      super.generateContent(request, userPromptId),
    );
  }

  override async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    return this.executeWithCredentialManagement(() =>
      super.generateContentStream(request, userPromptId),
    );
  }

  override async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    return this.executeWithCredentialManagement(() =>
      super.embedContent(request),
    );
  }

  override async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    return super.countTokens(request);
  }

  getCurrentToken(): string | null {
    if (this.currentToken) {
      return this.currentToken;
    }
    const credentials = this.sharedManager.getCurrentCredentials();
    return credentials?.access_token || null;
  }

  clearToken(): void {
    this.currentToken = undefined;
    this.sharedManager.clearCache();
  }
}
