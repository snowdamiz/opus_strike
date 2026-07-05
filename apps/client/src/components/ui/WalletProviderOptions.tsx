import type { WalletProviderSummary } from '../../contexts/WalletContext';
import { WalletProviderLogo } from './WalletProviderLogo';

interface WalletProviderOption {
  id?: string;
  name: string;
  installed: boolean;
}

interface WalletProviderOptionsProps {
  walletProviders: WalletProviderSummary[];
  isConnecting: boolean;
  onSelect: (providerId?: string) => Promise<void> | void;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  iconClassName?: string;
  logoClassName?: string;
  showLabels?: boolean;
  showSpinner?: boolean;
}

function WalletOptionSpinner() {
  return (
    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function WalletProviderOptions({
  walletProviders,
  isConnecting,
  onSelect,
  disabled = false,
  className = 'login-wallet-options',
  buttonClassName = 'login-provider-button login-provider-button-wallet',
  iconClassName = 'login-provider-icon',
  logoClassName = 'login-provider-logo',
  showLabels = true,
  showSpinner = true,
}: WalletProviderOptionsProps) {
  if (walletProviders.length === 0) {
    return (
      <div className={className} role="status">
        <span className="wallet-provider-empty-message">No Solana wallets detected.</span>
      </div>
    );
  }

  return (
    <div className={className}>
      {walletProviders.map((wallet) => (
        <WalletProviderOptionButton
          key={wallet.id}
          wallet={wallet}
          disabled={disabled || isConnecting}
          isConnecting={isConnecting}
          showLabels={showLabels}
          showSpinner={showSpinner}
          buttonClassName={buttonClassName}
          iconClassName={iconClassName}
          logoClassName={logoClassName}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function WalletProviderOptionButton({
  wallet,
  disabled,
  isConnecting,
  showLabels,
  showSpinner,
  buttonClassName,
  iconClassName,
  logoClassName,
  onSelect,
}: {
  wallet: WalletProviderOption;
  disabled: boolean;
  isConnecting: boolean;
  showLabels: boolean;
  showSpinner: boolean;
  buttonClassName: string;
  iconClassName: string;
  logoClassName: string;
  onSelect: (providerId?: string) => Promise<void> | void;
}) {
  const label = wallet.name;
  const detail = wallet.installed ? 'Sign message' : 'Open wallet app';

  return (
    <button
      type="button"
      onClick={() => onSelect(wallet.id)}
      disabled={disabled}
      data-busy={isConnecting ? 'true' : undefined}
      className={buttonClassName}
      title={`${label}: ${detail}`}
      aria-label={`${label}: ${detail}`}
    >
      <span className={iconClassName}>
        {isConnecting && showSpinner ? (
          <WalletOptionSpinner />
        ) : (
          <WalletProviderLogo wallet={wallet} className={logoClassName} />
        )}
      </span>
      {showLabels && (
        <span className="login-provider-copy">
          <span>{label}</span>
          <span>{detail}</span>
        </span>
      )}
    </button>
  );
}
