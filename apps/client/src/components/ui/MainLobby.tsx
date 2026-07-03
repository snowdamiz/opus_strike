import { lazy, Suspense, type CSSProperties, useCallback, useMemo, useState, useEffect, useRef } from 'react';
import type { Transaction } from '@solana/web3.js';
import { useShallow } from 'zustand/shallow';
import { useGameStore } from '../../store/gameStore';
import {
  arePartyMembersReady,
  getPartyMember,
  isPartyLeader as isPartyLeaderForUser,
  usePartyStore,
} from '../../store/partyStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useNetwork, type RankedTokenHoldStatus } from '../../contexts/NetworkContext';
import { useWallet, type WalletProviderSummary } from '../../contexts/WalletContext';
import {
  buildSkinPurchaseTransaction,
  createSkinPurchaseIntent,
  getSkinPurchaseIntent,
  requestRewardEconomy,
  requestSkinCatalog,
  submitSignedSkinPurchaseTransaction,
  updateHeroSkinLoadout,
} from '../../contexts/networkApi';
import { GameDialog } from './GameDialog';
import { GlobalChat } from './GlobalChat';
import { DailyMissionTracker } from './DailyMissionTracker';
import type { HeroPreviewAnimationMode } from './HeroPreviewCanvas';
import { LobbyBackdrop } from './LobbyBackdrop';
import { SocialBox, SocialButton, useSocialBadgeCount } from './SocialBox';
import { TopNavIconButton } from './TopNavIconButton';
import { HeroIcon } from './HeroIcons';
import { WalletProviderLogo } from './WalletProviderLogo';
import { WalletProviderOptions } from './WalletProviderOptions';
import { useUISounds } from '../../hooks/useUiAudio';
import { useMobileDevice } from '../../hooks/useDeviceCapabilities';
import { useServerLatencyProbe } from '../../hooks/useServerLatencyProbe';
import { config } from '../../config/environment';
import {
  ALL_HERO_IDS,
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_MATCH_PERSPECTIVE,
  DEFAULT_RANKED_SEASON_NUMBER,
  GAMEPLAY_MODES,
  HERO_DEFINITIONS,
  RANKED_GAMEPLAY_MODE,
  getDefaultHeroSkinId,
  getMatchPerspectiveSettingMode,
  getGameplayModeLabel,
  getPartyMaxMembersForMode,
  getHumanPartyHeroIds,
  hasDuplicatePartyHeroes,
  isCustomLobbyGameplayMode,
  getRankedSeasonLabel,
  requiresUniquePartyHeroes,
} from '@voxel-strike/shared';
import type {
  CustomLobbyGameplayMode,
  GameplayMode,
  HeroId,
  MatchPerspective,
  MatchPerspectiveSettingMode,
  MatchPerspectiveSettings,
  PartyMemberSnapshot,
  PartyMode,
  PartyStateSnapshot,
  RankedSeasonSnapshot,
  HeroSkinCatalogItem,
  HeroSkinCatalogResponse,
  HeroSkinId,
  SkinPurchaseIntentSnapshot,
} from '@voxel-strike/shared';
import { BLAZE_UI_COLORS, DISCORD_AUTH_COLORS, WALLET_AUTH_COLORS } from '../../styles/colorTokens';
import { usePwaInstallPrompt } from '../../pwa';
import { PwaInstallToast } from './PwaInstallToast';
import { getEarningRules, rewardTokenTicker, type RewardEconomy } from './earningRules';
import {
  RUNNING_GAME_SESSION_EVENT,
  RUNNING_GAME_SESSION_STORAGE_KEY,
  type RunningGameSession,
} from '../../utils/runningGameSession';
import { clearActivePartySession, loadActivePartySession } from '../../utils/activePartySession';
import {
  PLAY_MODE_OPTIONS,
  DEFAULT_CUSTOM_GAMEPLAY_MODE,
  createGlobalBotFillSettings,
  isGlobalBotFillEnabled,
  loadPlayMenuPreferences,
  savePlayMenuPreferences,
  type PlayMenuMode,
  type PlayMenuPreferences,
} from '../../utils/playMenuPreferences';
import type { ServerLatencyProbeSnapshot } from '../../utils/serverLatency';
import { requiresTutorial } from '../../utils/tutorialAccess';
import { formatCompactTokenAmount, formatTokenBaseUnits } from '../../utils/tokenAmountFormat';
import { RankIcon, getRankForStats } from './RankBadge';
import { SkinRarityChrome } from './SkinRarityChrome';

const FeaturedHeroPreview = lazy(() => import('./FeaturedHeroPreview').then((module) => ({
  default: module.FeaturedHeroPreview,
})));
const HeroesPage = lazy(() => import('./HeroesPage').then((module) => ({ default: module.HeroesPage })));
const LoadoutTab = lazy(() => import('./LoadoutTab').then((module) => ({ default: module.LoadoutTab })));
const StatsPage = lazy(() => import('./StatsPage').then((module) => ({ default: module.StatsPage })));
const loadSettingsModalModule = () => import('./SettingsModal');
const SettingsModal = lazy(() => loadSettingsModalModule().then((module) => ({ default: module.SettingsModal })));
const HeroPreviewCanvas = lazy(() => import('./HeroPreviewCanvas').then((module) => ({ default: module.HeroPreviewCanvas })));
const HERO_IDLE_ANIMATION_MODE: HeroPreviewAnimationMode = 'idle';
const PLAY_MODE_OPTIONS_BEFORE_BOT_FILL = PLAY_MODE_OPTIONS.filter((mode) => mode !== 'practice' && mode !== 'custom');
const PLAY_MODE_OPTIONS_AFTER_BOT_FILL = PLAY_MODE_OPTIONS.filter((mode) => mode === 'practice' || mode === 'custom');
const PLAY_PARTY_SLOT_COUNT = getPartyMaxMembersForMode('quick_play', DEFAULT_GAMEPLAY_MODE);
const PING_ADVISORY_VISIBLE_MIN_MS = 100;
const EMPTY_HERO_ID_SET = new Set<HeroId>();
const PURCHASE_STATUS_POLL_MS = 1800;
const PURCHASE_STATUS_POLL_ATTEMPTS = 6;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function transactionFromBase64(base64: string): Promise<Transaction> {
  const { Transaction } = await import('@solana/web3.js');
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return Transaction.from(bytes);
}

async function waitForCreditedPurchase(intent: SkinPurchaseIntentSnapshot): Promise<SkinPurchaseIntentSnapshot> {
  let latest = intent;
  for (
    let attempt = 0;
    attempt < PURCHASE_STATUS_POLL_ATTEMPTS && latest.status === 'submitted';
    attempt += 1
  ) {
    await sleep(PURCHASE_STATUS_POLL_MS);
    latest = await getSkinPurchaseIntent(latest.intentId);
  }
  return latest;
}

function DiscordIcon({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.54 5.34A18.2 18.2 0 0015.02 4c-.2.36-.42.84-.58 1.22a16.9 16.9 0 00-5.01 0A11.7 11.7 0 008.84 4c-1.6.27-3.12.72-4.52 1.34C1.46 9.6.68 13.74 1.07 17.81A18.5 18.5 0 006.61 20.6c.45-.61.84-1.26 1.18-1.95-.65-.24-1.27-.54-1.86-.89.16-.12.31-.24.46-.36a13.05 13.05 0 0011.14 0l.46.36c-.6.35-1.22.65-1.87.89.34.69.74 1.34 1.18 1.95a18.43 18.43 0 005.55-2.79c.46-4.72-.78-8.82-3.31-12.47zM8.52 15.3c-1.08 0-1.97-.99-1.97-2.2 0-1.22.87-2.2 1.97-2.2 1.1 0 1.99.99 1.97 2.2 0 1.21-.87 2.2-1.97 2.2zm6.96 0c-1.08 0-1.97-.99-1.97-2.2 0-1.22.87-2.2 1.97-2.2 1.1 0 1.99.99 1.97 2.2 0 1.21-.87 2.2-1.97 2.2z" />
    </svg>
  );
}

function LoginIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M15.75 8.75V6.5A2.5 2.5 0 0013.25 4h-6.5A2.5 2.5 0 004.25 6.5v11A2.5 2.5 0 006.75 20h6.5a2.5 2.5 0 002.5-2.5v-2.25" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M10.5 12h8.25m0 0l-3-3m3 3l-3 3" />
    </svg>
  );
}

