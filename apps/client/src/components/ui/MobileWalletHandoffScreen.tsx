import type {
  MobileWalletHandoffProviderId,
  MobileWalletHandoffStatus,
} from '../../utils/mobileWalletCallbackBridge';

interface MobileWalletHandoffScreenProps {
  status: MobileWalletHandoffStatus;
  providerId: MobileWalletHandoffProviderId;
  errorCode?: string;
}

const HANDOFF_ERROR_MESSAGES: Record<string, string> = {
  wallet_denied: 'The wallet request was canceled.',
  wallet_conflict: 'That wallet is already linked to another profile.',
  wallet_expired: 'The wallet connection expired.',
  wallet_invalid_signature: 'The wallet signature could not be verified.',
  wallet_unavailable: 'Wallet sign-in is temporarily unavailable.',
  wallet_failed: 'Wallet sign-in failed.',
};

export function getMobileWalletHandoffCopy({
  status,
  providerId,
  errorCode,
}: MobileWalletHandoffScreenProps) {
  const walletName = providerId === 'solflare' ? 'Solflare' : 'Phantom';
  const success = status === 'success';
  const errorMessage = HANDOFF_ERROR_MESSAGES[errorCode ?? ''] ?? HANDOFF_ERROR_MESSAGES.wallet_failed;

  return {
    walletName,
    statusLabel: success ? 'Wallet connected' : 'Wallet sign-in didn’t finish',
    detail: success
      ? `Your sign-in is complete. Close ${walletName}, then open Slop Heroes from your Home Screen.`
      : `${errorMessage} Close ${walletName}, then open Slop Heroes from your Home Screen to try again.`,
    note: success
      ? 'You are already logged in. No other action is needed in this browser.'
      : 'This browser cannot return you to the installed app automatically.',
  };
}

export function MobileWalletHandoffScreen(props: MobileWalletHandoffScreenProps) {
  const copy = getMobileWalletHandoffCopy(props);

  return (
    <main className="mobile-wallet-handoff-screen" data-status={props.status}>
      <section
        className="mobile-wallet-handoff-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-wallet-handoff-title"
        aria-describedby="mobile-wallet-handoff-detail mobile-wallet-handoff-note"
      >
        <div className="mobile-wallet-handoff-app-icon-wrap" aria-hidden="true">
          <img className="mobile-wallet-handoff-app-icon" src="/icons/icon-192.png" alt="" />
          <span className="mobile-wallet-handoff-status-icon">
            {props.status === 'success' ? '✓' : '×'}
          </span>
        </div>

        <p className="mobile-wallet-handoff-status">{copy.statusLabel}</p>
        <h1 id="mobile-wallet-handoff-title">Return to Slop Heroes</h1>
        <p className="mobile-wallet-handoff-detail" id="mobile-wallet-handoff-detail">
          {copy.detail}
        </p>

        <div className="mobile-wallet-handoff-steps" aria-label="How to return to Slop Heroes">
          <div className="mobile-wallet-handoff-step">
            <span className="mobile-wallet-handoff-step-number">1</span>
            <span>Close this {copy.walletName} browser</span>
          </div>
          <div className="mobile-wallet-handoff-step">
            <span className="mobile-wallet-handoff-step-number">2</span>
            <span>Open Slop Heroes from your Home Screen</span>
          </div>
        </div>

        <p className="mobile-wallet-handoff-note" id="mobile-wallet-handoff-note">
          {copy.note}
        </p>
      </section>
    </main>
  );
}
