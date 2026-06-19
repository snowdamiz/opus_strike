import { lazy, Suspense, type CSSProperties, useCallback, useState, useEffect, useRef } from 'react';
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
import { useWallet } from '../../contexts/WalletContext';
import { HeroesPage } from './HeroesPage';
import { StatsPage } from './StatsPage';
import { SettingsModal } from './SettingsModal';
import { GameDialog } from './GameDialog';
import type { HeroPreviewAnimationMode } from './HeroPreviewCanvas';
import { LobbyBackdrop } from './LobbyBackdrop';
import { SocialBox, SocialButton, useSocialBadgeCount } from './SocialBox';
import { TopNavIconButton } from './TopNavIconButton';
import { HeroIcon } from './HeroIcons';
import { useUISounds } from '../../hooks/useUiAudio';
import { useServerLatencyProbe } from '../../hooks/useServerLatencyProbe';
import { config } from '../../config/environment';
import {
  ALL_HERO_IDS,
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_MATCH_PERSPECTIVE,
  DEFAULT_RANKED_SEASON_NUMBER,
  HERO_DEFINITIONS,
  MATCH_PERSPECTIVES,
  PARTY_MAX_MEMBERS,
  getMatchPerspectiveSettingMode,
  getGameplayModeRules,
  getGameplayModeLabel,
  getHumanPartyHeroIds,
  getRankedSeasonLabel,
} from '@voxel-strike/shared';
import type {
  GameplayMode,
  HeroId,
  MatchPerspective,
  MatchPerspectiveSettingMode,
  MatchPerspectiveSettings,
  PartyBotFillSettings,
  PartyMemberSnapshot,
  PartyMode,
  PartyStateSnapshot,
  RankedSeasonSnapshot,
} from '@voxel-strike/shared';
import { DISCORD_AUTH_COLORS, HERO_COLORS, WALLET_AUTH_COLORS } from '../../styles/colorTokens';
import { PwaInstallToast } from './PwaInstallToast';
import {
  RUNNING_GAME_SESSION_EVENT,
  RUNNING_GAME_SESSION_STORAGE_KEY,
  type RunningGameSession,
} from '../../utils/runningGameSession';
import { clearActivePartySession, loadActivePartySession } from '../../utils/activePartySession';
import {
  PLAY_MODE_OPTIONS,
  loadPlayMenuPreferences,
  savePlayMenuPreferences,
  type PlayMenuMode,
  type PlayMenuPreferences,
} from '../../utils/playMenuPreferences';
import type { ServerLatencyProbeSnapshot } from '../../utils/serverLatency';
import { requiresTutorial } from '../../utils/tutorialAccess';
import { RankIcon, getRankForStats } from './RankBadge';

const FeaturedHeroPreview = lazy(() => import('./FeaturedHeroPreview').then((module) => ({
  default: module.FeaturedHeroPreview,
})));
const HERO_IDLE_ANIMATION_MODE: HeroPreviewAnimationMode = 'idle';
const PLAY_PARTY_SLOT_COUNT = PARTY_MAX_MEMBERS;
const BATTLE_ROYAL_MAX_SQUAD_SIZE = getGameplayModeRules('battle_royal').maxTeamSize;
const PING_ADVISORY_VISIBLE_MIN_MS = 100;