function DiscordSignInButton({
  onClick,
  className = '',
  iconClassName = 'h-5 w-5 sm:h-6 sm:w-6',
  label = 'CONTINUE WITH DISCORD',
}: {
  onClick: () => void;
  className?: string;
  iconClassName?: string;
  label?: string;
}) {
  const discordButtonStyle = {
    '--discord-auth-base': DISCORD_AUTH_COLORS.base,
    '--discord-auth-hover': DISCORD_AUTH_COLORS.hover,
    borderColor: DISCORD_AUTH_COLORS.border,
    boxShadow: DISCORD_AUTH_COLORS.glow,
  } as CSSProperties;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden border bg-[var(--discord-auth-base)] text-white hover:bg-[var(--discord-auth-hover)] ${className}`}
      style={discordButtonStyle}
    >
      <span
        className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: DISCORD_AUTH_COLORS.shimmer }}
      />
      <span className="relative flex items-center justify-center gap-2.5">
        <DiscordIcon className={iconClassName} />
        {label}
      </span>
    </button>
  );
}

function LoginButton({
  onClick,
  className = '',
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`play-main-cta play-main-cta-login group ${className}`}
      style={{
        background: `linear-gradient(135deg, ${BLAZE_UI_COLORS.primary}, ${BLAZE_UI_COLORS.secondary})`,
        boxShadow: `0 0 60px ${BLAZE_UI_COLORS.primary}40, inset 0 1px 0 rgba(255,255,255,0.22)`,
      }}
    >
      <span
        className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: WALLET_AUTH_COLORS.shimmer }}
      />
      <span className="play-main-cta-content relative flex items-center justify-center gap-2">
        <LoginIcon className="h-5 w-5 sm:h-6 sm:w-6" />
        LOGIN
      </span>
    </button>
  );
}

function LoginDialog({
  walletProviders,
  isConnecting,
  authError,
  onDiscordSignIn,
  onWalletSignIn,
  onClose,
}: {
  walletProviders: WalletProviderSummary[];
  isConnecting: boolean;
  authError: string | null;
  onDiscordSignIn: () => void;
  onWalletSignIn: (providerId?: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <GameDialog
      title="LOGIN"
      icon={<LoginIcon />}
      iconClassName="login-dialog-title-icon"
      size="sm"
      onClose={onClose}
      panelClassName="login-dialog-panel"
      bodyClassName="login-dialog-body"
    >
      <div className="login-provider-stack">
        <DiscordSignInButton
          onClick={onDiscordSignIn}
          className="login-provider-button login-provider-button-discord group"
          iconClassName="h-5 w-5"
        />

        <div className="login-wallet-section">
          <div className="login-wallet-section-header">
            <span>Wallet</span>
            <span>{walletProviders.length > 0 ? 'Detected' : 'Not detected'}</span>
          </div>
          <WalletProviderOptions
            walletProviders={walletProviders}
            isConnecting={isConnecting}
            onSelect={onWalletSignIn}
          />
        </div>

        {authError && (
          <div className="login-dialog-error" role="status">
            {authError}
          </div>
        )}
      </div>
    </GameDialog>
  );
}

function SlopHeroesMark({ className }: { className?: string }) {
  return (
    <img
      className={className}
      src="/voxel.svg"
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

// Navigation tabs
const MAIN_TABS = ['play', 'heroes', 'loadout', 'skins', 'stats'] as const;
const SLOP_HEROES_X_URL = 'https://x.com/slopheroes';
type MainTab = (typeof MAIN_TABS)[number];
const DEFAULT_RANKED_SEASON: RankedSeasonSnapshot = {
  mode: 'season',
  seasonNumber: DEFAULT_RANKED_SEASON_NUMBER,
  label: getRankedSeasonLabel({ mode: 'season', seasonNumber: DEFAULT_RANKED_SEASON_NUMBER }),
  endsAt: null,
};
const SEASON_RULES_ARIA = 'Season rewards and ranked history are tracked by season.';

function ContractAddressBadge({ address }: { address: string }) {
  return (
    <div
      className="main-lobby-ca-badge"
      aria-label={`Contract address ${address}`}
      title={address}
    >
      <span className="main-lobby-ca-label">CA</span>
      <span className="main-lobby-ca-address">{address}</span>
    </div>
  );
}

function XSocialIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M14.56 10.6 22.08 2h-1.78l-6.53 7.46L8.56 2H2.55l7.89 11.29L2.55 22h1.78l6.9-7.88L16.74 22h6.01l-8.19-11.4Zm-2.44 2.79-.8-1.12L4.96 3.31h2.75l5.13 7.23.8 1.12 6.67 9.4h-2.75l-5.44-7.67Z" />
    </svg>
  );
}

function XProfileLink({ onActivate }: { onActivate: () => void }) {
  return (
    <a
      className="main-lobby-x-link"
      href={SLOP_HEROES_X_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Open @slopheroes on X"
      title="@slopheroes on X"
      onClick={onActivate}
    >
      <XSocialIcon className="h-5 w-5" />
    </a>
  );
}

function rankedTokenHoldRequirement(status: RankedTokenHoldStatus): string {
  const symbol = rewardTokenTicker(status.tokenSymbol);
  const fallbackAmount = status.requiredTokenAmount || '0';
  const amount = formatCompactTokenAmount(status.requiredTokenAmount, fallbackAmount);
  return `${amount} ${symbol ?? 'tokens'} hold`;
}

function rankedTokenGateBlockedMessage(status: RankedTokenHoldStatus): string {
  if (status.mode === 'locked') return status.lockedReason ?? 'Ranked is locked';
  return `Ranked requires ${rankedTokenHoldRequirement(status)}`;
}

function getSeasonBoundaryDate(season: RankedSeasonSnapshot): Date | null {
  if (!season.endsAt) return null;
  const date = new Date(season.endsAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatSeasonBoundaryDate(season: RankedSeasonSnapshot): string {
  const fallback = season.mode === 'preseason' ? 'Opens TBA' : 'Ends TBA';
  const date = getSeasonBoundaryDate(season);
  if (!date) return fallback;
  const formattedDate = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return season.mode === 'preseason' ? `Opens ${formattedDate}` : `Ends ${formattedDate}`;
}

function shouldShowSeasonRewardsPlate(season: RankedSeasonSnapshot): boolean {
  return season.mode === 'season' && getSeasonBoundaryDate(season) !== null;
}

function getGameplayModeForPlayMode(
  mode: PlayMenuMode,
  customGameplayMode: CustomLobbyGameplayMode = DEFAULT_CUSTOM_GAMEPLAY_MODE
): GameplayMode {
  switch (mode) {
    case 'team_deathmatch':
      return 'team_deathmatch';
    case 'battle_royal':
      return 'battle_royal';
    case 'custom':
      return customGameplayMode;
    case 'ranked':
      return RANKED_GAMEPLAY_MODE;
    case 'practice':
    case 'quick_play':
    default:
      return DEFAULT_GAMEPLAY_MODE;
  }
}

function getPartyModeForPlayMode(mode: PlayMenuMode): PartyMode {
  if (mode === 'custom') return 'custom';
  return mode === 'team_deathmatch' || mode === 'battle_royal' ? 'quick_play' : mode;
}

function getPlayModeFromParty(party: PartyStateSnapshot): PlayMenuMode {
  if (party.selectedMode === 'custom') return 'custom';
  if (party.selectedMode === 'quick_play') {
    if (party.gameplayMode === 'team_deathmatch') return 'team_deathmatch';
    if (party.gameplayMode === 'battle_royal') return 'battle_royal';
  }
  return party.selectedMode;
}

function getPerspectiveSettingModeForPlayMode(mode: PlayMenuMode): MatchPerspectiveSettingMode | null {
  if (mode === 'ranked') return null;
  return getMatchPerspectiveSettingMode(getPartyModeForPlayMode(mode), getGameplayModeForPlayMode(mode));
}

function getMatchPerspectiveForPlayMode(
  mode: PlayMenuMode,
  settings: MatchPerspectiveSettings
): MatchPerspective {
  const modeKey = getPerspectiveSettingModeForPlayMode(mode);
  return modeKey ? settings[modeKey] : DEFAULT_MATCH_PERSPECTIVE;
}

function getPartyMemberLimitForPlayMode(
  mode: PlayMenuMode,
  gameplayMode: GameplayMode
): number {
  return getPartyMaxMembersForMode(getPartyModeForPlayMode(mode), gameplayMode);
}

function getBotFillUnavailableReasonForPlayMode(mode: PlayMenuMode): string | null {
  switch (mode) {
    case 'ranked':
      return 'Ranked uses automatic fill';
    case 'practice':
      return 'Bot fill does not apply to practice';
    case 'custom':
      return 'Bot fill does not apply to custom lobbies';
    case 'quick_play':
    case 'team_deathmatch':
    case 'battle_royal':
    default:
      return null;
  }
}

export function MainLobby() {
  const { playerName, isLoading, userStats, setAppPhase, setPlayerName: storeSetPlayerName, setUser, setWalletAddress } = useGameStore(
    useShallow((state) => ({
      playerName: state.playerName,
      isLoading: state.isLoading,
      userStats: state.userStats,
      setAppPhase: state.setAppPhase,
      setPlayerName: state.setPlayerName,
      setUser: state.setUser,
      setWalletAddress: state.setWalletAddress,
    }))
  );
  const {
    quickPlay,
    rankedPlay,
    getRankedTokenHoldStatus,
    startPracticeGame,
    startTutorialGame,
    ensureParty,
    joinParty,
    restoreParty,
    getActivePartySession,
    setPartyHero,
    setPartySkin,
    kickPartyMember,
    setPartyMode,
    setPartyBotFill,
    setPartyPerspective,
    setPartyReady,
    startParty,
    leaveParty,
    getRunningGameReconnect,
    reconnectRunningGame,
  } = useNetwork();
  const { playButtonClick } = useUISounds();
  const isMobileDevice = useMobileDevice();
  const pwaInstall = usePwaInstallPrompt();
  const {
    walletAddress,
    connectWallet,
    walletProviders,
    isConnected: isWalletConnected,
    isConnecting: isWalletConnecting,
    isAuthenticated,
    isNewUser,
    user,
    pendingRegistration,
    suggestedPlayerName,
    hasWalletAccount,
    logout,
    signInWithDiscord,
    signInWithWallet,
    linkWallet,
    signTransaction,
    registerUser,
    completeTutorial,
    error: authError,
    clearError,
    clearNotice,
  } = useWallet();

  const [activeTab, setActiveTab] = useState<MainTab>('play');
  const [error, setError] = useState<string | null>(null);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  const [featuredHero, setFeaturedHero] = useState<HeroId>('blaze');
  const [playMenuPreferences, setPlayMenuPreferences] = useState<PlayMenuPreferences>(loadPlayMenuPreferences);
  const [rankedTokenHoldStatus, setRankedTokenHoldStatus] = useState<RankedTokenHoldStatus | null>(null);
  const [isRankedTokenHoldLoading, setIsRankedTokenHoldLoading] = useState(false);
  const [rankedTokenHoldError, setRankedTokenHoldError] = useState<string | null>(null);
  const [rankedSeason, setRankedSeason] = useState<RankedSeasonSnapshot>(DEFAULT_RANKED_SEASON);
  const [rewardEconomy, setRewardEconomy] = useState<RewardEconomy | null>(null);
  const [skinCatalog, setSkinCatalog] = useState<HeroSkinCatalogResponse | null>(null);
  const [isSkinCatalogLoading, setIsSkinCatalogLoading] = useState(false);
  const [skinCatalogError, setSkinCatalogError] = useState<string | null>(null);
  const [skinActionBusyId, setSkinActionBusyId] = useState<HeroSkinId | null>(null);
  const [runningGameSession, setRunningGameSession] = useState<RunningGameSession | null>(null);
  const [isReconnectChecking, setIsReconnectChecking] = useState(false);
  const [isMobilePwaInstalling, setIsMobilePwaInstalling] = useState(false);
  const [isSkippingTutorial, setIsSkippingTutorial] = useState(false);
  const heroAnimationMode = HERO_IDLE_ANIMATION_MODE;

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLinkingWallet, setIsLinkingWallet] = useState(false);
  const autoJoinPartyAttemptRef = useRef<string | null>(null);
  const socialBadgeCount = useSocialBadgeCount();
  const { party, localPartyUserId, partyLaunchError } = usePartyStore(
    useShallow((state) => ({
      party: state.party,
      localPartyUserId: state.localUserId,
      partyLaunchError: state.launchError,
    }))
  );
  const localPartyMember = getPartyMember(party, localPartyUserId);
  const localPartyHeroId = localPartyMember?.heroId;
  const loadoutByHero = useMemo(() => new Map(
    (skinCatalog?.loadouts ?? []).map((loadout) => [loadout.heroId, loadout.skinId])
  ), [skinCatalog]);
  const selectedSkinId = (
    localPartyMember?.skinId
    ?? loadoutByHero.get(featuredHero)
    ?? getDefaultHeroSkinId(featuredHero)
  ) as HeroSkinId;
  const skinsForFeaturedHero = useMemo(
    () => (skinCatalog?.skins ?? []).filter((skin) => skin.heroId === featuredHero),
    [featuredHero, skinCatalog]
  );
  const rewardTokenSymbol = rewardTokenTicker(
    rewardEconomy?.rewardTokenSymbol
    ?? rankedTokenHoldStatus?.tokenSymbol
  );
  const displayedContractAddress = rewardEconomy?.rankedEntryGate.tokenAddress
    || rankedTokenHoldStatus?.tokenAddress
    || null;
  const isInParty = Boolean(party);
  const isPartyLeader = isPartyLeaderForUser(party, localPartyUserId);
  const isPartyReadyToStart = arePartyMembersReady(party);
  const selectedPlayMode = playMenuPreferences.selectedPlayMode;
  const customGameplayMode = playMenuPreferences.customGameplayMode;
  const botFillEnabledByMode = playMenuPreferences.botFillEnabledByMode;
  const perspectiveByMode = playMenuPreferences.perspectiveByMode;
  const activePlayMode = party ? getPlayModeFromParty(party) : selectedPlayMode;
  const activeCustomGameplayMode = party?.selectedMode === 'custom' && isCustomLobbyGameplayMode(party.gameplayMode)
    ? party.gameplayMode
    : customGameplayMode;
  const activeBotFillEnabledByMode = party?.botFillEnabledByMode ?? botFillEnabledByMode;
  const globalBotFillEnabled = isGlobalBotFillEnabled(activeBotFillEnabledByMode);
  const botFillUnavailableReason = getBotFillUnavailableReasonForPlayMode(activePlayMode);
  const botFillDisabledReason = botFillUnavailableReason
    ? botFillUnavailableReason
    : isInParty && !isPartyLeader
      ? 'Party leader chooses bot fill'
      : null;
  const displayedBotFillEnabled = activePlayMode === 'ranked'
    ? true
    : botFillUnavailableReason
      ? false
      : globalBotFillEnabled;
  const activePerspectiveByMode = party?.perspectiveByMode ?? perspectiveByMode;

  useEffect(() => {
    const preloadSettings = () => {
      void loadSettingsModalModule().catch(() => undefined);
    };

    if (typeof requestIdleCallback !== 'undefined') {
      const idleId = requestIdleCallback(preloadSettings, { timeout: 1500 });
      return () => cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(preloadSettings, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);
  const currentRank = getRankForStats(userStats);
  const soloPartyMember: PartyMemberSnapshot | null = isAuthenticated
    ? {
        userId: user?.id ?? 'local-player',
        displayName: playerName || user?.name || 'Player',
        heroId: featuredHero,
        skinId: selectedSkinId,
        ready: false,
        connected: true,
        leader: true,
        isBot: false,
        rank: currentRank,
      }
    : null;
  const isRankedPreseason = rankedSeason.mode === 'preseason';
  const serverLatency = useServerLatencyProbe(activeTab === 'play');
  const devTutorialOverride = useSettingsStore((state) => state.settings.devTutorialOverride);
  const tutorialRequired = requiresTutorial(user?.tutorialCompletedAt, devTutorialOverride);
  const mobilePwaInstallRequired = isMobileDevice && !pwaInstall.hasDownloaded && !pwaInstall.isInstalled;

  const updatePlayMenuPreferences = useCallback((updater: (current: PlayMenuPreferences) => PlayMenuPreferences) => {
    setPlayMenuPreferences((current) => {
      const next = updater(current);
      savePlayMenuPreferences(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${config.serverHttpUrl}/auth/ranked-season`, {
      signal: controller.signal,
      credentials: 'include',
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Season request failed (${response.status})`)))
      .then((season: RankedSeasonSnapshot) => {
        setRankedSeason({
          mode: season.mode === 'preseason' ? 'preseason' : 'season',
          seasonNumber: Number.isFinite(season.seasonNumber) ? season.seasonNumber : DEFAULT_RANKED_SEASON.seasonNumber,
          label: season.label || getRankedSeasonLabel({
            mode: season.mode === 'preseason' ? 'preseason' : 'season',
            seasonNumber: season.seasonNumber,
          }),
          endsAt: season.endsAt ?? null,
        });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.warn('[MainLobby] Ranked season unavailable:', err);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    let mounted = true;
    let timeoutId: number | null = null;

    const loadRewardEconomy = async () => {
      try {
        const economy = await requestRewardEconomy();
        if (mounted) setRewardEconomy(economy);
      } catch (err) {
        if (mounted) console.warn('[MainLobby] Reward economy unavailable:', err);
      } finally {
        if (mounted) {
          timeoutId = window.setTimeout(loadRewardEconomy, 30_000);
        }
      }
    };

    void loadRewardEconomy();

    return () => {
      mounted = false;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, []);

  const loadSkinCatalog = useCallback(async () => {
    setIsSkinCatalogLoading(true);
    setSkinCatalogError(null);
    try {
      setSkinCatalog(await requestSkinCatalog());
    } catch (err) {
      setSkinCatalogError(err instanceof Error ? err.message : 'Failed to load skins');
    } finally {
      setIsSkinCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSkinCatalog();
  }, [isAuthenticated, loadSkinCatalog, user?.id, user?.walletAddress]);

  // Handle user authenticated - close modal and set user info
  useEffect(() => {
    if (isAuthenticated && user && !isNewUser) {
      storeSetPlayerName(user.name);
      setUser(user.id, user.name, user.stats);
      setWalletAddress(user.walletAddress ?? null);
      setShowProfileModal(false);
    }
  }, [isAuthenticated, user, isNewUser]);

  // Show name input for new users
  useEffect(() => {
    if (isAuthenticated && isNewUser) {
      setShowProfileModal(true);
      setNewPlayerName((currentName) => currentName || suggestedPlayerName);
    }
  }, [isAuthenticated, isNewUser, suggestedPlayerName]);

  useEffect(() => {
    if (!isAuthenticated) {
      setShowSocial(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (party) {
      autoJoinPartyAttemptRef.current = null;
    }
  }, [party?.partyId]);

  useEffect(() => {
    if (localPartyHeroId && localPartyHeroId !== featuredHero) {
      setFeaturedHero(localPartyHeroId);
    }
  }, [featuredHero, localPartyHeroId]);

  useEffect(() => {
    if (!isAuthenticated || isNewUser || !user || party) return;

    let cancelled = false;

    const resumeParty = async () => {
      const savedParty = loadActivePartySession();
      if (savedParty && savedParty.userId !== user.id) {
        clearActivePartySession(savedParty.partyId);
      }

      const activeParty = await getActivePartySession()
        .then((response) => response.party)
        .catch(() => null);

      if (cancelled) return;

      const validSavedParty = savedParty?.userId === user.id ? savedParty : null;
      const partyId = activeParty?.partyId ?? validSavedParty?.partyId ?? null;
      const persistentPartyId = activeParty?.persistentPartyId ?? null;
      if (!partyId && !persistentPartyId) return;

      const attemptKey = persistentPartyId ?? partyId;
      if (autoJoinPartyAttemptRef.current === attemptKey) return;
      autoJoinPartyAttemptRef.current = attemptKey;

      const rejoinName = playerName || user.name || validSavedParty?.playerName || 'Player';
      const heroId = validSavedParty?.heroId ?? featuredHero;
      const skinId = validSavedParty?.skinId ?? selectedSkinId;

      try {
        if (!partyId) throw new Error('Saved party room is unavailable');
        await joinParty(rejoinName, partyId, heroId, skinId);
      } catch {
        if (!persistentPartyId) {
          if (partyId) {
            clearActivePartySession(partyId);
          }
          if (autoJoinPartyAttemptRef.current === attemptKey) {
            autoJoinPartyAttemptRef.current = null;
          }
          return;
        }

        try {
          await restoreParty(rejoinName, persistentPartyId, heroId, skinId);
        } catch {
          if (partyId) {
            clearActivePartySession(partyId);
          }
          if (autoJoinPartyAttemptRef.current === attemptKey) {
            autoJoinPartyAttemptRef.current = null;
          }
        }
      }
    };

    void resumeParty();
    return () => {
      cancelled = true;
    };
  }, [
    featuredHero,
    getActivePartySession,
    isAuthenticated,
    isNewUser,
    joinParty,
    party,
    playerName,
    restoreParty,
    selectedSkinId,
    user?.id,
    user?.name,
  ]);

  useEffect(() => {
    if (activePlayMode !== 'ranked' || !isAuthenticated || isRankedPreseason) {
      setRankedTokenHoldStatus(null);
      setRankedTokenHoldError(null);
      setIsRankedTokenHoldLoading(false);
      return;
    }

    let isCurrent = true;
    setRankedTokenHoldStatus(null);
    setRankedTokenHoldError(null);
    setIsRankedTokenHoldLoading(true);

    getRankedTokenHoldStatus()
      .then((status) => {
        if (!isCurrent) return;
        setRankedTokenHoldStatus(status);
      })
      .catch((err) => {
        if (!isCurrent) return;
        setRankedTokenHoldError(err instanceof Error ? err.message : 'Failed to check ranked token holding');
      })
      .finally(() => {
        if (!isCurrent) return;
        setIsRankedTokenHoldLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [activePlayMode, getRankedTokenHoldStatus, isAuthenticated, isRankedPreseason, user?.walletAddress, walletAddress]);

  const refreshRunningGameReconnect = useCallback(() => {
    if (!isAuthenticated) {
      setRunningGameSession(null);
      setIsReconnectChecking(false);
      return;
    }

    let isCurrent = true;
    setIsReconnectChecking(true);

    getRunningGameReconnect()
      .then((status) => {
        if (!isCurrent) return;
        setRunningGameSession(status.available ? status.session : null);
      })
      .catch(() => {
        if (!isCurrent) return;
        setRunningGameSession(null);
      })
      .finally(() => {
        if (!isCurrent) return;
        setIsReconnectChecking(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [getRunningGameReconnect, isAuthenticated]);

  useEffect(() => {
    const cancelRefresh = refreshRunningGameReconnect();
    const handleSessionChanged = () => {
      refreshRunningGameReconnect();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === RUNNING_GAME_SESSION_STORAGE_KEY) {
        refreshRunningGameReconnect();
      }
    };

    window.addEventListener(RUNNING_GAME_SESSION_EVENT, handleSessionChanged);
    window.addEventListener('storage', handleStorage);

    return () => {
      cancelRefresh?.();
      window.removeEventListener(RUNNING_GAME_SESSION_EVENT, handleSessionChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, [refreshRunningGameReconnect]);

  const handleOpenLogin = useCallback(() => {
    clearError();
    clearNotice();
    setShowLoginDialog(true);
  }, [clearError, clearNotice]);

  const handleDiscordSignIn = () => {
    clearError();
    clearNotice();
    setShowLoginDialog(false);
    signInWithDiscord();
  };

  const handleWalletSignIn = useCallback(async (providerId?: string) => {
    clearError();
    clearNotice();
    try {
      await signInWithWallet(providerId);
      setShowLoginDialog(false);
    } catch {
      // WalletContext owns the user-facing error message.
    }
  }, [clearError, clearNotice, signInWithWallet]);

  const handleRegister = async () => {
    if (!newPlayerName.trim()) {
      setNameError('Please enter a player name');
      return;
    }

    if (newPlayerName.trim().length < 2) {
      setNameError('Name must be at least 2 characters');
      return;
    }

    if (newPlayerName.trim().length > 16) {
      setNameError('Name must be 16 characters or less');
      return;
    }

    setIsRegistering(true);
    setNameError(null);

    try {
      const registeredUser = await registerUser(newPlayerName.trim());
      storeSetPlayerName(registeredUser.name);
      setUser(registeredUser.id, registeredUser.name, registeredUser.stats);
      setWalletAddress(registeredUser.walletAddress ?? null);
      setShowProfileModal(false);
      setNewPlayerName('');
    } catch (err: any) {
      setNameError(err.message || 'Registration failed');
    } finally {
      setIsRegistering(false);
    }
  };

  const handleDisconnect = async () => {
    if (isInParty) {
      leaveParty();
    }
    await logout();
    setNewPlayerName('');
    setNameError(null);
    setShowProfileModal(false);
  };

  const handleProfileModalClose = () => {
    setShowProfileModal(false);
  };

  const handleMobilePwaInstall = useCallback(async () => {
    if (isMobilePwaInstalling) {
      return;
    }

    setError(null);
    setIsMobilePwaInstalling(true);

    try {
      await pwaInstall.install();
    } finally {
      setIsMobilePwaInstalling(false);
    }
  }, [isMobilePwaInstalling, pwaInstall.install]);

  const handleLinkWallet = async (): Promise<boolean> => {
    if (hasWalletAccount) return true;
    if (isLinkingWallet) return false;

    setError(null);
    clearError();
    clearNotice();
    setIsLinkingWallet(true);
    try {
      const linkedUser = await linkWallet();
      storeSetPlayerName(linkedUser.name);
      setUser(linkedUser.id, linkedUser.name, linkedUser.stats);
      setWalletAddress(linkedUser.walletAddress ?? null);
      return Boolean(linkedUser.walletAddress);
    } catch (err: any) {
      setError(err.message || 'Failed to connect wallet');
      return false;
    } finally {
      setIsLinkingWallet(false);
    }
  };

  const shouldShowPwaInstallToast = (
    activeTab === 'play' &&
    !isMobileDevice &&
    !showSettings &&
    !showSocial &&
    !showProfileModal
  );

  const pendingRegistrationDisplayName = pendingRegistration?.displayName
    || pendingRegistration?.walletAddress
    || user?.linkedAccounts.find((account) => account.provider === 'discord')?.displayName
    || 'Connected';
  const pendingRegistrationProviderLabel = pendingRegistration?.provider === 'wallet' ? 'Wallet' : 'Discord';

  const handleSelectHero = (heroId: HeroId) => {
    setFeaturedHero(heroId);
    if (isInParty) {
      setPartyHero(heroId);
    }
  };

  const handleEquipSkin = async (skin: HeroSkinCatalogItem) => {
    if (!isAuthenticated) {
      handleOpenLogin();
      return;
    }
    if (!skin.owned) {
      setSkinCatalogError('Purchase this skin before equipping it.');
      return;
    }

    setSkinActionBusyId(skin.id);
    setSkinCatalogError(null);
    try {
      const loadout = await updateHeroSkinLoadout({ heroId: skin.heroId, skinId: skin.id });
      setFeaturedHero(loadout.heroId);
      if (isInParty && loadout.heroId === localPartyMember?.heroId) {
        setPartySkin(loadout.skinId);
      }
      await loadSkinCatalog();
    } catch (err) {
      setSkinCatalogError(err instanceof Error ? err.message : 'Failed to equip skin');
    } finally {
      setSkinActionBusyId(null);
    }
  };

  const handlePurchaseSkin = async (skin: HeroSkinCatalogItem) => {
    if (!isAuthenticated) {
      handleOpenLogin();
      return;
    }
    if (skin.purchaseDisabledReason) {
      setSkinCatalogError(skin.purchaseDisabledReason);
      return;
    }
    setSkinActionBusyId(skin.id);
    setSkinCatalogError(null);
    try {
      const payerWalletAddress = isWalletConnected && walletAddress
        ? walletAddress
        : await connectWallet();
      if (!payerWalletAddress) {
        throw new Error('Connect a wallet before paying');
      }

      const intent = await createSkinPurchaseIntent({
        skinId: skin.id,
        walletAddress: payerWalletAddress,
      });
      const transactionPayload = await buildSkinPurchaseTransaction(intent.intentId);
      const signedTransactionBase64 = await signTransaction(await transactionFromBase64(transactionPayload.transactionBase64));
      const submitted = await submitSignedSkinPurchaseTransaction({
        intentId: intent.intentId,
        signedTransactionBase64,
      });
      const finalIntent = await waitForCreditedPurchase(submitted);
      if (finalIntent.status !== 'credited') {
        throw new Error(finalIntent.lastError || 'Purchase is still waiting for confirmation');
      }

      const loadout = await updateHeroSkinLoadout({ heroId: skin.heroId, skinId: skin.id });
      if (isInParty && loadout.heroId === localPartyMember?.heroId) {
        setPartySkin(loadout.skinId);
      }
      await loadSkinCatalog();
    } catch (err) {
      setSkinCatalogError(err instanceof Error ? err.message : 'Failed to purchase skin');
    } finally {
      setSkinActionBusyId(null);
    }
  };

  const handleQuickPlay = async (
    gameplayMode: GameplayMode = DEFAULT_GAMEPLAY_MODE,
    botFillEnabled = false,
    matchPerspective: MatchPerspective = DEFAULT_MATCH_PERSPECTIVE
  ) => {
    setError(null);
    if (tutorialRequired) {
      handleStartTutorial();
      return;
    }
    try {
      await quickPlay(playerName, gameplayMode, botFillEnabled, featuredHero, matchPerspective, selectedSkinId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to find a match');
    }
  };

  const handleCustomPlay = async () => {
    setError(null);
    if (tutorialRequired) {
      handleStartTutorial();
      return;
    }
    try {
      await ensureParty(playerName, featuredHero, {
        selectedMode: 'custom',
        gameplayMode: activeCustomGameplayMode,
        selectedSkinId,
      });
      setPartyPerspective('custom', getMatchPerspectiveForPlayMode('custom', activePerspectiveByMode));
      startParty();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create custom lobby');
    }
  };

  const handleReconnectGame = async () => {
    setError(null);
    try {
      await reconnectRunningGame();
    } catch (err) {
      await getRunningGameReconnect();
      setRunningGameSession(null);
      setError(err instanceof Error ? err.message : 'Failed to reconnect');
    }
  };

  const handleStartTutorial = () => {
    setError(null);
    startTutorialGame(playerName);
  };

  const handlePracticePlay = () => {
    setError(null);
    startPracticeGame(playerName, {
      targetPractice: true,
      heroId: featuredHero,
      matchPerspective: getMatchPerspectiveForPlayMode('practice', activePerspectiveByMode),
    });
  };

  const handleSkipTutorial = async () => {
    if (isSkippingTutorial) return;

    setError(null);
    setIsSkippingTutorial(true);
    try {
      await completeTutorial();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip tutorial');
    } finally {
      setIsSkippingTutorial(false);
    }
  };

  const handleRankedPlay = async () => {
    setError(null);
    if (tutorialRequired) {
      handleStartTutorial();
      return;
    }
    if (isRankedPreseason) {
      setError('Ranked is disabled during Pre-season.');
      return;
    }
    if (!isAuthenticated) {
      handleOpenLogin();
      return;
    }
    if (rankedTokenHoldStatus?.eligible === false) {
      setError(rankedTokenGateBlockedMessage(rankedTokenHoldStatus));
      return;
    }
    if (!hasWalletAccount) {
      const linked = await handleLinkWallet();
      if (!linked) return;
      setRankedTokenHoldStatus(null);
      setRankedTokenHoldError(null);
    }
    if (isRankedTokenHoldLoading) {
      return;
    }
    try {
      await rankedPlay(playerName, featuredHero, selectedSkinId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enter ranked');
    }
  };

  const handleSelectPlayMode = (mode: PlayMenuMode) => {
    const gameplayMode = getGameplayModeForPlayMode(mode, activeCustomGameplayMode);
    if (isInParty) {
      if (isPartyLeader) {
        setPartyMode(getPartyModeForPlayMode(mode), gameplayMode);
      }
      return;
    }

    updatePlayMenuPreferences((current) => (
      current.selectedPlayMode === mode ? current : {
        ...current,
        selectedPlayMode: mode,
      }
    ));
  };

  const handleSetBotFillEnabled = (enabled: boolean) => {
    if (getBotFillUnavailableReasonForPlayMode(activePlayMode)) return;

    if (isInParty) {
      if (isPartyLeader) {
        for (const gameplayMode of GAMEPLAY_MODES) {
          setPartyBotFill(gameplayMode, enabled);
        }
      }
      return;
    }

    updatePlayMenuPreferences((current) => (
      isGlobalBotFillEnabled(current.botFillEnabledByMode) === enabled ? current : {
        ...current,
        botFillEnabledByMode: createGlobalBotFillSettings(enabled),
      }
    ));
  };

  const handleSelectedPlayAction = () => {
    if (activePlayMode === 'practice') {
      handlePracticePlay();
      return;
    }

    if (isInParty) {
      if (isPartyLeader) {
        startParty();
      } else {
        setPartyReady(!localPartyMember?.ready);
      }
      return;
    }

    switch (activePlayMode) {
      case 'ranked':
        void handleRankedPlay();
        break;
      case 'team_deathmatch':
      case 'battle_royal':
        void handleQuickPlay(
          getGameplayModeForPlayMode(activePlayMode),
          globalBotFillEnabled,
          getMatchPerspectiveForPlayMode(activePlayMode, activePerspectiveByMode)
        );
        break;
      case 'custom':
        void handleCustomPlay();
        break;
      case 'quick_play':
      default:
        void handleQuickPlay(
          DEFAULT_GAMEPLAY_MODE,
          globalBotFillEnabled,
          getMatchPerspectiveForPlayMode('quick_play', activePerspectiveByMode)
        );
        break;
    }
  };

  const handleBack = () => setAppPhase('menu');

  return (
    <div className="menu-screen bg-strike-bg">
      <LobbyBackdrop />

      {/* Top Navigation Bar */}
      <nav className="absolute top-0 left-0 right-0 z-20">
        <div className="menu-nav main-lobby-nav">
          {/* Logo */}
          <div className="main-lobby-brand flex min-w-0 shrink-0 items-center gap-3">
            <div className="w-10 h-10 xl:w-12 xl:h-12 relative flex items-center justify-center">
              <SlopHeroesMark className="w-full h-full" />
            </div>
            <div className="flex h-10 min-w-0 items-center xl:h-12">
              <h1 className="font-display text-2xl leading-none text-white tracking-wide whitespace-nowrap xl:text-3xl">SLOP HEROES</h1>
            </div>
          </div>

          <div className="main-lobby-center-stack">
            <div className="main-lobby-tabs flex min-w-0 items-center">
              {MAIN_TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    playButtonClick();
                    setActiveTab(tab);
                  }}
                  className={`relative px-3 py-3 font-display text-base tracking-wide whitespace-nowrap lg:px-5 xl:px-6 xl:text-lg ${
                    activeTab === tab ? 'text-white' : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {tab.toUpperCase()}
                  {activeTab === tab && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
                  )}
                </button>
              ))}
            </div>
            {activeTab === 'play' && displayedContractAddress && (
              <ContractAddressBadge address={displayedContractAddress} />
            )}
          </div>

          {/* Right side controls */}
          <div className="main-lobby-controls flex shrink-0 items-center gap-3 xl:gap-4">
            <XProfileLink onActivate={playButtonClick} />

            {isAuthenticated && (
              <SocialButton
                badgeCount={socialBadgeCount}
                onClick={() => {
                  playButtonClick();
                  setShowSocial(true);
                }}
              />
            )}

            <TopNavIconButton
              label="Open settings"
              title="Settings"
              onClick={() => { playButtonClick(); setShowSettings(true); }}
            >
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </TopNavIconButton>

            {isAuthenticated && user && (
              <div className="flex items-center gap-3">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center"
                  title={currentRank.label}
                >
                  <RankIcon rank={currentRank} size={42} labelled />
                </div>
                <div className="min-w-0">
                  <p className="font-display text-white text-sm">{playerName}</p>
                  <p className="mt-1 font-display text-[10px] uppercase leading-none text-white/70">{currentRank.label}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      <DailyMissionTracker
        enabled={isAuthenticated && !isNewUser}
        className="absolute left-4 top-[5.35rem] z-20 w-[min(23rem,calc(100vw-2rem))] sm:left-6 xl:left-8"
      />

      {/* Main Content Area */}
      <div className={`menu-main ${activeTab === 'play' ? 'menu-main-play' : ''}`}>
        {activeTab === 'play' && (
          <PlayTab
            isLoading={isLoading}
            featuredHero={featuredHero}
            heroAnimationMode={heroAnimationMode}
            rankedSeason={rankedSeason}
            playerName={playerName || user?.name || 'Guest'}
            isAuthenticated={isAuthenticated}
            hasWalletAccount={hasWalletAccount}
            requiresTutorial={tutorialRequired}
            error={error ?? partyLaunchError}
            party={party}
            soloPartyMember={soloPartyMember}
            localPartyUserId={localPartyUserId}
            isPartyLeader={isPartyLeader}
            isPartyReadyToStart={isPartyReadyToStart}
            selectedPlayMode={activePlayMode}
            customGameplayMode={activeCustomGameplayMode}
            botFillEnabled={displayedBotFillEnabled}
            botFillDisabledReason={botFillDisabledReason}
            rankedTokenHoldStatus={rankedTokenHoldStatus}
            rankedTokenHoldError={rankedTokenHoldError}
            rewardTokenSymbol={rewardTokenSymbol}
            rewardEconomy={rewardEconomy}
            runningGameSession={runningGameSession}
            isReconnectChecking={isReconnectChecking}
            isSkippingTutorial={isSkippingTutorial}
            serverLatency={serverLatency}
            mobilePwaInstallRequired={mobilePwaInstallRequired}
            mobilePwaCanInstall={pwaInstall.canPromptInstall}
            mobilePwaInstallInProgress={isMobilePwaInstalling}
            onSelectPlayMode={handleSelectPlayMode}
            onSetBotFillEnabled={handleSetBotFillEnabled}
            onPlayAction={handleSelectedPlayAction}
            onMobilePwaInstall={handleMobilePwaInstall}
            onKickPartyMember={kickPartyMember}
            onLeaveParty={leaveParty}
            onOpenSocial={() => setShowSocial(true)}
            onStartTutorial={handleStartTutorial}
            onSkipTutorial={handleSkipTutorial}
            onReconnect={handleReconnectGame}
            onLogin={handleOpenLogin}
            onSelectHero={handleSelectHero}
            onViewAllHeroes={() => {
              playButtonClick();
              setActiveTab('heroes');
            }}
          />
        )}
        {activeTab === 'heroes' && (
          <Suspense fallback={null}>
            <HeroesPage
              selectedHero={featuredHero}
              onSelectHero={handleSelectHero}
            />
          </Suspense>
        )}
        {activeTab === 'loadout' && (
          <Suspense fallback={null}>
            <LoadoutTab
              featuredHero={featuredHero}
              onSelectHero={handleSelectHero}
            />
          </Suspense>
        )}
        {activeTab === 'stats' && (
          <Suspense fallback={null}>
            <StatsPage />
          </Suspense>
        )}
        {activeTab === 'skins' && (
          <SkinsTab
            featuredHero={featuredHero}
            selectedSkinId={selectedSkinId}
            skins={skinsForFeaturedHero}
            catalog={skinCatalog}
            isLoading={isSkinCatalogLoading}
            error={skinCatalogError}
            busySkinId={skinActionBusyId}
            isAuthenticated={isAuthenticated}
            onSelectHero={handleSelectHero}
            onEquipSkin={handleEquipSkin}
            onPurchaseSkin={handlePurchaseSkin}
          />
        )}
      </div>

      {shouldShowPwaInstallToast && <PwaInstallToast />}

      {/* Modals */}
      {showSocial && isAuthenticated && (
        <SocialBox
          selectedHero={featuredHero}
          initialPartyMode={getPartyModeForPlayMode(activePlayMode)}
          initialGameplayMode={getGameplayModeForPlayMode(activePlayMode, activeCustomGameplayMode)}
          onClose={() => setShowSocial(false)}
        />
      )}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setShowSettings(false)} />
        </Suspense>
      )}
      {showLoginDialog && !isAuthenticated && (
        <LoginDialog
          walletProviders={walletProviders}
          isConnecting={isWalletConnecting}
          authError={authError}
          onDiscordSignIn={handleDiscordSignIn}
          onWalletSignIn={handleWalletSignIn}
          onClose={() => setShowLoginDialog(false)}
        />
      )}
      {showProfileModal && (
        <CreateProfileModal
          pendingRegistrationDisplayName={pendingRegistrationDisplayName}
          pendingRegistrationProviderLabel={pendingRegistrationProviderLabel}
          newPlayerName={newPlayerName}
          nameError={nameError}
          isRegistering={isRegistering}
          onDisconnect={handleDisconnect}
          onRegister={handleRegister}
          onNameChange={setNewPlayerName}
          onNameErrorClear={() => setNameError(null)}
          onClose={handleProfileModalClose}
        />
      )}
    </div>
  );
}

