import type { Response } from 'express';
import type { MobileWalletProviderId } from './mobileWalletDeepLinkStore';

const MOBILE_WALLET_HANDOFF_ERROR_MESSAGES: Record<string, string> = {
  wallet_denied: 'The wallet request was canceled.',
  wallet_conflict: 'That wallet is already linked to another profile.',
  wallet_expired: 'The wallet connection expired.',
  wallet_invalid_signature: 'The wallet signature could not be verified.',
  wallet_unavailable: 'Wallet sign-in is temporarily unavailable.',
  wallet_failed: 'Wallet sign-in failed.',
};

export interface MobileWalletHandoffPageInput {
  success: boolean;
  providerId: MobileWalletProviderId;
  errorCode?: string;
}

export interface MobileWalletHandoffResponse {
  action: 'handoff';
  status: 'success' | 'error';
  providerId: MobileWalletProviderId;
  errorCode?: string;
}

export function buildMobileWalletHandoffResponse(
  input: MobileWalletHandoffPageInput
): MobileWalletHandoffResponse {
  return {
    action: 'handoff',
    status: input.success ? 'success' : 'error',
    providerId: input.providerId,
    ...(!input.success && input.errorCode ? { errorCode: input.errorCode } : {}),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildMobileWalletHandoffPage(input: MobileWalletHandoffPageInput): string {
  const title = 'Return to Slop Heroes';
  const walletName = input.providerId === 'solflare' ? 'Solflare' : 'Phantom';
  const status = input.success ? 'Wallet connected' : 'Wallet sign-in didn’t finish';
  const icon = input.success ? '&#10003;' : '&#10007;';
  const detail = input.success
    ? `Your sign-in is complete. Close ${walletName}, then open Slop Heroes from your Home Screen.`
    : `${MOBILE_WALLET_HANDOFF_ERROR_MESSAGES[input.errorCode ?? ''] ?? MOBILE_WALLET_HANDOFF_ERROR_MESSAGES.wallet_failed} Close ${walletName}, then open Slop Heroes from your Home Screen to try again.`;
  const note = input.success
    ? 'You are already logged in. No other action is needed in this browser.'
    : 'This browser cannot return you to the installed app automatically.';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Slop Heroes</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  html, body { width: 100%; min-height: 100%; }
  body { margin: 0; min-height: 100vh; min-height: 100svh; overflow: hidden; color: #f8fafc;
    background: #05070b; text-align: center; }
  body::before { content: ""; position: fixed; inset: 0; pointer-events: none;
    background: radial-gradient(circle at 50% 20%, ${input.success ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'} 0, transparent 42%),
      linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
    background-size: auto, 28px 28px, 28px 28px; }
  .overlay { position: fixed; inset: 0; display: grid; place-items: center; overflow-y: auto;
    padding: max(20px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
      max(20px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    background: rgba(1, 3, 7, 0.66); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
  .dialog { position: relative; display: flex; width: min(100%, 680px); min-height: min(72svh, 620px);
    flex-direction: column; align-items: center; justify-content: center; padding: clamp(32px, 8vw, 72px);
    overflow: hidden; border: 2px solid ${input.success ? 'rgba(74, 222, 128, 0.46)' : 'rgba(248, 113, 113, 0.46)'};
    border-radius: 28px; background: linear-gradient(155deg, rgba(23, 28, 38, 0.98), rgba(8, 11, 17, 0.99));
    box-shadow: 0 32px 100px rgba(0, 0, 0, 0.72), inset 0 1px rgba(255, 255, 255, 0.08); }
  .dialog::after { content: ""; position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(115deg, rgba(255, 255, 255, 0.055), transparent 30%); }
  .icon { display: grid; width: clamp(88px, 24vw, 116px); height: clamp(88px, 24vw, 116px);
    place-items: center; margin-bottom: 26px; border: 2px solid ${input.success ? 'rgba(74, 222, 128, 0.55)' : 'rgba(248, 113, 113, 0.55)'};
    border-radius: 999px; background: ${input.success ? 'rgba(34, 197, 94, 0.13)' : 'rgba(239, 68, 68, 0.13)'};
    color: ${input.success ? '#4ade80' : '#f87171'}; font-size: clamp(42px, 12vw, 58px); font-weight: 800; line-height: 1; }
  .status { margin: 0 0 12px; color: ${input.success ? '#86efac' : '#fca5a5'}; font-size: 13px;
    font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; }
  h1 { max-width: 560px; margin: 0; font-size: clamp(36px, 10vw, 64px); font-weight: 900;
    letter-spacing: -0.045em; line-height: 0.98; text-transform: uppercase; text-wrap: balance; }
  .detail { max-width: 520px; margin: 28px 0 0; color: #dbe4f0; font-size: clamp(18px, 4.8vw, 23px);
    font-weight: 650; line-height: 1.45; text-wrap: balance; }
  .steps { display: grid; width: min(100%, 500px); gap: 10px; margin-top: 30px; text-align: left; }
  .step { display: flex; align-items: center; gap: 14px; padding: 13px 16px; border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 14px; background: rgba(255, 255, 255, 0.045); color: #f8fafc; font-size: 16px; font-weight: 700; }
  .step-number { display: grid; width: 30px; height: 30px; flex: 0 0 30px; place-items: center; border-radius: 9px;
    background: rgba(255, 255, 255, 0.1); color: #fff; font-size: 14px; }
  .note { max-width: 500px; margin: 22px 0 0; color: #94a3b8; font-size: 14px; line-height: 1.5; text-wrap: balance; }
  @media (max-height: 690px) {
    .dialog { min-height: auto; padding-top: 28px; padding-bottom: 28px; }
    .icon { width: 72px; height: 72px; margin-bottom: 18px; font-size: 36px; }
    .detail { margin-top: 18px; }
    .steps { margin-top: 20px; }
    .note { margin-top: 16px; }
  }
</style>
</head>
<body>
<main class="overlay">
  <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="handoff-title" aria-describedby="handoff-detail handoff-note">
    <div class="icon" aria-hidden="true">${icon}</div>
    <p class="status">${escapeHtml(status)}</p>
    <h1 id="handoff-title">${escapeHtml(title)}</h1>
    <p class="detail" id="handoff-detail">${escapeHtml(detail)}</p>
    <div class="steps" aria-label="How to return to Slop Heroes">
      <div class="step"><span class="step-number">1</span><span>Close this ${escapeHtml(walletName)} browser</span></div>
      <div class="step"><span class="step-number">2</span><span>Open Slop Heroes from your Home Screen</span></div>
    </div>
    <p class="note" id="handoff-note">${escapeHtml(note)}</p>
  </section>
</main>
</body>
</html>`;
}

export function renderMobileWalletHandoffPage(
  res: Response,
  input: MobileWalletHandoffPageInput
): void {
  res
    .status(input.success ? 200 : 400)
    .type('html')
    .send(buildMobileWalletHandoffPage(input));
}
