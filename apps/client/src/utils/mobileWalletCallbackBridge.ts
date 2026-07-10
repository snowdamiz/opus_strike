export type MobileWalletHandoffStatus = 'success' | 'error';
export type MobileWalletHandoffProviderId = 'phantom' | 'solflare';

export type MobileWalletCallbackBridgeResponse =
  | { action: 'redirect'; url: string }
  | { action: 'complete'; returnTo: string }
  | { action: 'error'; returnTo: string }
  | {
      action: 'handoff';
      status: MobileWalletHandoffStatus;
      providerId: MobileWalletHandoffProviderId;
      errorCode?: string;
    };

export function parseMobileWalletCallbackBridgeResponse(
  value: unknown
): MobileWalletCallbackBridgeResponse | null {
  if (!value || typeof value !== 'object') return null;

  const payload = value as Record<string, unknown>;
  if (payload.action === 'redirect' && typeof payload.url === 'string') {
    return { action: 'redirect', url: payload.url };
  }

  if (
    (payload.action === 'complete' || payload.action === 'error')
    && typeof payload.returnTo === 'string'
  ) {
    return { action: payload.action, returnTo: payload.returnTo };
  }

  if (
    payload.action === 'handoff'
    && (payload.status === 'success' || payload.status === 'error')
    && (payload.providerId === 'phantom' || payload.providerId === 'solflare')
    && (payload.errorCode === undefined || typeof payload.errorCode === 'string')
  ) {
    return {
      action: 'handoff',
      status: payload.status,
      providerId: payload.providerId,
      ...(typeof payload.errorCode === 'string' ? { errorCode: payload.errorCode } : {}),
    };
  }

  return null;
}