function formatSkinPrice(skin: HeroSkinCatalogItem): string {
  const price = skin.shopPrice;
  const tokenSymbol = formatTokenSymbol(price?.tokenSymbol);
  if (!price?.amountBaseUnits) return tokenSymbol ? `TBA ${tokenSymbol}` : 'TBA';
  const amount = formatTokenBaseUnits(
    price.amountBaseUnits,
    price.tokenDecimals,
    price.amountBaseUnits
  );
  return tokenSymbol ? `${amount} ${tokenSymbol}` : amount;
}

function formatTokenSymbol(symbol?: string | null): string {
  const cleaned = symbol?.trim();
  if (!cleaned) return '';
  return cleaned.startsWith('$') ? cleaned : `$${cleaned}`;
}

function skinRarityClass(rarity: HeroSkinCatalogItem['rarity']): string {
  return `is-${rarity}`;
}

type SkinFilter = 'all' | 'owned' | 'available' | 'locked';

const SKIN_FILTERS: { id: SkinFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'owned', label: 'Owned' },
  { id: 'available', label: 'Available' },
  { id: 'locked', label: 'Locked' },
];

// A skin is "available" when it isn't owned yet but can be purchased right now.
// Everything else that isn't owned (unlockable founder skins, sold-out or
// shop-disabled paid skins) falls into "locked".
function isSkinPurchasable(skin: HeroSkinCatalogItem): boolean {
  return skin.availability === 'paid' && !skin.purchaseDisabledReason;
}

