/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';
import {
  AuthType,
  qwenOAuth2Events,
  QwenOAuth2Event,
  type DeviceAuthorizationData,

  dingtalkOAuth2Events,
  DingtalkOAuth2Event,
  type DeviceAuthorizationData as DingtalkDeviceAuthorizationData} from '@qwen-code/qwen-code-core';

export interface QwenAuthState {
  deviceAuth:
    | (DeviceAuthorizationData | DingtalkDeviceAuthorizationData)
    | null;
  authStatus:
    | 'idle'
    | 'polling'
    | 'success'
    | 'error'
    | 'timeout'
    | 'rate_limit';
  authMessage: string | null;
}

export const useQwenAuth = (
  pendingAuthType: AuthType | undefined,
  isAuthenticating: boolean,
) => {
  const [qwenAuthState, setQwenAuthState] = useState<QwenAuthState>({
    deviceAuth: null,
    authStatus: 'idle',
    authMessage: null,
  });

  const isDeviceAuth =
    pendingAuthType === AuthType.QWEN_OAUTH ||
    pendingAuthType === AuthType.DINGTALK_OAUTH;

  const emitter =
    pendingAuthType === AuthType.DINGTALK_OAUTH
      ? dingtalkOAuth2Events
      : qwenOAuth2Events;
  const eventEnum =
    pendingAuthType === AuthType.DINGTALK_OAUTH
      ? DingtalkOAuth2Event
      : QwenOAuth2Event;

  // Set up event listeners when authentication starts
  useEffect(() => {
    if (!isDeviceAuth || !isAuthenticating) {
      // Reset state when not authenticating or not Qwen auth
      setQwenAuthState({
        deviceAuth: null,
        authStatus: 'idle',
        authMessage: null,
      });
      return;
    }

    setQwenAuthState((prev) => ({
      ...prev,
      authStatus: 'idle',
    }));

    // Set up event listeners
    const handleDeviceAuth = (deviceAuth: DeviceAuthorizationData) => {
      setQwenAuthState((prev) => ({
        ...prev,
        deviceAuth: {
          verification_uri: deviceAuth.verification_uri,
          verification_uri_complete: deviceAuth.verification_uri_complete,
          user_code: deviceAuth.user_code,
          expires_in: deviceAuth.expires_in,
          device_code: deviceAuth.device_code,
        },
        authStatus: 'polling',
      }));
    };

    const handleAuthProgress = (
      status: 'success' | 'error' | 'polling' | 'timeout' | 'rate_limit',
      message?: string,
    ) => {
      setQwenAuthState((prev) => ({
        ...prev,
        authStatus: status,
        authMessage: message || null,
      }));
    };

    // Add event listeners
    emitter.on(eventEnum.AuthUri, handleDeviceAuth);
    emitter.on(eventEnum.AuthProgress, handleAuthProgress);

    // Cleanup event listeners when component unmounts or auth finishes
    return () => {
      emitter.off(eventEnum.AuthUri, handleDeviceAuth);
      emitter.off(eventEnum.AuthProgress, handleAuthProgress);
    };
  }, [isDeviceAuth, isAuthenticating, emitter, eventEnum]);

  const cancelQwenAuth = useCallback(() => {
    emitter.emit(eventEnum.AuthCancel);

    setQwenAuthState({
      deviceAuth: null,
      authStatus: 'idle',
      authMessage: null,
    });
  }, [emitter, eventEnum]);

  return {
    qwenAuthState,
    cancelQwenAuth,
  };
};