function DiscordIcon({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.54 5.34A18.2 18.2 0 0015.02 4c-.2.36-.42.84-.58 1.22a16.9 16.9 0 00-5.01 0A11.7 11.7 0 008.84 4c-1.6.27-3.12.72-4.52 1.34C1.46 9.6.68 13.74 1.07 17.81A18.5 18.5 0 006.61 20.6c.45-.61.84-1.26 1.18-1.95-.65-.24-1.27-.54-1.86-.89.16-.12.31-.24.46-.36a13.05 13.05 0 0011.14 0l.46.36c-.6.35-1.22.65-1.87.89.34.69.74 1.34 1.18 1.95a18.43 18.43 0 005.55-2.79c.46-4.72-.78-8.82-3.31-12.47zM8.52 15.3c-1.08 0-1.97-.99-1.97-2.2 0-1.22.87-2.2 1.97-2.2 1.1 0 1.99.99 1.97 2.2 0 1.21-.87 2.2-1.97 2.2zm6.96 0c-1.08 0-1.97-.99-1.97-2.2 0-1.22.87-2.2 1.97-2.2 1.1 0 1.99.99 1.97 2.2 0 1.21-.87 2.2-1.97 2.2z" />
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
type MainTab = 'play' | 'heroes' | 'stats' | 'loadout';
const RANKED_NATIVE_SOL_ADDRESS = 'So11111111111111111111111111111111111111112';
const DEFAULT_RANKED_SEASON: RankedSeasonSnapshot = {
  mode: 'season',
  seasonNumber: DEFAULT_RANKED_SEASON_NUMBER,
  label: getRankedSeasonLabel({ mode: 'season', seasonNumber: DEFAULT_RANKED_SEASON_NUMBER }),
  endsAt: null,
};
const SEASON_RULES_ARIA = 'Season rewards and ranked history are tracked by season.';

function formatRankedUsdCents(usdCents: number): string {
  const normalizedCents = Number.isInteger(usdCents) && usdCents > 0 ? usdCents : 0;
  const dollars = Math.floor(normalizedCents / 100);
  const cents = normalizedCents % 100;
  return cents === 0 ? `$${dollars}` : `$${dollars}.${cents.toString().padStart(2, '0')}`;
}

function rankedTokenHoldRequirement(status: RankedTokenHoldStatus): string {
  return `${formatRankedUsdCents(status.usdCents)} hold`;
}

function formatSeasonBoundaryDate(season: RankedSeasonSnapshot): string {
  const fallback = season.mode === 'preseason' ? 'Opens TBA' : 'Ends TBA';
  if (!season.endsAt) return fallback;
  const date = new Date(season.endsAt);
  if (Number.isNaN(date.getTime())) return fallback;
  const formattedDate = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return season.mode === 'preseason' ? `Opens ${formattedDate}` : `Ends ${formattedDate}`;
}

function getGameplayModeForPlayMode(mode: PlayMenuMode): GameplayMode {
  switch (mode) {
    case 'team_deathmatch':
      return 'team_deathmatch';
    case 'battle_royal':
      return 'battle_royal';
    case 'practice':
    case 'ranked':
    case 'quick_play':
    default:
      return DEFAULT_GAMEPLAY_MODE;
  }
}

function getPartyModeForPlayMode(mode: PlayMenuMode): PartyMode {
  return mode === 'team_deathmatch' || mode === 'battle_royal' ? 'quick_play' : mode;
}

function getPlayModeFromParty(party: PartyStateSnapshot): PlayMenuMode {
  if (party.selectedMode === 'quick_play' || party.selectedMode === 'custom') {
    if (party.gameplayMode === 'team_deathmatch') return 'team_deathmatch';
    if (party.gameplayMode === 'battle_royal') return 'battle_royal';
  }
  return party.selectedMode === 'custom' ? 'quick_play' : party.selectedMode;
}

function getBotFillGameplayModeForPlayMode(mode: PlayMenuMode): GameplayMode | null {
  switch (mode) {
    case 'quick_play':
      return DEFAULT_GAMEPLAY_MODE;
    case 'team_deathmatch':
      return 'team_deathmatch';
    case 'battle_royal':
      return 'battle_royal';
    case 'ranked':
    case 'practice':
    default:
      return null;
  }
}

function getBotFillEnabledForPlayMode(
  mode: PlayMenuMode,
  settings: PartyBotFillSettings
): boolean {
  const gameplayMode = getBotFillGameplayModeForPlayMode(mode);
  return gameplayMode ? settings[gameplayMode] === true : false;
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

function getPerspectiveLabel(perspective: MatchPerspective): string {
  return perspective === 'third_person' ? 'Third Person' : 'First Person';
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
    joinParty,
    restoreParty,
    getActivePartySession,
    setPartyHero,
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
  const {
    walletAddress,
    isAuthenticated,
    isNewUser,
    user,
    pendingRegistration,
    suggestedPlayerName,
    hasPhantomAccount,
    logout,
    signInWithDiscord,
    linkPhantom,
    registerUser,
    clearError,
    clearNotice,
  } = useWallet();

  const [activeTab, setActiveTab] = useState<MainTab>('play');
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  const [matchSettingsMode, setMatchSettingsMode] = useState<PlayMenuMode | null>(null);
  const [featuredHero, setFeaturedHero] = useState<HeroId>('blaze');
  const [playMenuPreferences, setPlayMenuPreferences] = useState<PlayMenuPreferences>(loadPlayMenuPreferences);
  const [rankedTokenHoldStatus, setRankedTokenHoldStatus] = useState<RankedTokenHoldStatus | null>(null);
  const [isRankedTokenHoldLoading, setIsRankedTokenHoldLoading] = useState(false);
  const [rankedTokenHoldError, setRankedTokenHoldError] = useState<string | null>(null);
  const [rankedSeason, setRankedSeason] = useState<RankedSeasonSnapshot>(DEFAULT_RANKED_SEASON);
  const [runningGameSession, setRunningGameSession] = useState<RunningGameSession | null>(null);
  const [isReconnectChecking, setIsReconnectChecking] = useState(false);
  const heroAnimationMode = HERO_IDLE_ANIMATION_MODE;

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLinkingPhantom, setIsLinkingPhantom] = useState(false);
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
  const isInParty = Boolean(party);
  const isPartyLeader = isPartyLeaderForUser(party, localPartyUserId);
  const isPartyReadyToStart = arePartyMembersReady(party);
  const selectedPlayMode = playMenuPreferences.selectedPlayMode;
  const botFillEnabledByMode = playMenuPreferences.botFillEnabledByMode;
  const perspectiveByMode = playMenuPreferences.perspectiveByMode;
  const activePlayMode = party ? getPlayModeFromParty(party) : selectedPlayMode;
  const activeBotFillEnabledByMode = party?.botFillEnabledByMode ?? botFillEnabledByMode;
  const activePerspectiveByMode = party?.perspectiveByMode ?? perspectiveByMode;
  const currentRank = getRankForStats(userStats);
  const soloPartyMember: PartyMemberSnapshot | null = isAuthenticated
    ? {
        userId: user?.id ?? 'local-player',
        displayName: playerName || user?.name || 'Player',
        heroId: featuredHero,
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

      try {
        if (!partyId) throw new Error('Saved party room is unavailable');
        await joinParty(rejoinName, partyId, heroId);
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
          await restoreParty(rejoinName, persistentPartyId, heroId);
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
    user?.id,
    user?.name,
  ]);

  useEffect(() => {
    if (activePlayMode !== 'ranked' || !isAuthenticated || !hasPhantomAccount || isRankedPreseason) {
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
  }, [activePlayMode, getRankedTokenHoldStatus, hasPhantomAccount, isAuthenticated, isRankedPreseason, user?.walletAddress, walletAddress]);

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

  const handleDiscordSignIn = () => {
    clearError();
    clearNotice();
    signInWithDiscord();
  };

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

  const handleLinkPhantom = async (): Promise<boolean> => {
    if (hasPhantomAccount) return true;
    if (isLinkingPhantom) return false;

    setError(null);
    clearError();
    clearNotice();
    setIsLinkingPhantom(true);
    try {
      const linkedUser = await linkPhantom();
      storeSetPlayerName(linkedUser.name);
      setUser(linkedUser.id, linkedUser.name, linkedUser.stats);
      setWalletAddress(linkedUser.walletAddress ?? null);
      return Boolean(linkedUser.walletAddress);
    } catch (err: any) {
      setError(err.message || 'Failed to connect Phantom');
      return false;
    } finally {
      setIsLinkingPhantom(false);
    }
  };

  const shouldShowPwaInstallToast = (
    activeTab === 'play' &&
    !showSettings &&
    !showSocial &&
    !showProfileModal
  );

  const discordDisplayName = pendingRegistration?.displayName
    || user?.linkedAccounts.find((account) => account.provider === 'discord')?.displayName
    || 'Discord';

  const handleSelectHero = (heroId: HeroId) => {
    setFeaturedHero(heroId);
    if (isInParty) {
      setPartyHero(heroId);
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
      await quickPlay(playerName, gameplayMode, botFillEnabled, featuredHero, matchPerspective);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to find a match');
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

  const handlePracticeGame = (mapSeed?: number) => {
    setError(null);
    startPracticeGame(playerName, {
      mapSeed,
      heroId: featuredHero,
      matchPerspective: getMatchPerspectiveForPlayMode('practice', activePerspectiveByMode),
    });
  };

  const handleStartTutorial = () => {
    setError(null);
    startTutorialGame(playerName);
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
      handleDiscordSignIn();
      return;
    }
    if (!hasPhantomAccount) {
      const linked = await handleLinkPhantom();
      if (!linked) return;
      setRankedTokenHoldStatus(null);
      setRankedTokenHoldError(null);
    }
    if (isRankedTokenHoldLoading) {
      return;
    }
    if (rankedTokenHoldStatus?.eligible === false) {
      setError(`Ranked requires ${rankedTokenHoldRequirement(rankedTokenHoldStatus)}.`);
      return;
    }
    try {
      await rankedPlay(playerName, featuredHero);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enter ranked');
    }
  };

  const handleSelectPlayMode = (mode: PlayMenuMode) => {
    if (isInParty) {
      if (isPartyLeader) {
        setPartyMode(getPartyModeForPlayMode(mode), getGameplayModeForPlayMode(mode));
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

  const handleSetBotFillEnabled = (gameplayMode: GameplayMode, enabled: boolean) => {
    if (isInParty) {
      if (isPartyLeader) {
        setPartyBotFill(gameplayMode, enabled);
      }
      return;
    }

    updatePlayMenuPreferences((current) => (
      current.botFillEnabledByMode[gameplayMode] === enabled ? current : {
        ...current,
        botFillEnabledByMode: {
          ...current.botFillEnabledByMode,
          [gameplayMode]: enabled,
        },
      }
    ));
  };

  const handleSetMatchPerspective = (modeKey: MatchPerspectiveSettingMode, perspective: MatchPerspective) => {
    if (isInParty) {
      if (isPartyLeader) {
        setPartyPerspective(modeKey, perspective);
      }
      return;
    }

    updatePlayMenuPreferences((current) => (
      current.perspectiveByMode[modeKey] === perspective ? current : {
        ...current,
        perspectiveByMode: {
          ...current.perspectiveByMode,
          [modeKey]: perspective,
        },
      }
    ));
  };

  const handleSelectedPlayAction = () => {
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
          getBotFillEnabledForPlayMode(activePlayMode, activeBotFillEnabledByMode),
          getMatchPerspectiveForPlayMode(activePlayMode, activePerspectiveByMode)
        );
        break;
      case 'practice':
        handlePracticeGame();
        break;
      case 'quick_play':
      default:
        void handleQuickPlay(
          DEFAULT_GAMEPLAY_MODE,
          getBotFillEnabledForPlayMode('quick_play', activeBotFillEnabledByMode),
          getMatchPerspectiveForPlayMode('quick_play', activePerspectiveByMode)
        );
        break;
    }
  };

  const handleBack = () => setAppPhase('menu');

  const heroColor = HERO_COLORS[featuredHero];

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

          <div className="main-lobby-tabs flex min-w-0 items-center">
            {(['play', 'heroes', 'stats', 'loadout'] as MainTab[]).map((tab) => (
 <button
 key={tab}
 onClick={() => { playButtonClick(); setActiveTab(tab); }}
 className={`relative px-3 lg:px-5 xl:px-6 py-3 font-display text-base xl:text-lg tracking-wide whitespace-nowrap ${activeTab === tab ? 'text-white' : 'text-white/40 hover:text-white/70'
 }`}
 >
 {tab.toUpperCase()}
 {activeTab === tab && (
 <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
 )}
 </button>
            ))}
          </div>

          {/* Right side controls */}
          <div className="main-lobby-controls flex shrink-0 items-center gap-3 xl:gap-4">
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

      {/* Main Content Area */}
      <div className={`menu-main ${activeTab === 'play' ? 'menu-main-play' : ''}`}>
        {activeTab === 'play' && (
          <PlayTab
            isLoading={isLoading}
            featuredHero={featuredHero}
            heroColor={heroColor}
            heroAnimationMode={heroAnimationMode}
            rankedSeason={rankedSeason}
            isAuthenticated={isAuthenticated}
            hasPhantomAccount={hasPhantomAccount}
            requiresTutorial={tutorialRequired}
            error={error ?? partyLaunchError}
            party={party}
            soloPartyMember={soloPartyMember}
            localPartyUserId={localPartyUserId}
            isPartyLeader={isPartyLeader}
            isPartyReadyToStart={isPartyReadyToStart}
            selectedPlayMode={activePlayMode}
            botFillEnabledByMode={activeBotFillEnabledByMode}
            perspectiveByMode={activePerspectiveByMode}
            rankedTokenHoldStatus={rankedTokenHoldStatus}
            rankedTokenHoldError={rankedTokenHoldError}
            runningGameSession={runningGameSession}
            isReconnectChecking={isReconnectChecking}
            serverLatency={serverLatency}
            onSelectPlayMode={handleSelectPlayMode}
            onOpenMatchSettings={setMatchSettingsMode}
            onPlayAction={handleSelectedPlayAction}
            onKickPartyMember={kickPartyMember}
            onLeaveParty={leaveParty}
            onOpenSocial={() => setShowSocial(true)}
            onStartTutorial={handleStartTutorial}
            onReconnect={handleReconnectGame}
            onDiscordSignIn={handleDiscordSignIn}
            onSelectHero={handleSelectHero}
          />
        )}
        {activeTab === 'heroes' && (
          <HeroesPage
            selectedHero={featuredHero}
            onSelectHero={handleSelectHero}
          />
        )}
        {activeTab === 'stats' && <StatsPage />}
        {activeTab === 'loadout' && (
          <div className="h-full flex items-center justify-center menu-content">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                <svg className="w-10 h-10 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <h2 className="font-display text-3xl text-white/40">LOADOUT</h2>
              <p className="text-white/20 font-body mt-2">Coming Soon</p>
            </div>
          </div>
        )}
      </div>

      {shouldShowPwaInstallToast && <PwaInstallToast />}

      {/* Modals */}
      {showSocial && isAuthenticated && (
        <SocialBox
          selectedHero={featuredHero}
          onClose={() => setShowSocial(false)}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {matchSettingsMode && (
        <MatchSettingsDialog
          mode={matchSettingsMode}
          botFillEnabledByMode={activeBotFillEnabledByMode}
          perspectiveByMode={activePerspectiveByMode}
          settingsDisabled={isInParty && !isPartyLeader}
          onSetBotFillEnabled={handleSetBotFillEnabled}
          onSetMatchPerspective={handleSetMatchPerspective}
          onClose={() => setMatchSettingsMode(null)}
        />
      )}

      {showProfileModal && (
        <CreateProfileModal
          pendingRegistrationDisplayName={discordDisplayName}
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

// Play Tab Component
interface PlayTabProps {
  isLoading: boolean;
  featuredHero: HeroId;
  heroColor: string;
  heroAnimationMode: HeroPreviewAnimationMode;
  rankedSeason: RankedSeasonSnapshot;
  isAuthenticated: boolean;
  hasPhantomAccount: boolean;
  requiresTutorial: boolean;
  error: string | null;
  party: PartyStateSnapshot | null;
  soloPartyMember: PartyMemberSnapshot | null;
  localPartyUserId: string | null;
  isPartyLeader: boolean;
  isPartyReadyToStart: boolean;
  selectedPlayMode: PlayMenuMode;
  botFillEnabledByMode: PartyBotFillSettings;
  perspectiveByMode: MatchPerspectiveSettings;
  rankedTokenHoldStatus: RankedTokenHoldStatus | null;
  rankedTokenHoldError: string | null;
  runningGameSession: RunningGameSession | null;
  isReconnectChecking: boolean;
  serverLatency: ServerLatencyProbeSnapshot | null;
  onSelectPlayMode: (mode: PlayMenuMode) => void;
  onOpenMatchSettings: (mode: PlayMenuMode) => void;
  onPlayAction: () => void;
  onKickPartyMember: (userId: string) => void;
  onLeaveParty: () => void;
  onOpenSocial: () => void;
  onStartTutorial: () => void;
  onReconnect: () => void;
  onDiscordSignIn: () => void;
  onSelectHero: (heroId: HeroId) => void;
}

function PlayTab({
  isLoading,
  featuredHero,
  heroColor,
  heroAnimationMode,
  rankedSeason,
  isAuthenticated,
  hasPhantomAccount,
  requiresTutorial,
  error,
  party,
  soloPartyMember,
  localPartyUserId,
  isPartyLeader,
  isPartyReadyToStart,
  selectedPlayMode,
  botFillEnabledByMode,
  perspectiveByMode,
  rankedTokenHoldStatus,
  rankedTokenHoldError,
  runningGameSession,
  isReconnectChecking,
  serverLatency,
  onSelectPlayMode,
  onOpenMatchSettings,
  onPlayAction,
  onKickPartyMember,
  onLeaveParty,
  onOpenSocial,
  onStartTutorial,
  onReconnect,
  onDiscordSignIn,
  onSelectHero,
}: PlayTabProps) {
  const { playButtonClick } = useUISounds();
  const canReconnect = isAuthenticated && Boolean(runningGameSession);
  const localPartyMember = getPartyMember(party, localPartyUserId);
  const isInParty = Boolean(party);
  const lineupMembers = party?.members ?? (soloPartyMember ? [soloPartyMember] : []);
  const lineupLocalUserId = party ? localPartyUserId : soloPartyMember?.userId ?? null;
  const mainPlayLabel = isReconnectChecking
    ? 'CHECKING...'
    : canReconnect
      ? 'RECONNECT'
      : requiresTutorial
        ? isLoading
          ? 'STARTING...'
          : 'START TUTORIAL'
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
  const partySize = party?.members.length ?? 1;
  const isBattleRoyalPartyTooLarge = selectedPlayMode === 'battle_royal' &&
    partySize > BATTLE_ROYAL_MAX_SQUAD_SIZE;
  const primaryDisabled = isLoading || isReconnectChecking || (
    isInParty && isPartyLeader && !isPartyReadyToStart
  ) || isBattleRoyalPartyTooLarge || (
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
    requiresTutorial,
    selectedPlayMode,
    partySize,
    rankedSeason,
    rankedTokenHoldStatus,
  });
  const handleLineupAddMember = () => {
    playButtonClick();
    if (isAuthenticated) {
      onOpenSocial();
    } else {
      onDiscordSignIn();
    }
  };

  return (
    <div className={`play-tab-shell h-full menu-content ${party ? 'is-party-mode' : 'is-solo-mode'}`}>
      <PlayActionStack
        error={error}
        heroColor={heroColor}
        isLoading={isLoading}
        isAuthenticated={isAuthenticated}
        hasPhantomAccount={hasPhantomAccount}
        requiresTutorial={requiresTutorial}
        rankedSeason={rankedSeason}
        selectedPlayMode={selectedPlayMode}
        botFillEnabledByMode={botFillEnabledByMode}
        perspectiveByMode={perspectiveByMode}
        rankedTokenHoldStatus={rankedTokenHoldStatus}
        rankedTokenHoldError={rankedTokenHoldError}
        party={party}
        soloPartyMember={soloPartyMember}
        isPartyLeader={isPartyLeader}
        localPartyUserId={localPartyUserId}
        canReconnect={canReconnect}
        isReconnectChecking={isReconnectChecking}
        mainPlayLabel={mainPlayLabel}
        primaryDisabled={primaryDisabled}
        primaryDisabledReason={primaryDisabledReason}
        onSelectPlayMode={onSelectPlayMode}
        onOpenMatchSettings={onOpenMatchSettings}
        onKickPartyMember={onKickPartyMember}
        onLeaveParty={onLeaveParty}
        onOpenSocial={onOpenSocial}
        onDiscordSignIn={onDiscordSignIn}
        onReconnect={onReconnect}
        onStartTutorial={onStartTutorial}
        onPlayAction={onPlayAction}
      />
      <div className="play-tab-stage menu-compact-scale relative">
        <PartyLineup
          members={lineupMembers}
          localUserId={lineupLocalUserId}
          featuredHero={featuredHero}
          heroAnimationMode={heroAnimationMode}
          onSelectHero={onSelectHero}
          onAddMember={handleLineupAddMember}
        />
      </div>
      {serverLatency && shouldShowServerLatencyAdvisory(serverLatency) && (
        <ServerLatencyAdvisory snapshot={serverLatency} />
      )}
      <RankedSeasonPlate season={rankedSeason} />
    </div>
  );
}

function PartyLineup({
  members,
  localUserId,
  featuredHero,
  heroAnimationMode,
  onSelectHero,
  onAddMember,
}: {
  members: PartyMemberSnapshot[];
  localUserId: string | null;
  featuredHero: HeroId;
  heroAnimationMode: HeroPreviewAnimationMode;
  onSelectHero: (heroId: HeroId) => void;
  onAddMember: () => void;
}) {
  const visibleMembers = members.slice(0, PLAY_PARTY_SLOT_COUNT);
  const emptySlotCount = Math.max(0, PLAY_PARTY_SLOT_COUNT - visibleMembers.length);
  const localMember = localUserId
    ? visibleMembers.find((member) => member.userId === localUserId) ?? null
    : null;
  const selectedHero = localMember?.heroId ?? featuredHero;
  const lockedHeroIds = getHumanPartyHeroIds(visibleMembers, localUserId);

  return (
    <div className="party-lineup-stage">
      <div
        className="party-lineup-grid"
        data-count={PLAY_PARTY_SLOT_COUNT}
      >
        {visibleMembers.map((member) => {
          const heroColor = HERO_COLORS[member.heroId];
          const hero = HERO_DEFINITIONS[member.heroId];
          const isLocalMember = member.userId === localUserId;
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
                  accentColor={heroColor}
                  initialYaw={Math.PI - 0.12}
                  animationMode={heroAnimationMode}
                  rank={member.rank}
                  className="party-member-preview"
                />
              </Suspense>
              <div className="party-member-labels">
                <div className="party-member-identity">
                  <span className="party-member-hero-icon" style={{ color: heroColor }}>
                    <HeroIcon heroId={member.heroId} size={18} />
                  </span>
                  <span className="party-member-name">{member.displayName}</span>
                </div>
                <div className="party-member-meta">
                  <span>{hero.name}</span>
                  <span>{member.leader ? 'LEADER' : member.ready ? 'READY' : 'NOT READY'}</span>
                </div>
              </div>
              {isLocalMember ? (
                <PartyHeroPicker
                  selectedHero={selectedHero}
                  lockedHeroIds={lockedHeroIds}
                  onSelectHero={onSelectHero}
                />
              ) : (
                <div className="party-hero-picker-placeholder" aria-hidden="true" />
              )}
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
        const heroColor = HERO_COLORS[heroId];
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
              '--party-hero-accent': heroColor,
            } as CSSProperties : undefined}
          >
            <HeroIcon heroId={heroId} size={18} />
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
  requiresTutorial: boolean;
  selectedPlayMode: PlayMenuMode;
  partySize: number;
  rankedSeason: RankedSeasonSnapshot;
  rankedTokenHoldStatus: RankedTokenHoldStatus | null;
}): string | null {
  if (input.isLoading) return null;
  if (input.isReconnectChecking) return 'Checking active match';
  if (input.selectedPlayMode === 'battle_royal' && input.partySize > BATTLE_ROYAL_MAX_SQUAD_SIZE) {
    return `Battle Royal squads are limited to ${BATTLE_ROYAL_MAX_SQUAD_SIZE} players`;
  }
  if (input.isInParty && input.isPartyLeader && !input.isPartyReadyToStart) {
    return 'Waiting for teammates to ready up';
  }
  if (input.selectedPlayMode !== 'ranked' || input.requiresTutorial) return null;
  if (input.rankedSeason.mode === 'preseason') return formatSeasonBoundaryDate(input.rankedSeason);
  if (input.rankedTokenHoldStatus?.eligible === false) {
    return `Ranked requires ${rankedTokenHoldRequirement(input.rankedTokenHoldStatus)}`;
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

function BotFillIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v2.2" />
      <rect x="5.8" y="7.2" width="12.4" height="9" rx="3" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.4 19h7.2" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.6} d="M9.2 11.7h.01M14.8 11.7h.01" />
    </svg>
  );
}

function SettingsCogIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M10.5 4.2c.38-1.58 2.62-1.58 3 0a1.55 1.55 0 002.32.96c1.39-.85 2.98.74 2.13 2.13a1.55 1.55 0 00.96 2.32c1.58.38 1.58 2.62 0 3a1.55 1.55 0 00-.96 2.32c.85 1.39-.74 2.98-2.13 2.13a1.55 1.55 0 00-2.32.96c-.38 1.58-2.62 1.58-3 0a1.55 1.55 0 00-2.32-.96c-1.39.85-2.98-.74-2.13-2.13a1.55 1.55 0 00-.96-2.32c-1.58-.38-1.58-2.62 0-3a1.55 1.55 0 00.96-2.32c-.85-1.39.74-2.98 2.13-2.13.9.55 2.07.06 2.32-.96z" />
      <circle cx="12" cy="12" r="2.35" strokeWidth={1.9} />
    </svg>
  );
}

function getModeTitle(input: {
  mode: PlayMenuMode;
  isAuthenticated: boolean;
  hasPhantomAccount: boolean;
  rankedSeason: RankedSeasonSnapshot;
  requiresTutorial: boolean;
  rankedTokenHoldStatus: RankedTokenHoldStatus | null;
  rankedTokenHoldError: string | null;
}): string {
  if (input.requiresTutorial && input.mode !== 'practice') return 'Complete the tutorial before online play';

  if (input.mode !== 'ranked') return getPlayModeLabel(input.mode);
  if (input.rankedSeason.mode === 'preseason') return 'Ranked is disabled during Pre-season';
  if (input.isAuthenticated && !input.hasPhantomAccount) return 'Connect Phantom before entering ranked';
  if (input.rankedTokenHoldStatus?.eligible === false) {
    return `Ranked requires ${rankedTokenHoldRequirement(input.rankedTokenHoldStatus)}`;
  }
  return input.rankedTokenHoldError ?? 'Competitive queue';
}

function MatchSettingsDialog({
  mode,
  botFillEnabledByMode,
  perspectiveByMode,
  settingsDisabled,
  onSetBotFillEnabled,
  onSetMatchPerspective,
  onClose,
}: {
  mode: PlayMenuMode;
  botFillEnabledByMode: PartyBotFillSettings;
  perspectiveByMode: MatchPerspectiveSettings;
  settingsDisabled: boolean;
  onSetBotFillEnabled: (gameplayMode: GameplayMode, enabled: boolean) => void;
  onSetMatchPerspective: (modeKey: MatchPerspectiveSettingMode, perspective: MatchPerspective) => void;
  onClose: () => void;
}) {
  const perspectiveMode = getPerspectiveSettingModeForPlayMode(mode);
  if (!perspectiveMode) return null;

  const botFillGameplayMode = getBotFillGameplayModeForPlayMode(mode);
  const botFillEnabled = botFillGameplayMode
    ? botFillEnabledByMode[botFillGameplayMode] === true
    : false;
  const selectedPerspective = perspectiveByMode[perspectiveMode] ?? DEFAULT_MATCH_PERSPECTIVE;
  const disabledTitle = settingsDisabled ? 'Party leader chooses match settings' : undefined;

  return (
    <GameDialog
      title={`${getPlayModeLabel(mode)} SETTINGS`}
      size="sm"
      icon={<SettingsCogIcon />}
      iconClassName="bg-white/10 text-white/80"
      bodyClassName="p-0"
      onClose={onClose}
    >
      <div className="match-settings-panel">
        {botFillGameplayMode && (
          <section className="match-settings-row">
            <div className="match-settings-row-copy">
              <span className="match-settings-row-title">Bots</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={botFillEnabled}
              disabled={settingsDisabled}
              className={`match-settings-switch${botFillEnabled ? ' is-enabled' : ''}`}
              title={disabledTitle ?? `${botFillEnabled ? 'Disable' : 'Enable'} bots`}
              onClick={() => onSetBotFillEnabled(botFillGameplayMode, !botFillEnabled)}
            >
              <span className="match-settings-switch-icon" aria-hidden="true">
                <BotFillIcon />
              </span>
              <span className="match-settings-switch-track" aria-hidden="true">
                <span className="match-settings-switch-thumb" />
              </span>
            </button>
          </section>
        )}

        <section className="match-settings-row is-stacked">
          <div className="match-settings-row-copy">
            <span className="match-settings-row-title">Perspective</span>
          </div>
          <div className="match-settings-segmented" role="radiogroup" aria-label="Perspective">
            {MATCH_PERSPECTIVES.map((perspective) => (
              <button
                key={perspective}
                type="button"
                role="radio"
                aria-checked={selectedPerspective === perspective}
                disabled={settingsDisabled}
                className={`match-settings-segment${selectedPerspective === perspective ? ' is-selected' : ''}`}
                title={disabledTitle}
                onClick={() => onSetMatchPerspective(perspectiveMode, perspective)}
              >
                {getPerspectiveLabel(perspective)}
              </button>
            ))}
          </div>
        </section>
      </div>
    </GameDialog>
  );
}

function PlayActionStack({
  error,
  heroColor,
  isLoading,
  isAuthenticated,
  hasPhantomAccount,
  requiresTutorial,
  rankedSeason,
  selectedPlayMode,
  botFillEnabledByMode,
  perspectiveByMode,
  rankedTokenHoldStatus,
  rankedTokenHoldError,
  party,
  soloPartyMember,
  isPartyLeader,
  localPartyUserId,
  canReconnect,
  isReconnectChecking,
  mainPlayLabel,
  primaryDisabled,
  primaryDisabledReason,
  onSelectPlayMode,
  onOpenMatchSettings,
  onKickPartyMember,
  onLeaveParty,
  onOpenSocial,
  onDiscordSignIn,
  onReconnect,
  onStartTutorial,
  onPlayAction,
}: {
  error: string | null;
  heroColor: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasPhantomAccount: boolean;
  requiresTutorial: boolean;
  rankedSeason: RankedSeasonSnapshot;
  selectedPlayMode: PlayMenuMode;
  botFillEnabledByMode: PartyBotFillSettings;
  perspectiveByMode: MatchPerspectiveSettings;
  rankedTokenHoldStatus: RankedTokenHoldStatus | null;
  rankedTokenHoldError: string | null;
  party: PartyStateSnapshot | null;
  soloPartyMember: PartyMemberSnapshot | null;
  isPartyLeader: boolean;
  localPartyUserId: string | null;
  canReconnect: boolean;
  isReconnectChecking: boolean;
  mainPlayLabel: string;
  primaryDisabled: boolean;
  primaryDisabledReason: string | null;
  onSelectPlayMode: (mode: PlayMenuMode) => void;
  onOpenMatchSettings: (mode: PlayMenuMode) => void;
  onKickPartyMember: (userId: string) => void;
  onLeaveParty: () => void;
  onOpenSocial: () => void;
  onDiscordSignIn: () => void;
  onReconnect: () => void;
  onStartTutorial: () => void;
  onPlayAction: () => void;
}) {
  const { playButtonClick } = useUISounds();
  const isInParty = Boolean(party);

  const runPrimaryAction = () => {
    playButtonClick();
    if (canReconnect) {
      onReconnect();
    } else if (requiresTutorial) {
      onStartTutorial();
    } else {
      onPlayAction();
    }
  };
  const handleInviteSlotClick = () => {
    playButtonClick();
    if (isAuthenticated) {
      onOpenSocial();
    } else {
      onDiscordSignIn();
    }
  };
  const teammateMembers = party?.members ?? (soloPartyMember ? [soloPartyMember] : []);
  const handleLeavePartyClick = isInParty ? () => {
    playButtonClick();
    onLeaveParty();
  } : undefined;
  const handleKickMember = isInParty && isPartyLeader ? (userId: string) => {
    playButtonClick();
    onKickPartyMember(userId);
  } : undefined;

  return (
    <div className="play-action-stack">
      <PlayPanelHeading />
      <PartyTeammateStrip
        members={teammateMembers}
        localUserId={localPartyUserId}
        canKickMembers={isInParty && isPartyLeader}
        onInviteClick={handleInviteSlotClick}
        onKickMember={handleKickMember}
        onLeaveClick={handleLeavePartyClick}
      />
      <PlayModeSelector
        heroColor={heroColor}
        isAuthenticated={isAuthenticated}
        hasPhantomAccount={hasPhantomAccount}
        requiresTutorial={requiresTutorial}
        rankedSeason={rankedSeason}
        selectedPlayMode={selectedPlayMode}
        botFillEnabledByMode={botFillEnabledByMode}
        perspectiveByMode={perspectiveByMode}
        rankedTokenHoldStatus={rankedTokenHoldStatus}
        rankedTokenHoldError={rankedTokenHoldError}
        modeReadOnly={isInParty && !isPartyLeader}
        onSelectMode={(mode) => {
          playButtonClick();
          onSelectPlayMode(mode);
        }}
        onOpenMatchSettings={(mode) => {
          playButtonClick();
          onOpenMatchSettings(mode);
        }}
      />
      {error && (
        <div className="play-action-error" role="status">
          {error}
        </div>
      )}
      {isAuthenticated ? (
        <div className="play-main-cta-wrap">
          <button
            type="button"
            onClick={runPrimaryAction}
            disabled={primaryDisabled}
            className="play-main-cta group"
            aria-describedby={primaryDisabledReason ? 'play-main-cta-disabled-reason' : undefined}
            style={{
              background: `linear-gradient(135deg, ${heroColor}, ${heroColor}dd)`,
              boxShadow: `0 0 60px ${heroColor}40, inset 0 1px 0 rgba(255,255,255,0.2)`,
            }}
          >
            <span
              className="absolute inset-0 opacity-0 group-hover:opacity-100"
              style={{ background: WALLET_AUTH_COLORS.shimmer }}
            />
            <span className="play-main-cta-content relative flex items-center justify-center gap-2">
              {canReconnect ? (
                <svg className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 4v6h6M20 20v-6h-6M5.5 14a7 7 0 0012.1 2.4M18.5 10A7 7 0 006.4 7.6" />
                </svg>
              ) : (
                <PlayModeIcon mode={selectedPlayMode} />
              )}
              {mainPlayLabel}
            </span>
          </button>
          {primaryDisabledReason && (
            <div
              id="play-main-cta-disabled-reason"
              className="play-disabled-reason"
              role="status"
            >
              {primaryDisabledReason}
            </div>
          )}
        </div>
      ) : (
        <DiscordSignInButton
          onClick={() => {
            playButtonClick();
            onDiscordSignIn();
          }}
          className="play-main-cta play-main-cta-discord group"
        />
      )}
    </div>
  );
}

function PartyTeammateStrip({
  members,
  localUserId,
  canKickMembers,
  onInviteClick,
  onKickMember,
  onLeaveClick,
}: {
  members: PartyMemberSnapshot[];
  localUserId: string | null;
  canKickMembers: boolean;
  onInviteClick: () => void;
  onKickMember?: (userId: string) => void;
  onLeaveClick?: () => void;
}) {
  const visibleMembers = members.slice(0, PLAY_PARTY_SLOT_COUNT);
  const hasInviteSlot = visibleMembers.length < PLAY_PARTY_SLOT_COUNT;

  return (
    <div
      className={`play-party-teammates${onLeaveClick ? ' has-leave-action' : ''}`}
      aria-label="Lobby teammates"
    >
      <span className="play-party-teammates-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="9" cy="7.25" r="3.15" strokeWidth={1.9} />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M3.35 19.25v-1.4A4.85 4.85 0 018.2 13h1.6a4.85 4.85 0 014.85 4.85v1.4" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M15.65 4.55a3.1 3.1 0 010 5.4" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M18.25 14.15a4.3 4.3 0 012.4 3.85v1.25" />
        </svg>
      </span>
      {visibleMembers.map((member) => {
        const canKickMember = canKickMembers && member.userId !== localUserId;
        const label = canKickMember ? `Kick ${member.displayName}` : member.displayName;
        const content = (
          <>
            <span className="play-party-teammate-rank">
              <RankIcon rank={member.rank} size={24} />
            </span>
            {canKickMember && (
              <span className="play-party-teammate-kick-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.6} d="M6 6l12 12M18 6L6 18" />
                </svg>
              </span>
            )}
            <span className="play-party-teammate-tooltip" role="tooltip">
              {label}
            </span>
          </>
        );

        return canKickMember ? (
          <button
            key={member.userId}
            type="button"
            className="play-party-teammate is-kickable"
            title={label}
            aria-label={`Kick ${member.displayName} from party`}
            onClick={() => onKickMember?.(member.userId)}
          >
            {content}
          </button>
        ) : (
          <div
            key={member.userId}
            className="play-party-teammate"
            role="img"
            tabIndex={0}
            title={member.displayName}
            aria-label={`${member.displayName}, ${member.rank.label}`}
          >
            {content}
          </div>
        );
      })}
      {hasInviteSlot && (
        <button
          type="button"
          className="play-party-teammate is-empty"
          title="Invite teammate"
          aria-label="Open friends to invite a teammate"
          onClick={onInviteClick}
        >
          <svg className="play-party-teammate-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 5v14m7-7H5" />
          </svg>
        </button>
      )}
      {onLeaveClick && (
        <>
          <span className="play-party-leave-divider" aria-hidden="true" />
          <button
            type="button"
            className="play-party-leave-button"
            title="Leave party"
            aria-label="Leave party"
            onClick={onLeaveClick}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

function PlayModeSelector({
  heroColor,
  isAuthenticated,
  hasPhantomAccount,
  requiresTutorial,
  rankedSeason,
  selectedPlayMode,
  botFillEnabledByMode,
  perspectiveByMode,
  rankedTokenHoldStatus,
  rankedTokenHoldError,
  modeReadOnly,
  onSelectMode,
  onOpenMatchSettings,
}: {
  heroColor: string;
  isAuthenticated: boolean;
  hasPhantomAccount: boolean;
  requiresTutorial: boolean;
  rankedSeason: RankedSeasonSnapshot;
  selectedPlayMode: PlayMenuMode;
  botFillEnabledByMode: PartyBotFillSettings;
  perspectiveByMode: MatchPerspectiveSettings;
  rankedTokenHoldStatus: RankedTokenHoldStatus | null;
  rankedTokenHoldError: string | null;
  modeReadOnly: boolean;
  onSelectMode: (mode: PlayMenuMode) => void;
  onOpenMatchSettings: (mode: PlayMenuMode) => void;
}) {
  return (
    <div className="play-mode-selector" role="radiogroup" aria-label="Match mode">
      {PLAY_MODE_OPTIONS.map((mode) => {
        const selected = mode === selectedPlayMode;
        const botFillGameplayMode = getBotFillGameplayModeForPlayMode(mode);
        const botFillEnabled = botFillGameplayMode
          ? botFillEnabledByMode[botFillGameplayMode] === true
          : false;
        const perspectiveSettingMode = getPerspectiveSettingModeForPlayMode(mode);
        const perspective = perspectiveSettingMode
          ? perspectiveByMode[perspectiveSettingMode]
          : DEFAULT_MATCH_PERSPECTIVE;
        const showSettingsButton = Boolean(perspectiveSettingMode);
        const isRanked = mode === 'ranked';
        const locked = isRanked && (
          rankedSeason.mode === 'preseason' ||
          (isAuthenticated && hasPhantomAccount && rankedTokenHoldStatus?.eligible === false)
        );
        const title = getModeTitle({
          mode,
          isAuthenticated,
          hasPhantomAccount,
          rankedSeason,
          requiresTutorial,
          rankedTokenHoldStatus,
          rankedTokenHoldError,
        });
        const optionStyle = selected ? {
          '--play-mode-accent': heroColor,
        } as CSSProperties : undefined;

        return (
          <div
            key={mode}
            className={`play-mode-option-shell${showSettingsButton ? ' has-settings-button' : ''}`}
            style={optionStyle}
          >
            <button
              type="button"
              role="radio"
              aria-checked={selected}
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
            {showSettingsButton && (
              <button
                type="button"
                aria-label={`Open match settings for ${getPlayModeLabel(mode)}`}
                disabled={modeReadOnly}
                className={`play-mode-settings-button${botFillEnabled ? ' has-bots-enabled' : ''}${perspective === 'third_person' ? ' has-third-person' : ''}`}
                title={modeReadOnly ? 'Party leader chooses match settings' : `Match settings: ${getPerspectiveLabel(perspective)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenMatchSettings(mode);
                }}
              >
                <SettingsCogIcon />
              </button>
            )}
          </div>
        );
      })}
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

function PlayPanelHeading() {
  return (
    <header className="play-panel-heading" aria-label="Play">
      <h2 className="play-panel-heading-title">Play</h2>
    </header>
  );
}

function RankedSeasonPlate({ season }: { season: RankedSeasonSnapshot }) {
  return (
    <aside className="play-season-plate" aria-label={`${season.label}. ${formatSeasonBoundaryDate(season)}. ${SEASON_RULES_ARIA}`}>
      <div className="play-season-plate-kicker">Ranked</div>
      <div className="play-season-plate-title">{season.label}</div>
      <div className="play-season-plate-end">{formatSeasonBoundaryDate(season)}</div>
    </aside>
  );
}

// Profile creation after Discord authentication
interface CreateProfileModalProps {
  pendingRegistrationDisplayName: string;
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
  newPlayerName,
  nameError,
  isRegistering,
  onDisconnect,
  onRegister,
  onNameChange,
  onNameErrorClear,
  onClose,
}: CreateProfileModalProps) {
  const discordPanelStyle = {
    '--discord-auth-panel-bg': DISCORD_AUTH_COLORS.panelBg,
    '--discord-auth-panel-border': DISCORD_AUTH_COLORS.panelBorder,
  } as CSSProperties;
  const discordIconStyle = { color: DISCORD_AUTH_COLORS.icon } as CSSProperties;

  return (
    <GameDialog
      title="CREATE PROFILE"
      icon={<DiscordIcon className="w-6 h-6 text-white" />}
      iconClassName="bg-white/5 border border-white/10"
      size="sm"
      onClose={onClose}
      bodyClassName="p-5 space-y-3"
    >
      <div
        className="flex items-center justify-between p-3 bg-[var(--discord-auth-panel-bg)] border border-[var(--discord-auth-panel-border)] rounded-lg"
        style={discordPanelStyle}
      >
        <div className="flex items-center gap-3">
          <DiscordIcon className="w-6 h-6" style={discordIconStyle} />
          <div>
            <p className="text-white/60 text-xs font-body">Connected</p>
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