function skinMatchesFilter(skin: HeroSkinCatalogItem, filter: SkinFilter): boolean {
  switch (filter) {
    case 'owned':
      return skin.owned;
    case 'available':
      return !skin.owned && isSkinPurchasable(skin);
    case 'locked':
      return !skin.owned && !isSkinPurchasable(skin);
    default:
      return true;
  }
}

function skinOwnershipLabel(skin: HeroSkinCatalogItem): string {
  if (!skin.owned) {
    if (skin.availability === 'paid') return formatSkinPrice(skin);
    return skin.unlockHint ? skin.unlockHint.toUpperCase() : 'LOCKED';
  }
  if (skin.entitlementSource === 'free') return 'BASE ISSUE';
  return 'OWNED';
}

function skinSupplyLabel(skin: HeroSkinCatalogItem): string | null {
  const price = skin.shopPrice;
  if (skin.availability !== 'paid' || skin.owned || price?.maxSupply === null || price?.maxSupply === undefined) {
    return null;
  }
  if (price.remainingSupply === 0) return 'sold out';
  return `${(price.remainingSupply ?? 0).toLocaleString('en-US')} left`;
}

function SkinsTab({
  featuredHero,
  selectedSkinId,
  skins,
  catalog,
  isLoading,
  error,
  busySkinId,
  isAuthenticated,
  onSelectHero,
  onEquipSkin,
  onPurchaseSkin,
}: {
  featuredHero: HeroId;
  selectedSkinId: HeroSkinId;
  skins: HeroSkinCatalogItem[];
  catalog: HeroSkinCatalogResponse | null;
  isLoading: boolean;
  error: string | null;
  busySkinId: HeroSkinId | null;
  isAuthenticated: boolean;
  onSelectHero: (heroId: HeroId) => void;
  onEquipSkin: (skin: HeroSkinCatalogItem) => void;
  onPurchaseSkin: (skin: HeroSkinCatalogItem) => void;
}) {
  const hero = HERO_DEFINITIONS[featuredHero];
  const [previewSkinId, setPreviewSkinId] = useState<HeroSkinId>(selectedSkinId);
  const [skinFilter, setSkinFilter] = useState<SkinFilter>('all');
  const selectedSkin = skins.find((skin) => skin.id === selectedSkinId) ?? skins[0] ?? null;
  const previewSkin = skins.find((skin) => skin.id === previewSkinId) ?? selectedSkin;
  const stageTitle = previewSkin?.displayName ?? hero.name;
  const stageRarityClass = previewSkin ? skinRarityClass(previewSkin.rarity) : 'is-common';

  const filterCounts = useMemo(() => ({
    all: skins.length,
    owned: skins.filter((skin) => skinMatchesFilter(skin, 'owned')).length,
    available: skins.filter((skin) => skinMatchesFilter(skin, 'available')).length,
    locked: skins.filter((skin) => skinMatchesFilter(skin, 'locked')).length,
  }), [skins]);
  const visibleSkins = useMemo(
    () => skins.filter((skin) => skinMatchesFilter(skin, skinFilter)),
    [skins, skinFilter],
  );

  useEffect(() => {
    setPreviewSkinId(selectedSkinId);
  }, [featuredHero, selectedSkinId]);

  return (
    <div className="skins-screen menu-content-wide">
      {error && (
        <div className="skins-error" role="alert">
          {error}
        </div>
      )}

      <div className="skins-workbench">
        <aside className="skins-roster" aria-label="Choose hero">
          <div className="skins-roster-list">
            {ALL_HERO_IDS.map((heroId) => {
              const heroDefinition = HERO_DEFINITIONS[heroId];
              const active = heroId === featuredHero;
              const equippedSkin = catalog?.loadouts.find((loadout) => loadout.heroId === heroId)?.skinId
                ?? getDefaultHeroSkinId(heroId);
              const equippedSkinName = catalog?.skins.find((skin) => skin.id === equippedSkin)?.displayName ?? 'Default';
              return (
                <button
                  type="button"
                  key={heroId}
                  onClick={() => onSelectHero(heroId)}
                  className={`skins-hero-tab${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  title={heroDefinition.name}
                >
                  <HeroIcon heroId={heroId} className="skins-hero-tab-icon" />
                  <span className="skins-hero-tab-copy">
                    <span className="skins-hero-tab-name">{heroDefinition.name}</span>
                    <span className="skins-hero-tab-skin">{equippedSkinName}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className={`skins-stage ${stageRarityClass}`} aria-label={`${hero.name} cosmetic preview`}>
          <SkinRarityChrome className="skins-stage-card-chrome" />

          <div className="skins-stage-copy">
            <div>
              <p className="skins-kicker">
                {previewSkin?.owned ? 'ARMORY READY' : 'PREVIEW ACCESS'}
              </p>
              <div className="skins-stage-title-line">
                <h2 className="skins-stage-title">{stageTitle}</h2>
                {previewSkin && (
                  <span className={`skins-rarity-chip ${stageRarityClass}`}>
                    {previewSkin.rarity}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="skins-stage-preview">
            <Suspense fallback={null}>
              <FeaturedHeroPreview
                heroId={featuredHero}
                skinId={previewSkin?.id ?? selectedSkinId}
                initialYaw={Math.PI - 0.18}
                animationMode={HERO_IDLE_ANIMATION_MODE}
                className="skins-featured-preview"
              />
            </Suspense>
          </div>
        </section>

        <section className="skins-bay" aria-label={`${hero.name} cosmetics`}>
          {skins.length > 0 && (
            <div className="skins-filter" role="group" aria-label="Filter skins">
              {SKIN_FILTERS.map((filter) => (
                <button
                  type="button"
                  key={filter.id}
                  className={`skins-filter-chip${skinFilter === filter.id ? ' is-active' : ''}`}
                  onClick={() => setSkinFilter(filter.id)}
                  aria-pressed={skinFilter === filter.id}
                >
                  <span className="skins-filter-label">{filter.label}</span>
                  <span className="skins-filter-count">{filterCounts[filter.id]}</span>
                </button>
              ))}
            </div>
          )}
          <div className="skins-list">
            {isLoading && skins.length === 0 && (
              <div className="skins-empty-state">
                Loading skins...
              </div>
            )}
            {!isLoading && skins.length === 0 && (
              <div className="skins-empty-state">
                No hero skins available.
              </div>
            )}
            {skins.length > 0 && visibleSkins.length === 0 && (
              <div className="skins-empty-state">
                No {skinFilter} skins for {hero.name}.
              </div>
            )}
            {visibleSkins.map((skin) => {
              const busy = busySkinId === skin.id;
              const equipped = skin.id === selectedSkinId;
              const previewed = skin.id === previewSkin?.id;
              const canPurchase = skin.availability === 'paid' && !skin.owned && !skin.purchaseDisabledReason;
              const disabledReason = skin.purchaseDisabledReason;
              const supplyLabel = skinSupplyLabel(skin);
              return (
                <article
                  key={skin.id}
                  className={`skins-row ${skinRarityClass(skin.rarity)}${previewed ? ' is-previewed' : ''}${equipped ? ' is-equipped' : ''}${skin.owned ? '' : ' is-locked'}`}
                >
                  <SkinRarityChrome />

                  <button
                    type="button"
                    className="skins-row-hitbox"
                    onClick={() => setPreviewSkinId(skin.id)}
                    aria-label={`Preview ${skin.displayName}`}
                    aria-pressed={previewed}
                  />

                  <div className="skins-preview-button" aria-hidden="true">
                    <Suspense fallback={null}>
                      <HeroPreviewCanvas
                        heroId={skin.heroId}
                        skinId={skin.id}
                        size="card"
                        interactive={false}
                        idleAnimation={false}
                        showShadow={false}
                        initialYaw={Math.PI - 0.28}
                        className="skins-card-preview"
                      />
                    </Suspense>
                  </div>

                  <div className="skins-copy">
                    <div className="skins-title-line">
                      <h2>{skin.displayName}</h2>
                      <span className={`skins-rarity-chip ${skinRarityClass(skin.rarity)}`}>
                        {skin.rarity}
                      </span>
                    </div>
                    <p>{skin.subtitle}</p>
                    <div className="skins-tags">
                      <span>{skinOwnershipLabel(skin)}</span>
                      {supplyLabel && <span>{supplyLabel}</span>}
                      {equipped && <span className="is-status is-equipped-tag">equipped</span>}
                      {previewed && !equipped && <span className="is-status is-previewing-tag">previewing</span>}
                    </div>
                  </div>

                  <div className="skins-actions">
                    {skin.owned ? (
                      <button
                        type="button"
                        disabled={equipped || busy}
                        onClick={() => onEquipSkin(skin)}
                        className={`skins-action-button is-equip${equipped ? ' is-equipped' : ''}`}
                      >
                        {equipped ? 'EQUIPPED' : busy ? 'EQUIPPING...' : 'EQUIP'}
                      </button>
                    ) : skin.availability === 'paid' ? (
                      <button
                        type="button"
                        disabled={!canPurchase || busy || !isAuthenticated}
                        onClick={() => onPurchaseSkin(skin)}
                        className="skins-action-button is-purchase"
                      >
                        {busy ? 'PURCHASING...' : isAuthenticated ? formatSkinPrice(skin) : 'SIGN IN'}
                      </button>
                    ) : (
                      <button type="button" disabled className="skins-action-button is-locked">
                        LOCKED
                      </button>
                    )}
                    {skin.availability !== 'paid' && !skin.owned && skin.unlockHint && (
                      <span className="skins-disabled-reason">{skin.unlockHint}</span>
                    )}
                    {disabledReason && !skin.owned && (
                      <span className="skins-disabled-reason">{disabledReason}</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
// Play Tab Component
interface PlayTabProps {
  isLoading: boolean;
  featuredHero: HeroId;
  heroAnimationMode: HeroPreviewAnimationMode;
  rankedSeason: RankedSeasonSnapshot;
  playerName: string;
  isAuthenticated: boolean;
  hasWalletAccount: boolean;
  requiresTutorial: boolean;
  error: string | null;
  party: PartyStateSnapshot | null;
  soloPartyMember: PartyMemberSnapshot | null;
  localPartyUserId: string | null;
  isPartyLeader: boolean;
  isPartyReadyToStart: boolean;
  selectedPlayMode: PlayMenuMode;
  customGameplayMode: CustomLobbyGameplayMode;
  botFillEnabled: boolean;
  botFillDisabledReason: string | null;
  rankedTokenHoldStatus: RankedTokenHoldStatus | null;
  rankedTokenHoldError: string | null;
  rewardTokenSymbol: string | null;
  rewardEconomy: RewardEconomy | null;
  runningGameSession: RunningGameSession | null;
  isReconnectChecking: boolean;
  isSkippingTutorial: boolean;
  serverLatency: ServerLatencyProbeSnapshot | null;
  mobilePwaInstallRequired: boolean;
  mobilePwaCanInstall: boolean;
  mobilePwaInstallInProgress: boolean;
  onSelectPlayMode: (mode: PlayMenuMode) => void;
  onSetBotFillEnabled: (enabled: boolean) => void;
  onPlayAction: () => void;
  onMobilePwaInstall: () => Promise<void>;
  onKickPartyMember: (userId: string) => void;
  onLeaveParty: () => void;
  onOpenSocial: () => void;
  onStartTutorial: () => void;
  onSkipTutorial: () => void;
  onReconnect: () => void;
  onLogin: () => void;
  onSelectHero: (heroId: HeroId) => void;
  onViewAllHeroes: () => void;
}

function PlayTab({
  isLoading,
  featuredHero,
  heroAnimationMode,
  rankedSeason,
  playerName,
  isAuthenticated,
  hasWalletAccount,
  requiresTutorial,
  error,
  party,
  soloPartyMember,
  localPartyUserId,
  isPartyLeader,
  isPartyReadyToStart,
  selectedPlayMode,
  customGameplayMode,
  botFillEnabled,
  botFillDisabledReason,
  rankedTokenHoldStatus,
  rankedTokenHoldError,
  rewardTokenSymbol,
  rewardEconomy,
  runningGameSession,
  isReconnectChecking,
  isSkippingTutorial,
  serverLatency,
  mobilePwaInstallRequired,
  mobilePwaCanInstall,
  mobilePwaInstallInProgress,
  onSelectPlayMode,
  onSetBotFillEnabled,
  onPlayAction,
  onMobilePwaInstall,
  onKickPartyMember,
  onLeaveParty,
  onOpenSocial,
  onStartTutorial,
  onSkipTutorial,
  onReconnect,
  onLogin,
  onSelectHero,
  onViewAllHeroes,
}: PlayTabProps) {
  const { playButtonClick } = useUISounds();
  const canReconnect = isAuthenticated && Boolean(runningGameSession);
  const localPartyMember = getPartyMember(party, localPartyUserId);
  const isInParty = Boolean(party);
  const lineupMembers = party?.members ?? (soloPartyMember ? [soloPartyMember] : []);
  const lineupLocalUserId = party ? localPartyUserId : soloPartyMember?.userId ?? null;
  const lineupLocalMember = lineupLocalUserId
    ? lineupMembers.find((member) => member.userId === lineupLocalUserId) ?? null
    : null;
  const lineupSelectedHero = lineupLocalMember?.heroId ?? featuredHero;
  const uniquePartyHeroesRequired = requiresUniquePartyHeroes(getPartyModeForPlayMode(selectedPlayMode));
  const lineupLockedHeroIds = uniquePartyHeroesRequired
    ? getHumanPartyHeroIds(lineupMembers, lineupLocalUserId)
    : EMPTY_HERO_ID_SET;
  const partyHasDuplicateHeroes = isInParty && uniquePartyHeroesRequired && hasDuplicatePartyHeroes(lineupMembers);
  const mainPlayLabel = isReconnectChecking
    ? 'CHECKING...'
    : canReconnect
      ? 'RECONNECT'
      : requiresTutorial && selectedPlayMode !== 'practice'
        ? isLoading
          ? 'STARTING...'
          : 'START TUTORIAL'
        : selectedPlayMode === 'practice'
          ? getPlayModeActionLabel(selectedPlayMode, isLoading)
        : isInParty
          ? isPartyLeader
            ? isLoading
              ? 'STARTING...'
              : 'START'
            : localPartyMember?.ready
              ? 'UNREADY'
              : 'READY UP'
            : getPlayModeActionLabel(selectedPlayMode, isLoading);
  const isRankedEligibilityBlocked = selectedPlayMode === 'ranked' &&
    !requiresTutorial &&
    rankedTokenHoldStatus?.eligible === false;
  const isPracticePlayMode = selectedPlayMode === 'practice';
  const partySize = party?.members.length ?? 1;
  const gameplayModeForLimit = getGameplayModeForPlayMode(selectedPlayMode, customGameplayMode);
  const partyMemberLimit = getPartyMemberLimitForPlayMode(selectedPlayMode, gameplayModeForLimit);
  const isPartyTooLargeForMode = !isPracticePlayMode && isInParty && partySize > partyMemberLimit;
  const primaryDisabled = isLoading || isReconnectChecking || isSkippingTutorial || (
    !isPracticePlayMode && isInParty && isPartyLeader && !isPartyReadyToStart
  ) || (!isPracticePlayMode && partyHasDuplicateHeroes) || isPartyTooLargeForMode || (
    selectedPlayMode === 'ranked' &&
    !requiresTutorial &&
    rankedSeason.mode === 'preseason'
  ) || isRankedEligibilityBlocked;
  const primaryDisabledReason = getPrimaryDisabledReason({
    isLoading,
    isReconnectChecking,
    isInParty,
    isPartyLeader,
    isPartyReadyToStart,
    partyHasDuplicateHeroes,
    requiresTutorial,
    selectedPlayMode,
    partySize,
    partyMemberLimit,
    gameplayMode: gameplayModeForLimit,
    rankedSeason,
    rankedTokenHoldStatus,
  });
  const handleLineupAddMember = () => {
    playButtonClick();
    if (isAuthenticated) {
      onOpenSocial();
    } else {
      onLogin();
    }
  };
  const handleLineupKickMember = isInParty && isPartyLeader ? (userId: string) => {
    playButtonClick();
    onKickPartyMember(userId);
  } : undefined;
  const handleLineupLeaveParty = isInParty ? () => {
    playButtonClick();
    onLeaveParty();
  } : undefined;

  const playShellClassName = [
    'play-tab-shell h-full menu-content',
    party ? 'is-party-mode' : 'is-solo-mode',
    isAuthenticated ? '' : 'is-guest-mode',
  ].filter(Boolean).join(' ');

  return (
    <div className={playShellClassName}>
      <PlayActionStack
        error={error}
        isLoading={isLoading}
        isAuthenticated={isAuthenticated}
        hasWalletAccount={hasWalletAccount}
        requiresTutorial={requiresTutorial}
        rankedSeason={rankedSeason}
        selectedPlayMode={selectedPlayMode}
        botFillEnabled={botFillEnabled}
        botFillDisabledReason={botFillDisabledReason}
        rankedTokenHoldStatus={rankedTokenHoldStatus}
        rankedTokenHoldError={rankedTokenHoldError}
        isInParty={isInParty}
        isPartyLeader={isPartyLeader}
        canReconnect={canReconnect}
        isReconnectChecking={isReconnectChecking}
        isSkippingTutorial={isSkippingTutorial}
        mainPlayLabel={mainPlayLabel}
        primaryDisabled={primaryDisabled}
        primaryDisabledReason={primaryDisabledReason}
        mobilePwaInstallRequired={mobilePwaInstallRequired}
        mobilePwaCanInstall={mobilePwaCanInstall}
        mobilePwaInstallInProgress={mobilePwaInstallInProgress}
        onSelectPlayMode={onSelectPlayMode}
        onSetBotFillEnabled={onSetBotFillEnabled}
        onLogin={onLogin}
        onReconnect={onReconnect}
        onStartTutorial={onStartTutorial}
        onSkipTutorial={onSkipTutorial}
        onPlayAction={onPlayAction}
        onMobilePwaInstall={onMobilePwaInstall}
      />
      <div className="play-tab-stage menu-compact-scale relative">
        {isAuthenticated ? (
          <PartyLineup
            members={lineupMembers}
            localUserId={lineupLocalUserId}
            heroAnimationMode={heroAnimationMode}
            onAddMember={handleLineupAddMember}
            onKickMember={handleLineupKickMember}
            onLeaveParty={handleLineupLeaveParty}
          />
        ) : (
          <GuestHeroCarousel
            selectedHero={featuredHero}
            heroAnimationMode={heroAnimationMode}
            onSelectHero={onSelectHero}
            onViewAllHeroes={onViewAllHeroes}
          />
        )}
      </div>
      {lineupLocalMember && (
        <div className="party-lineup-controls">
          <PartyHeroPicker
            selectedHero={lineupSelectedHero}
            lockedHeroIds={lineupLockedHeroIds}
            onSelectHero={onSelectHero}
          />
        </div>
      )}
      {serverLatency && shouldShowServerLatencyAdvisory(serverLatency) && (
        <ServerLatencyAdvisory snapshot={serverLatency} />
      )}
      <div className="play-tab-bottom-right-stack">
        <RankedSeasonPlate season={rankedSeason} />
        {shouldShowSeasonRewardsPlate(rankedSeason) && (
          <EarningRulesPlate tokenSymbol={rewardTokenSymbol} economy={rewardEconomy} />
        )}
        {isAuthenticated && <GlobalChat displayName={playerName} />}
      </div>
    </div>
  );
}

function getHeroCarouselIndex(heroId: HeroId): number {
  const index = ALL_HERO_IDS.indexOf(heroId);
  return index >= 0 ? index : 0;
}

function getHeroCarouselNeighbor(heroId: HeroId, offset: number): HeroId {
  const currentIndex = getHeroCarouselIndex(heroId);
  const nextIndex = (currentIndex + offset + ALL_HERO_IDS.length) % ALL_HERO_IDS.length;
  return ALL_HERO_IDS[nextIndex] ?? heroId;
}

function CarouselArrowIcon({ direction }: { direction: 'previous' | 'next' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      {direction === 'previous' ? (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 5l-7 7 7 7" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 5l7 7-7 7" />
      )}
    </svg>
  );
}

function GuestHeroCarousel({
  selectedHero,
  heroAnimationMode,
  onSelectHero,
  onViewAllHeroes,
}: {
  selectedHero: HeroId;
  heroAnimationMode: HeroPreviewAnimationMode;
  onSelectHero: (heroId: HeroId) => void;
  onViewAllHeroes: () => void;
}) {
  const selectedHeroIndex = getHeroCarouselIndex(selectedHero);
  const selectedHeroDefinition = HERO_DEFINITIONS[selectedHero];
  const handleCycleHero = (offset: number) => {
    onSelectHero(getHeroCarouselNeighbor(selectedHero, offset));
  };

  return (
    <section className="guest-hero-carousel" aria-label="Hero carousel">
      <button
        type="button"
        className="guest-hero-carousel-arrow is-previous"
        aria-label="Previous hero"
        title="Previous hero"
        onClick={() => handleCycleHero(-1)}
      >
        <CarouselArrowIcon direction="previous" />
      </button>

      <article className="guest-hero-slot" aria-live="polite">
        <Suspense fallback={null}>
          <FeaturedHeroPreview
            heroId={selectedHero}
            initialYaw={Math.PI - 0.12}
            animationMode={heroAnimationMode}
            className="guest-hero-preview"
          />
        </Suspense>
        <div className="guest-hero-labels">
          <div className="guest-hero-identity">
            <HeroIcon heroId={selectedHero} className="guest-hero-identity-icon" />
            <h2 className="guest-hero-name">{selectedHeroDefinition.name}</h2>
          </div>
          <p className="guest-hero-count">
            HERO {selectedHeroIndex + 1}/{ALL_HERO_IDS.length}
          </p>
        </div>
      </article>

      <button
        type="button"
        className="guest-hero-carousel-arrow is-next"
        aria-label="Next hero"
        title="Next hero"
        onClick={() => handleCycleHero(1)}
      >
        <CarouselArrowIcon direction="next" />
      </button>

      <div className="guest-hero-carousel-controls">
        <div className="guest-hero-quick-list" aria-label="Choose hero">
          {ALL_HERO_IDS.map((heroId) => {
            const selected = heroId === selectedHero;
            return (
              <button
                key={heroId}
                type="button"
                className={`guest-hero-quick-button${selected ? ' is-selected' : ''}`}
                aria-pressed={selected}
                aria-label={`Select ${HERO_DEFINITIONS[heroId].name}`}
                title={HERO_DEFINITIONS[heroId].name}
                onClick={() => {
                  if (!selected) {
                    onSelectHero(heroId);
                  }
                }}
              >
                <HeroIcon heroId={heroId} size={21} />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="guest-hero-view-all"
          onClick={onViewAllHeroes}
        >
          VIEW ALL HEROES
        </button>
      </div>
    </section>
  );
}

function PartyLineup({
  members,
  localUserId,
  heroAnimationMode,
  onAddMember,
  onKickMember,
  onLeaveParty,
}: {
  members: PartyMemberSnapshot[];
  localUserId: string | null;
  heroAnimationMode: HeroPreviewAnimationMode;
  onAddMember: () => void;
  onKickMember?: (userId: string) => void;
  onLeaveParty?: () => void;
}) {
  const visibleMembers = members.slice(0, PLAY_PARTY_SLOT_COUNT);
  const emptySlotCount = Math.max(0, PLAY_PARTY_SLOT_COUNT - visibleMembers.length);
  const localMember = localUserId
    ? visibleMembers.find((member) => member.userId === localUserId) ?? null
    : null;
  const localLeaveAction = localMember && onLeaveParty
    ? {
        ariaLabel: 'Leave party',
        title: 'Leave party',
        onClick: onLeaveParty,
      }
    : null;

  return (
    <div className="party-lineup-stage">
      <div className="party-lineup-grid">
        {visibleMembers.map((member) => {
          const hero = HERO_DEFINITIONS[member.heroId];
          const isLocalMember = member.userId === localUserId;
          const kickAction = !isLocalMember && onKickMember
            ? {
                ariaLabel: `Kick ${member.displayName} from party`,
                title: `Kick ${member.displayName}`,
                onClick: () => onKickMember(member.userId),
              }
            : null;
          const playerAction = kickAction ?? (isLocalMember ? localLeaveAction : null);

          return (
            <article
              key={member.userId}
              className="party-member-card"
              data-ready={member.leader || member.ready ? 'true' : 'false'}
              data-local={isLocalMember ? 'true' : 'false'}
            >
              <Suspense fallback={null}>
                <FeaturedHeroPreview
                  heroId={member.heroId}
                  skinId={member.skinId}
                  initialYaw={Math.PI - 0.12}
                  animationMode={heroAnimationMode}
                  rank={member.rank}
                  className="party-member-preview"
                />
              </Suspense>
              <div className="party-member-labels">
                <div className="party-member-identity">
                  <span className="party-member-rank-icon">
                    <RankIcon rank={member.rank} size={22} labelled />
                  </span>
                  <span className="party-member-name">{member.displayName}</span>
                </div>
                <div className="party-member-meta">
                  <span>{hero.name}</span>
                  <span>{member.leader ? 'LEADER' : member.ready ? 'READY' : 'NOT READY'}</span>
                </div>
                {playerAction && (
                  <div className="party-member-action-slot">
                    <PartyMemberActionButton action={playerAction} />
                  </div>
                )}
                {!playerAction && (
                  <div className="party-member-action-slot is-placeholder" aria-hidden="true" />
                )}
              </div>
            </article>
          );
        })}
        {Array.from({ length: emptySlotCount }, (_, index) => (
          <article
            key={`party-empty-slot:${index}`}
            className="party-member-card is-empty-slot"
            data-ready="false"
            data-local="false"
          >
            <button
              type="button"
              className="party-lineup-add-button"
              aria-label="Add party member"
              title="Add party member"
              onClick={onAddMember}
            >
              <span className="party-lineup-add-glyph" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M12 5v14m7-7H5" />
                </svg>
              </span>
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

interface PartyMemberAction {
  ariaLabel: string;
  title: string;
  onClick: () => void;
}

function PartyMemberActionButton({ action }: { action: PartyMemberAction }) {
  return (
    <button
      type="button"
      className="party-member-action-button"
      title={action.title}
      aria-label={action.ariaLabel}
      onClick={action.onClick}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

function PartyHeroPicker({
  selectedHero,
  lockedHeroIds,
  onSelectHero,
}: {
  selectedHero: HeroId;
  lockedHeroIds: Set<HeroId>;
  onSelectHero: (heroId: HeroId) => void;
}) {
  return (
    <div className="party-hero-picker" aria-label="Choose party hero">
      {ALL_HERO_IDS.map((heroId) => {
        const selected = heroId === selectedHero;
        const locked = !selected && lockedHeroIds.has(heroId);
        return (
          <button
            key={heroId}
            type="button"
            aria-pressed={selected}
            aria-label={`Select ${HERO_DEFINITIONS[heroId].name}`}
            disabled={locked}
            title={locked ? 'Picked by teammate' : HERO_DEFINITIONS[heroId].name}
            onClick={() => {
              if (selected || locked) return;
              onSelectHero(heroId);
            }}
            className={`party-hero-picker-button${selected ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`}
            style={selected ? {
              '--party-hero-accent': BLAZE_UI_COLORS.primary,
            } as CSSProperties : undefined}
          >
            <HeroIcon heroId={heroId} size={21} />
          </button>
        );
      })}
    </div>
  );
}

function getPlayModeLabel(mode: PlayMenuMode): string {
  switch (mode) {
    case 'ranked':
      return 'RANKED';
    case 'team_deathmatch':
      return getGameplayModeLabel('team_deathmatch').toUpperCase();
    case 'battle_royal':
      return getGameplayModeLabel('battle_royal').toUpperCase();
    case 'custom':
      return 'CUSTOM';
    case 'practice':
      return 'PRACTICE';
    case 'quick_play':
    default:
      return getGameplayModeLabel(DEFAULT_GAMEPLAY_MODE).toUpperCase();
  }
}

function getPlayModeActionLabel(mode: PlayMenuMode, isLoading: boolean): string {
  if (isLoading) {
    switch (mode) {
      case 'ranked':
        return 'PREPARING...';
      case 'practice':
        return 'STARTING...';
      case 'custom':
        return 'CREATING...';
      case 'team_deathmatch':
      case 'battle_royal':
      case 'quick_play':
      default:
        return 'MATCHING...';
    }
  }

  switch (mode) {
    case 'ranked':
      return 'START RANKED';
    case 'team_deathmatch':
    case 'battle_royal':
      return 'FIND MATCH';
    case 'custom':
      return 'CREATE LOBBY';
    case 'practice':
      return 'PRACTICE';
    case 'quick_play':
    default:
      return 'FIND MATCH';
  }
}

function getPrimaryDisabledReason(input: {
  isLoading: boolean;
  isReconnectChecking: boolean;
  isInParty: boolean;
  isPartyLeader: boolean;
  isPartyReadyToStart: boolean;
  partyHasDuplicateHeroes: boolean;
  requiresTutorial: boolean;
  selectedPlayMode: PlayMenuMode;
  partySize: number;
  partyMemberLimit: number;
  gameplayMode: GameplayMode;
  rankedSeason: RankedSeasonSnapshot;
  rankedTokenHoldStatus: RankedTokenHoldStatus | null;
}): string | null {
  if (input.isLoading) return null;
  if (input.isReconnectChecking) return 'Checking active match';
  if (input.partySize > input.partyMemberLimit) {
    if (input.selectedPlayMode === 'battle_royal') {
      return `Battle Royal squads are limited to ${input.partyMemberLimit} players`;
    }
    if (input.selectedPlayMode === 'custom') {
      return `Custom lobbies are limited to ${input.partyMemberLimit} players`;
    }
    return `${getGameplayModeLabel(input.gameplayMode)} parties are limited to ${input.partyMemberLimit} players`;
  }
  if (input.partyHasDuplicateHeroes) {
    return 'Each party member needs a unique hero';
  }
  if (input.isInParty && input.isPartyLeader && !input.isPartyReadyToStart) {
    return 'Waiting for teammates to ready up';
  }
  if (input.selectedPlayMode !== 'ranked' || input.requiresTutorial) return null;
  if (input.rankedSeason.mode === 'preseason') return formatSeasonBoundaryDate(input.rankedSeason);
  if (input.rankedTokenHoldStatus?.eligible === false) {
    return rankedTokenGateBlockedMessage(input.rankedTokenHoldStatus);
  }
  return null;
}

function PlayModeIcon({ mode }: { mode: PlayMenuMode }) {
  switch (mode) {
    case 'ranked':
      return (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M12 3l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.3 6.8 19l1-5.8L3.6 9.1l5.8-.8L12 3z" />
        </svg>
      );
    case 'team_deathmatch':
      return (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M12 4v3m0 10v3M4 12h3m10 0h3" />
          <circle cx="12" cy="12" r="5" strokeWidth={2.1} />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'battle_royal':
      return (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M4.5 8l4.25 3.75L12 5l3.25 6.75L19.5 8l-1.35 10.25H5.85L4.5 8z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M7 21h10" />
        </svg>
      );
    case 'custom':
      return (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M7 5h10l2 3.5-7 10-7-10L7 5z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M9 10h6M12 7v6" />
        </svg>
      );
    case 'practice':
      return (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M12 3v6m0 0l4 7a3 3 0 01-2.6 4.5H10.6A3 3 0 018 16l4-7zm-3.5 11h7" />
        </svg>
      );
    case 'quick_play':
    default:
      return (
        <svg fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      );
  }
}

function DownloadPwaIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M12 3v10m0 0l4-4m-4 4L8 9" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M5 14v3.5A2.5 2.5 0 007.5 20h9a2.5 2.5 0 002.5-2.5V14" />
    </svg>
  );
}

function getModeTitle(input: {
  mode: PlayMenuMode;
  isAuthenticated: boolean;
  hasWalletAccount: boolean;
  rankedSeason: RankedSeasonSnapshot;
  requiresTutorial: boolean;
  rankedTokenHoldStatus: RankedTokenHoldStatus | null;
  rankedTokenHoldError: string | null;
}): string {
  if (input.requiresTutorial && input.mode !== 'practice') return 'Start or skip the tutorial before online play';

  if (input.mode !== 'ranked') return getPlayModeLabel(input.mode);
  if (input.rankedSeason.mode === 'preseason') return 'Ranked is disabled during Pre-season';
  if (input.rankedTokenHoldStatus?.eligible === false) {
    return rankedTokenGateBlockedMessage(input.rankedTokenHoldStatus);
  }
  if (input.isAuthenticated && !input.hasWalletAccount) return 'Connect a wallet before entering ranked';
  return input.rankedTokenHoldError ?? 'Battle Royal ranked queue';
}

function PlayActionStack({
  error,
  isLoading,
  isAuthenticated,
  hasWalletAccount,
  requiresTutorial,
  rankedSeason,
  selectedPlayMode,
  botFillEnabled,
  botFillDisabledReason,
  rankedTokenHoldStatus,
  rankedTokenHoldError,
  isInParty,
  isPartyLeader,
  canReconnect,
  isReconnectChecking,
  isSkippingTutorial,
  mainPlayLabel,
  primaryDisabled,
  primaryDisabledReason,
  mobilePwaInstallRequired,
  mobilePwaCanInstall,
  mobilePwaInstallInProgress,
  onSelectPlayMode,
  onSetBotFillEnabled,
  onLogin,
  onReconnect,
  onStartTutorial,
  onSkipTutorial,
  onPlayAction,
  onMobilePwaInstall,
}: {
  error: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasWalletAccount: boolean;
  requiresTutorial: boolean;
  rankedSeason: RankedSeasonSnapshot;
  selectedPlayMode: PlayMenuMode;
  botFillEnabled: boolean;
  botFillDisabledReason: string | null;
  rankedTokenHoldStatus: RankedTokenHoldStatus | null;
  rankedTokenHoldError: string | null;
  isInParty: boolean;
  isPartyLeader: boolean;
  canReconnect: boolean;
  isReconnectChecking: boolean;
  isSkippingTutorial: boolean;
  mainPlayLabel: string;
  primaryDisabled: boolean;
  primaryDisabledReason: string | null;
  mobilePwaInstallRequired: boolean;
  mobilePwaCanInstall: boolean;
  mobilePwaInstallInProgress: boolean;
  onSelectPlayMode: (mode: PlayMenuMode) => void;
  onSetBotFillEnabled: (enabled: boolean) => void;
  onLogin: () => void;
  onReconnect: () => void;
  onStartTutorial: () => void;
  onSkipTutorial: () => void;
  onPlayAction: () => void;
  onMobilePwaInstall: () => Promise<void>;
}) {
  const { playButtonClick } = useUISounds();
  const mobilePwaDisabledReason = mobilePwaInstallRequired && !mobilePwaCanInstall
    ? 'PWA install is required on mobile'
    : null;
  const effectiveMainPlayLabel = mobilePwaInstallRequired
    ? mobilePwaInstallInProgress
      ? 'OPENING...'
      : 'DOWNLOAD PWA'
    : mainPlayLabel;
  const effectivePrimaryDisabled = mobilePwaInstallRequired
    ? mobilePwaInstallInProgress || !mobilePwaCanInstall
    : primaryDisabled;
  const effectivePrimaryDisabledReason = mobilePwaDisabledReason ?? (
    mobilePwaInstallRequired ? null : primaryDisabledReason
  );

  const runPrimaryAction = () => {
    const shouldStartTutorial = requiresTutorial && selectedPlayMode !== 'practice';
    playButtonClick();
    if (mobilePwaInstallRequired) {
      void onMobilePwaInstall();
    } else if (canReconnect) {
      onReconnect();
    } else if (shouldStartTutorial) {
      onStartTutorial();
    } else {
      onPlayAction();
    }
  };
  const runSkipTutorial = () => {
    playButtonClick();
    onSkipTutorial();
  };

  return (
    <div className="play-action-stack">
      <PlayModeSelector
        isAuthenticated={isAuthenticated}
        hasWalletAccount={hasWalletAccount}
        requiresTutorial={requiresTutorial}
        rankedSeason={rankedSeason}
        selectedPlayMode={selectedPlayMode}
        botFillEnabled={botFillEnabled}
        botFillDisabledReason={botFillDisabledReason}
        rankedTokenHoldStatus={rankedTokenHoldStatus}
        rankedTokenHoldError={rankedTokenHoldError}
        modeReadOnly={isInParty && !isPartyLeader}
        onSelectMode={(mode) => {
          playButtonClick();
          onSelectPlayMode(mode);
        }}
        onSetBotFillEnabled={(enabled) => {
          playButtonClick();
          onSetBotFillEnabled(enabled);
        }}
      />
      {error && (
        <div className="play-action-error" role="status">
          {error}
        </div>
      )}
      {mobilePwaInstallRequired || isAuthenticated ? (
        <div className="play-main-cta-wrap">
          <button
            type="button"
            onClick={runPrimaryAction}
            disabled={effectivePrimaryDisabled}
            className="play-main-cta group"
            aria-describedby={effectivePrimaryDisabledReason ? 'play-main-cta-disabled-reason' : undefined}
            style={{
              background: `linear-gradient(135deg, ${BLAZE_UI_COLORS.primary}, ${BLAZE_UI_COLORS.primary}dd)`,
              boxShadow: `0 0 60px ${BLAZE_UI_COLORS.primary}40, inset 0 1px 0 rgba(255,255,255,0.2)`,
            }}
          >
            <span
              className="absolute inset-0 opacity-0 group-hover:opacity-100"
              style={{ background: WALLET_AUTH_COLORS.shimmer }}
            />
            <span className="play-main-cta-content relative flex items-center justify-center gap-2">
              {mobilePwaInstallRequired ? (
                <DownloadPwaIcon />
              ) : canReconnect ? (
                <svg className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 4v6h6M20 20v-6h-6M5.5 14a7 7 0 0012.1 2.4M18.5 10A7 7 0 006.4 7.6" />
                </svg>
              ) : (
                <PlayModeIcon mode={selectedPlayMode} />
              )}
              {effectiveMainPlayLabel}
            </span>
          </button>
          {effectivePrimaryDisabledReason && (
            <div
              id="play-main-cta-disabled-reason"
              className="play-disabled-reason"
              role="status"
            >
              {effectivePrimaryDisabledReason}
            </div>
          )}
          {requiresTutorial && selectedPlayMode !== 'practice' && !mobilePwaInstallRequired && (
            <button
              type="button"
              onClick={runSkipTutorial}
              disabled={isLoading || isSkippingTutorial}
              className="play-secondary-cta"
            >
              {isSkippingTutorial ? 'SKIPPING...' : 'SKIP TUTORIAL'}
            </button>
          )}
        </div>
      ) : (
        <LoginButton
          onClick={() => {
            playButtonClick();
            onLogin();
          }}
        />
      )}
    </div>
  );
}

function PlayModeSelector({
  isAuthenticated,
  hasWalletAccount,
  requiresTutorial,
  rankedSeason,
  selectedPlayMode,
  botFillEnabled,
  botFillDisabledReason,
  rankedTokenHoldStatus,
  rankedTokenHoldError,
  modeReadOnly,
  onSelectMode,
  onSetBotFillEnabled,
}: {
  isAuthenticated: boolean;
  hasWalletAccount: boolean;
  requiresTutorial: boolean;
  rankedSeason: RankedSeasonSnapshot;
  selectedPlayMode: PlayMenuMode;
  botFillEnabled: boolean;
  botFillDisabledReason: string | null;
  rankedTokenHoldStatus: RankedTokenHoldStatus | null;
  rankedTokenHoldError: string | null;
  modeReadOnly: boolean;
  onSelectMode: (mode: PlayMenuMode) => void;
  onSetBotFillEnabled: (enabled: boolean) => void;
}) {
  const renderModeOption = (mode: PlayMenuMode) => {
    const selected = mode === selectedPlayMode;
    const isRanked = mode === 'ranked';
    const locked = isRanked && (
      rankedSeason.mode === 'preseason' ||
      (isAuthenticated && rankedTokenHoldStatus?.eligible === false)
    );
    const title = getModeTitle({
      mode,
      isAuthenticated,
      hasWalletAccount,
      rankedSeason,
      requiresTutorial,
      rankedTokenHoldStatus,
      rankedTokenHoldError,
    });

    return (
      <div
        key={mode}
        className="play-mode-option-shell"
      >
        <button
          type="button"
          aria-pressed={selected}
          disabled={modeReadOnly}
          onClick={() => onSelectMode(mode)}
          className={`play-mode-option${selected ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`}
          title={modeReadOnly ? 'Party leader chooses the mode' : title}
        >
          <span className="play-mode-option-icon">
            <PlayModeIcon mode={mode} />
          </span>
          <span className="play-mode-option-copy">
            <span className="play-mode-option-title">{getPlayModeLabel(mode)}</span>
          </span>
        </button>
      </div>
    );
  };

  return (
    <div className="play-mode-selector" aria-label="Match mode and options">
      {PLAY_MODE_OPTIONS_BEFORE_BOT_FILL.map(renderModeOption)}
      <BotFillToggle
        enabled={botFillEnabled}
        disabledReason={botFillDisabledReason}
        onToggle={onSetBotFillEnabled}
      />
      {PLAY_MODE_OPTIONS_AFTER_BOT_FILL.map(renderModeOption)}
    </div>
  );
}

function BotFillToggle({
  enabled,
  disabledReason,
  onToggle,
}: {
  enabled: boolean;
  disabledReason: string | null;
  onToggle: (enabled: boolean) => void;
}) {
  const disabled = disabledReason !== null;

  return (
    <div className="play-mode-option-shell">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={disabled}
        className={`play-mode-option play-mode-bot-fill-toggle${enabled ? ' is-enabled' : ''}`}
        title={disabledReason ?? `${enabled ? 'Disable' : 'Enable'} bot fill`}
        onClick={() => onToggle(!enabled)}
      >
        <span className="play-mode-option-icon" aria-hidden="true">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M8.5 11.5a3.25 3.25 0 100-6.5 3.25 3.25 0 000 6.5zM3.5 19.25c.58-3.22 2.38-5.05 5-5.05s4.42 1.83 5 5.05" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M15.4 9.25a2.55 2.55 0 100-5.1M14.6 13.95c2.6.25 4.3 2 4.9 5.3" />
          </svg>
        </span>
        <span className="play-mode-option-copy">
          <span className="play-mode-option-title">BOT FILL</span>
          <span className="play-mode-bot-fill-status">{enabled ? 'ON' : 'OFF'}</span>
        </span>
        <span className="play-mode-bot-fill-switch" aria-hidden="true">
          <span />
        </span>
      </button>
    </div>
  );
}

function shouldShowServerLatencyAdvisory(snapshot: ServerLatencyProbeSnapshot): boolean {
  return snapshot.averagePingMs !== null && snapshot.averagePingMs > PING_ADVISORY_VISIBLE_MIN_MS;
}

function ServerLatencyAdvisory({ snapshot }: { snapshot: ServerLatencyProbeSnapshot }) {
  const pingValue = snapshot.averagePingMs === null ? '--' : String(snapshot.averagePingMs);
  const displayQuality = snapshot.quality === 'good' ? 'fair' : snapshot.quality;
  const statusLabel = (() => {
    switch (displayQuality) {
      case 'fair':
        return `Ping ${pingValue} milliseconds. Playable, with a little delay.`;
      case 'high':
        return `High ping ${pingValue} milliseconds. Playable, but combat may feel delayed.`;
      case 'offline':
        return 'Connection check failed. Matchmaking may have trouble reaching the server.';
      case 'checking':
      default:
        return 'Checking connection. Sampling server response before you queue.';
    }
  })();

  return (
    <div
      className="play-ping-advisory"
      data-quality={displayQuality}
      title={snapshot.error ?? statusLabel}
      aria-label={statusLabel}
      aria-live={displayQuality === 'high' || displayQuality === 'offline' ? 'polite' : 'off'}
    >
      <span className="play-ping-advisory-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 13.5a11.2 11.2 0 0116 0" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7.5 17a6.2 6.2 0 019 0" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M12 20h.01" />
        </svg>
      </span>
      <span className="play-ping-advisory-value" aria-hidden="true">
        {pingValue}
        <span className="play-ping-advisory-unit">ms</span>
      </span>
    </div>
  );
}

function RankedSeasonPlate({ season }: { season: RankedSeasonSnapshot }) {
  const seasonBoundary = formatSeasonBoundaryDate(season);

  return (
    <aside className="play-season-plate" aria-label={`${season.label}. ${seasonBoundary}. ${SEASON_RULES_ARIA}`}>
      <div className="play-season-plate-kicker">
        <span>Ranked</span>
        <span aria-hidden="true">-</span>
        <span>{seasonBoundary}</span>
      </div>
      <div className="play-season-plate-title">{season.label}</div>
    </aside>
  );
}

function EarningRulesPlate({ tokenSymbol, economy }: { tokenSymbol: string | null; economy: RewardEconomy | null }) {
  const rules = getEarningRules(tokenSymbol, economy);
  if (rules.length === 0) return null;

  return (
    <aside className="play-earnings-plate" aria-label="Ways to earn and payout rules">
      <ul className="play-earnings-rule-list">
        {rules.map((rule) => (
          <li key={rule.label}>
            <span className="play-earnings-rule-label">{rule.label}:</span>
            <span>{rule.value}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

interface CreateProfileModalProps {
  pendingRegistrationDisplayName: string;
  pendingRegistrationProviderLabel: string;
  newPlayerName: string;
  nameError: string | null;
  isRegistering: boolean;
  onDisconnect: () => void;
  onRegister: () => void;
  onNameChange: (name: string) => void;
  onNameErrorClear: () => void;
  onClose: () => void;
}

function CreateProfileModal({
  pendingRegistrationDisplayName,
  pendingRegistrationProviderLabel,
  newPlayerName,
  nameError,
  isRegistering,
  onDisconnect,
  onRegister,
  onNameChange,
  onNameErrorClear,
  onClose,
}: CreateProfileModalProps) {
  const walletLogo = { id: 'solana-wallet', name: 'Solana Wallet' };
  const connectedPanelStyle = {
    '--login-provider-panel-bg': pendingRegistrationProviderLabel === 'Discord'
      ? DISCORD_AUTH_COLORS.panelBg
      : 'rgba(255, 255, 255, 0.055)',
    '--login-provider-panel-border': pendingRegistrationProviderLabel === 'Discord'
      ? DISCORD_AUTH_COLORS.panelBorder
      : 'rgba(255, 255, 255, 0.12)',
  } as CSSProperties;
  const connectedIconStyle = {
    color: pendingRegistrationProviderLabel === 'Discord' ? DISCORD_AUTH_COLORS.icon : 'white',
  } as CSSProperties;
  const connectedIcon = pendingRegistrationProviderLabel === 'Discord'
    ? <DiscordIcon className="w-6 h-6 text-white" />
    : <WalletProviderLogo wallet={walletLogo} className="w-6 h-6" />;

  return (
    <GameDialog
      title="CREATE PROFILE"
      icon={connectedIcon}
      iconClassName="bg-white/5 border border-white/10"
      size="sm"
      onClose={onClose}
      bodyClassName="p-5 space-y-3"
    >
      <div
        className="flex items-center justify-between p-3 bg-[var(--login-provider-panel-bg)] border border-[var(--login-provider-panel-border)] rounded-lg"
        style={connectedPanelStyle}
      >
        <div className="flex items-center gap-3">
          {pendingRegistrationProviderLabel === 'Discord'
            ? <DiscordIcon className="w-6 h-6" style={connectedIconStyle} />
            : <WalletProviderLogo wallet={walletLogo} className="w-6 h-6" style={connectedIconStyle} />}
          <div>
            <p className="text-white/60 text-xs font-body">{pendingRegistrationProviderLabel} Connected</p>
            <p className="text-white text-sm font-body">
              {pendingRegistrationDisplayName}
            </p>
          </div>
        </div>
 <button
 onClick={onDisconnect}
 className="text-white/40 hover:text-white/80"
 >
 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
 </svg>
 </button>
      </div>

      <div>
        <label className="block text-xs font-body text-white/50 uppercase tracking-wider mb-2">
          Player Name
        </label>
        <div className="relative">
          <input
            type="text"
            value={newPlayerName}
            onChange={(e) => {
              onNameChange(e.target.value);
              onNameErrorClear();
            }}
            placeholder="Enter your name"
            maxLength={16}
            className="input w-full px-3.5 py-2.5 text-base"
            onKeyDown={(e) => e.key === 'Enter' && onRegister()}
            autoFocus
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/30 font-mono">
            {newPlayerName.length}/16
          </div>
        </div>
      </div>

      {nameError && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg animate-fade-in">
          <p className="text-red-400 text-sm font-body">{nameError}</p>
        </div>
      )}

 <button
 onClick={onRegister}
 disabled={isRegistering}
 className="btn btn-primary w-full py-3 rounded-lg text-base clip-corner"
 >
 <span className="flex items-center justify-center gap-2">
 {isRegistering ? (
 <>
 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24">
 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
 </svg>
 CREATING...
 </>
 ) : (
 <>
 <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
 <path d="M8 5v14l11-7z" />
 </svg>
 START PLAYING
 </>
 )}
 </span>
 </button>

 <button
 onClick={onClose}
 className="w-full py-3 rounded-xl font-display text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white"
 >
 CANCEL
 </button>
    </GameDialog>
  );
}
