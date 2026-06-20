import * as SelectPrimitive from '@radix-ui/react-select';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PARTY_MAX_MEMBERS, type BotDifficulty, type GameplayMode, type HeroId, type MatchMode, type PartyMemberSnapshot, type PartyMode } from '@voxel-strike/shared';
import { config } from '../../config/environment';
import { useNetwork } from '../../contexts/NetworkContext';
import { useWallet } from '../../contexts/WalletContext';
import { useGameStore } from '../../store/gameStore';
import { isPartyLeader as isPartyLeaderForUser, usePartyStore } from '../../store/partyStore';
import { useSettingsStore } from '../../store/settingsStore';
import { requiresTutorial } from '../../utils/tutorialAccess';
import { TopNavIconButton } from './TopNavIconButton';

type SocialTab = 'friends' | 'requests' | 'invites';
type RelationshipState = 'none' | 'friend' | 'pending_incoming' | 'pending_outgoing';

interface SocialRank {
  label: string;
  tierLabel: string;
  isRanked: boolean;
}

interface SocialUser {
  userId: string;
  name: string;
  rank: SocialRank;
  lastLoginAt: string | null;
}

interface SocialFriend {
  friendshipId: string;
  friendedAt: string;
  user: SocialUser;
}

interface FriendRequest {
  requestId: string;
  status: string;
  direction: 'incoming' | 'outgoing';
  requestedAt: string;
  respondedAt: string | null;
  user: SocialUser;
}

interface LobbyInvite {
  inviteId: string;
  lobbyId: string;
  lobbyName: string;
  matchMode: MatchMode | null;
  status: string;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  from: SocialUser;
  to: SocialUser;
}

interface PartyInvite {
  inviteId: string;
  partyId: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  from: SocialUser;
  to: SocialUser;
}

interface SocialState {
  friends: SocialFriend[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  lobbyInvites: LobbyInvite[];
  partyInvites: PartyInvite[];
  discordPlayers: SearchResult[];
}

interface SearchResult {
  user: SocialUser;
  relationship: RelationshipState;
}

const emptySocialState: SocialState = {
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  lobbyInvites: [],
  partyInvites: [],
  discordPlayers: [],
};
const SOCIAL_REFRESH_INTERVAL_MS = 10000;
const SOCIAL_CLOSE_ANIMATION_MS = 220;
const PARTY_BOT_OPTIONS: { difficulty: BotDifficulty; label: string }[] = [
  { difficulty: 'easy', label: 'Easy' },
  { difficulty: 'normal', label: 'Normal' },
  { difficulty: 'hard', label: 'Hard' },
];

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function actionableSocialCount(social: SocialState): number {
  return social.incomingRequests.length + social.lobbyInvites.length + social.partyInvites.length;
}

function getHttpUrl(): string {
  return config.serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
}

async function socialApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${getHttpUrl()}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Social request failed' }));
    throw new Error(payload.error || 'Social request failed');
  }

  return response.json();
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <circle cx="9" cy="7" r="4" strokeWidth={1.8} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2 21v-2a4 4 0 014-4h6a4 4 0 014 4v2" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 3.2a4 4 0 010 7.6" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M22 21v-2a4 4 0 00-3-3.85" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
    </svg>
  );
}

function InviteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M21 12l-8-8v5H7a5 5 0 000 10h2" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M15 16h6m-3-3v6" />
    </svg>
  );
}

function RequestIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7h8M8 12h5m-7 8l-3-3V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H9l-3 3z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function statusLabel(relationship: RelationshipState): string {
  switch (relationship) {
    case 'friend':
      return 'FRIEND';
    case 'pending_incoming':
      return 'REQUESTED YOU';
    case 'pending_outgoing':
      return 'PENDING';
    default:
      return 'ADD';
  }
}

function matchModeLabel(mode: MatchMode | null): string {
  switch (mode) {
    case 'ranked':
      return 'RANKED';
    case 'quick_play':
      return 'CAPTURE THE FLAG';
    case 'custom':
      return 'CUSTOM';
    default:
      return 'LOBBY';
  }
}

function UserIdentity({ user, detail }: { user: SocialUser; detail?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-orange-200/15 bg-orange-500/15 text-orange-200 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)]">
        <span className="font-display text-base leading-none">{user.name.slice(0, 1).toUpperCase()}</span>
      </div>
      <div className="min-w-0">
        <p className="truncate font-display text-sm leading-none text-white">{user.name}</p>
        <p className="mt-1 truncate text-xs font-body text-white/40">
          {detail ?? user.rank?.label ?? 'Unranked'}
        </p>
      </div>
    </div>
  );
}

function SocialRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('social-row flex items-center justify-between gap-3 rounded-lg px-3.5 py-3', className)}>
      {children}
    </div>
  );
}

function SectionHeader({
  title,
  meta,
}: {
  title: string;
  meta?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <h3 className="truncate font-display text-base leading-none text-white">{title}</h3>
      {meta && <div className="shrink-0">{meta}</div>}
    </div>
  );
}

function StatusBanner({ message, tone }: { message: string; tone: 'error' | 'success' }) {
  return (
    <div className={cn(
      'rounded-lg border px-3 py-2 text-sm shadow-[inset_0_1px_0_rgb(255_255_255_/_0.06)]',
      tone === 'error'
        ? 'border-red-400/20 bg-red-500/10 text-red-200'
        : 'border-green-300/20 bg-green-500/10 text-green-200',
    )}>
      {message}
    </div>
  );
}

function RelationshipActionButton({
  relationship,
  disabled,
  onClick,
}: {
  relationship: RelationshipState;
  disabled: boolean;
  onClick: () => void;
}) {
  const canSend = relationship === 'none';

  return (
    <button
      type="button"
      disabled={!canSend || disabled}
      onClick={onClick}
      className={cn(
        'flex h-9 shrink-0 items-center justify-center rounded-lg border px-3.5 font-display text-xs transition focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-300/70',
        canSend
          ? 'border-orange-300/20 bg-orange-500/15 text-orange-100 hover:border-orange-200/40 hover:bg-orange-500/25'
          : 'cursor-not-allowed border-white/10 bg-white/5 text-white/25',
      )}
    >
      {statusLabel(relationship)}
    </button>
  );
}

function PlayerResultCard({
  result,
  detail,
  pendingAction,
  onRequest,
}: {
  result: SearchResult;
  detail?: string;
  pendingAction: string | null;
  onRequest: (targetUserId: string) => void;
}) {
  return (
    <SocialRow>
      <UserIdentity user={result.user} detail={detail} />
      <RelationshipActionButton
        relationship={result.relationship}
        disabled={Boolean(pendingAction)}
        onClick={() => onRequest(result.user.userId)}
      />
    </SocialRow>
  );
}

function BotDifficultySelect({
  value,
  disabled,
  onChange,
}: {
  value: BotDifficulty;
  disabled: boolean;
  onChange: (difficulty: BotDifficulty) => void;
}) {
  return (
    <div className="social-bot-select-field">
      <span className="social-bot-select-label">Difficulty</span>
      <SelectPrimitive.Root
        value={value}
        disabled={disabled}
        onValueChange={(nextValue) => onChange(nextValue as BotDifficulty)}
      >
        <SelectPrimitive.Trigger className="social-bot-select-trigger" aria-label="Bot difficulty">
          <SelectPrimitive.Value />
          <SelectPrimitive.Icon asChild>
            <span className="social-bot-select-icon" aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            align="start"
            className="social-bot-select-content"
            position="popper"
            sideOffset={6}
          >
            <SelectPrimitive.Viewport className="social-bot-select-viewport">
              {PARTY_BOT_OPTIONS.map((option) => (
                <SelectPrimitive.Item
                  key={option.difficulty}
                  className="social-bot-select-item"
                  value={option.difficulty}
                >
                  <SelectPrimitive.ItemIndicator className="social-bot-select-item-indicator">
                    <CheckIcon className="h-3.5 w-3.5" />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText>{option.label.toUpperCase()}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}

function IconButton({
  label,
  title,
  disabled,
  tone = 'neutral',
  onClick,
  children,
}: {
  label: string;
  title: string;
  disabled?: boolean;
  tone?: 'neutral' | 'primary' | 'danger' | 'success';
  onClick: () => void;
  children: ReactNode;
}) {
  const toneClass = {
    neutral: 'border-white/10 bg-white/[0.07] text-white/55 hover:border-white/25 hover:bg-white/10 hover:text-white',
    primary: 'border-orange-300/25 bg-orange-500/20 text-orange-100 hover:border-orange-200/50 hover:bg-orange-500/30',
    danger: 'border-red-300/20 bg-red-500/10 text-red-200 hover:border-red-300/45 hover:bg-red-500/20',
    success: 'border-green-300/20 bg-green-500/10 text-green-200 hover:border-green-300/45 hover:bg-green-500/20',
  }[tone];

  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40 ${toneClass}`}
    >
      {children}
    </button>
  );
}

function FriendCard({
  friend,
  canInvite,
  pendingAction,
  onInvite,
  onRemove,
}: {
  friend: SocialFriend;
  canInvite: boolean;
  pendingAction: string | null;
  onInvite: (friend: SocialFriend) => void;
  onRemove: (friendUserId: string) => void;
}) {
  return (
    <SocialRow>
      <UserIdentity user={friend.user} />
      <div className="flex shrink-0 items-center gap-2">
        <IconButton
          label={`Invite ${friend.user.name}`}
          title={canInvite ? `Invite ${friend.user.name}` : 'Open Play or join a lobby to invite'}
          tone="primary"
          disabled={!canInvite || Boolean(pendingAction)}
          onClick={() => onInvite(friend)}
        >
          <InviteIcon className="h-4 w-4" />
        </IconButton>
        <IconButton
          label={`Remove ${friend.user.name}`}
          title={`Remove ${friend.user.name}`}
          tone="danger"
          disabled={Boolean(pendingAction)}
          onClick={() => onRemove(friend.user.userId)}
        >
          <XIcon className="h-4 w-4" />
        </IconButton>
      </div>
    </SocialRow>
  );
}

function PartyBotCard({
  bot,
  canManage,
  pendingAction,
  onRemove,
}: {
  bot: PartyMemberSnapshot;
  canManage: boolean;
  pendingAction: string | null;
  onRemove: (bot: PartyMemberSnapshot) => void;
}) {
  return (
    <SocialRow>
      <div className="min-w-0">
        <p className="truncate font-display text-sm leading-none text-white">{bot.displayName}</p>
        <p className="mt-1 truncate text-xs font-body text-white/40">
          {(bot.botDifficulty ?? 'normal').toUpperCase()} BOT
        </p>
      </div>
      <IconButton
        label={`Remove ${bot.displayName}`}
        title={canManage ? `Remove ${bot.displayName}` : 'Only the party leader can remove bots'}
        tone="danger"
        disabled={!canManage || Boolean(pendingAction)}
        onClick={() => onRemove(bot)}
      >
        <XIcon className="h-4 w-4" />
      </IconButton>
    </SocialRow>
  );
}

export function SocialButton({
  onClick,
  badgeCount = 0,
}: {
  onClick: () => void;
  badgeCount?: number;
}) {
  return (
    <TopNavIconButton
      label="Open social"
      title="Social"
      badgeCount={badgeCount}
      onClick={onClick}
    >
      <UsersIcon className="h-7 w-7" />
    </TopNavIconButton>
  );
}

export function useSocialBadgeCount(): number {
  const { isAuthenticated } = useWallet();
  const [badgeCount, setBadgeCount] = useState(0);

  const refreshBadgeCount = useCallback(async () => {
    if (!isAuthenticated) {
      setBadgeCount(0);
      return;
    }

    try {
      const data = await socialApi<SocialState>('/social');
      setBadgeCount(actionableSocialCount(data));
    } catch {
      setBadgeCount(0);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refreshBadgeCount();
  }, [refreshBadgeCount]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const interval = window.setInterval(refreshBadgeCount, SOCIAL_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isAuthenticated, refreshBadgeCount]);

  return badgeCount;
}

export function SocialBox({
  onClose,
  selectedHero = 'blaze',
  initialPartyMode,
  initialGameplayMode,
}: {
  onClose: () => void;
  selectedHero?: HeroId;
  initialPartyMode?: PartyMode;
  initialGameplayMode?: GameplayMode;
}) {
  const { isAuthenticated, user } = useWallet();
  const { addPartyBot, ensureParty, joinLobby, joinParty, kickPartyMember, startTutorialGame } = useNetwork();
  const playerName = useGameStore((state) => state.playerName);
  const appPhase = useGameStore((state) => state.appPhase);
  const currentLobbyId = useGameStore((state) => state.currentLobbyId);
  const currentLobbyName = useGameStore((state) => state.currentLobbyName);
  const currentLobbyMatchMode = useGameStore((state) => state.matchmakingStatus.matchMode ?? null);
  const devTutorialOverride = useSettingsStore((state) => state.settings.devTutorialOverride);
  const party = usePartyStore((state) => state.party);
  const localPartyUserId = usePartyStore((state) => state.localUserId);

  const [activeTab, setActiveTab] = useState<SocialTab>('friends');
  const [social, setSocial] = useState<SocialState>(emptySocialState);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [selectedBotDifficulty, setSelectedBotDifficulty] = useState<BotDifficulty>('normal');
  const closeTimeoutRef = useRef<number | null>(null);

  const canInviteFromLobby = isAuthenticated && appPhase === 'in_lobby' && Boolean(currentLobbyId);
  const canInviteFromMenu = isAuthenticated && appPhase === 'menu';
  const canInviteFriend = canInviteFromLobby || canInviteFromMenu;
  const isPartyLeader = !party || isPartyLeaderForUser(party, localPartyUserId);
  const partyBotMembers = party?.members.filter((member) => member.isBot) ?? [];
  const assumedPartyMemberCount = party ? party.members.length : canInviteFromMenu ? 1 : 0;
  const partySlotsRemaining = Math.max(0, PARTY_MAX_MEMBERS - assumedPartyMemberCount);
  const canManagePartyBots = canInviteFromMenu && isPartyLeader;
  const canAddPartyBot = canManagePartyBots && partySlotsRemaining > 0;
  const tutorialRequired = requiresTutorial(user?.tutorialCompletedAt, devTutorialOverride);
  const requestCount = social.incomingRequests.length + social.outgoingRequests.length;
  const inviteCount = social.lobbyInvites.length + social.partyInvites.length;
  const tabCounts = useMemo(() => ({
    friends: social.friends.length + social.discordPlayers.filter((candidate) => candidate.relationship === 'none').length,
    requests: requestCount,
    invites: inviteCount,
  }), [inviteCount, requestCount, social.discordPlayers, social.friends.length]);
  const tabs: { id: SocialTab; label: string; icon: ReactNode; count: number }[] = [
    { id: 'friends', label: 'Friends', icon: <UsersIcon className="h-4 w-4" />, count: tabCounts.friends },
    { id: 'requests', label: 'Requests', icon: <RequestIcon className="h-4 w-4" />, count: tabCounts.requests },
    { id: 'invites', label: 'Invites', icon: <InviteIcon className="h-4 w-4" />, count: tabCounts.invites },
  ];
  const sidebarState = isClosing ? 'closing' : 'open';

  const closePanel = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    closeTimeoutRef.current = window.setTimeout(onClose, SOCIAL_CLOSE_ANIMATION_MS);
  }, [isClosing, onClose]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePanel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closePanel]);

  const refreshSocial = useCallback(async (silent = false) => {
    if (!isAuthenticated) return;
    if (!silent) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const data = await socialApi<SocialState>('/social');
      setSocial(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load social');
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refreshSocial();
  }, [refreshSocial]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = window.setInterval(() => {
      refreshSocial(true);
    }, SOCIAL_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [isAuthenticated, refreshSocial]);

  useEffect(() => {
    if (!isAuthenticated) {
      setSearchResults([]);
      return;
    }

    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await socialApi<{ users: SearchResult[] }>(
          `/social/search?query=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );
        setSearchResults(data.users);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Search failed');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isAuthenticated, searchQuery]);

  const runAction = async (key: string, action: () => Promise<void>) => {
    if (pendingAction) return;
    setPendingAction(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Social action failed');
    } finally {
      setPendingAction(null);
    }
  };

  const sendFriendRequest = (target: { targetUserId?: string; targetName?: string }) => {
    runAction(`request:${target.targetUserId ?? target.targetName}`, async () => {
      await socialApi('/social/friend-requests', {
        method: 'POST',
        body: JSON.stringify(target),
      });
      setNotice('Friend request sent.');
      setSearchQuery('');
      setSearchResults([]);
      await refreshSocial();
    });
  };

  const acceptFriendRequest = (requestId: string) => {
    runAction(`accept-request:${requestId}`, async () => {
      await socialApi(`/social/friend-requests/${encodeURIComponent(requestId)}/accept`, { method: 'POST' });
      setNotice('Friend added.');
      await refreshSocial();
    });
  };

  const declineFriendRequest = (requestId: string) => {
    runAction(`decline-request:${requestId}`, async () => {
      await socialApi(`/social/friend-requests/${encodeURIComponent(requestId)}/decline`, { method: 'POST' });
      await refreshSocial();
    });
  };

  const cancelFriendRequest = (requestId: string) => {
    runAction(`cancel-request:${requestId}`, async () => {
      await socialApi(`/social/friend-requests/${encodeURIComponent(requestId)}/cancel`, { method: 'POST' });
      await refreshSocial();
    });
  };

  const removeFriend = (friendUserId: string) => {
    runAction(`remove-friend:${friendUserId}`, async () => {
      await socialApi(`/social/friends/${encodeURIComponent(friendUserId)}`, { method: 'DELETE' });
      await refreshSocial();
    });
  };

  const inviteFriend = (friend: SocialFriend) => {
    runAction(`invite:${friend.user.userId}`, async () => {
      if (canInviteFromLobby && currentLobbyId) {
        await socialApi('/social/lobby-invites', {
          method: 'POST',
          body: JSON.stringify({
            toUserId: friend.user.userId,
            lobbyId: currentLobbyId,
            lobbyName: currentLobbyName ?? 'Game Lobby',
            matchMode: currentLobbyMatchMode ?? 'custom',
          }),
        });
        setNotice(`Lobby invite sent to ${friend.user.name}.`);
        await refreshSocial();
        return;
      }

      if (!canInviteFromMenu) {
        throw new Error('Open Play or join a lobby before inviting friends');
      }

      const partyId = await ensureParty(playerName || user?.name || 'Player', selectedHero, {
        selectedMode: initialPartyMode,
        gameplayMode: initialGameplayMode,
      });
      await socialApi('/social/party-invites', {
        method: 'POST',
        body: JSON.stringify({
          toUserId: friend.user.userId,
          partyId,
        }),
      });
      setNotice(`Party invite sent to ${friend.user.name}.`);
      await refreshSocial();
    });
  };

  const invitePartyBot = (difficulty: BotDifficulty) => {
    const option = PARTY_BOT_OPTIONS.find((candidate) => candidate.difficulty === difficulty);
    const label = option?.label ?? 'Normal';
    runAction(`invite-party-bot:${difficulty}`, async () => {
      if (!canInviteFromMenu) {
        throw new Error('Open Play before inviting party bots');
      }
      if (!isPartyLeader) {
        throw new Error('Only the party leader can invite bots');
      }
      if (partySlotsRemaining <= 0) {
        throw new Error('Party is full');
      }

      await ensureParty(playerName || user?.name || 'Player', selectedHero, {
        selectedMode: initialPartyMode,
        gameplayMode: initialGameplayMode,
      });
      addPartyBot({
        difficulty,
        displayName: `${label} Bot`,
        heroId: selectedHero,
      });
      setNotice(`${label} bot invited.`);
    });
  };

  const removePartyBotMember = (bot: PartyMemberSnapshot) => {
    runAction(`remove-party-bot:${bot.userId}`, async () => {
      if (!isPartyLeader) {
        throw new Error('Only the party leader can remove bots');
      }
      kickPartyMember(bot.userId);
      setNotice(`${bot.displayName} removed.`);
    });
  };

  const acceptLobbyInvite = (invite: LobbyInvite) => {
    runAction(`accept-invite:${invite.inviteId}`, async () => {
      if (tutorialRequired) {
        startTutorialGame(playerName || user?.name || 'Player');
        closePanel();
        return;
      }

      const data = await socialApi<{ invite: LobbyInvite }>(
        `/social/lobby-invites/${encodeURIComponent(invite.inviteId)}/accept`,
        { method: 'POST' }
      );
      await joinLobby(playerName || user?.name || 'Player', data.invite.lobbyId);
      closePanel();
    });
  };

  const declineLobbyInvite = (inviteId: string) => {
    runAction(`decline-invite:${inviteId}`, async () => {
      await socialApi(`/social/lobby-invites/${encodeURIComponent(inviteId)}/decline`, { method: 'POST' });
      await refreshSocial();
    });
  };

  const acceptPartyInvite = (invite: PartyInvite) => {
    runAction(`accept-party-invite:${invite.inviteId}`, async () => {
      const data = await socialApi<{ invite: PartyInvite }>(
        `/social/party-invites/${encodeURIComponent(invite.inviteId)}/accept`,
        { method: 'POST' }
      );
      await joinParty(playerName || user?.name || 'Player', data.invite.partyId, selectedHero);
      closePanel();
    });
  };

  const declinePartyInvite = (inviteId: string) => {
    runAction(`decline-party-invite:${inviteId}`, async () => {
      await socialApi(`/social/party-invites/${encodeURIComponent(inviteId)}/decline`, { method: 'POST' });
      await refreshSocial();
    });
  };

  if (!isAuthenticated) return null;

  return (
    <div className="social-sidebar-layer fixed inset-0 z-modal pointer-events-none" data-state={sidebarState}>
      <button
        type="button"
        className="social-sidebar-scrim pointer-events-auto"
        aria-label="Close social sidebar"
        onClick={closePanel}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="social-sidebar-title"
        className="social-sidebar-panel pointer-events-auto fixed flex flex-col overflow-hidden text-white"
        data-state={sidebarState}
      >
        <header className="relative border-b border-white/[0.06] px-5 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center text-orange-400">
                <UsersIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 id="social-sidebar-title" className="truncate font-display text-2xl leading-none text-white">
                  SOCIAL
                </h2>
              </div>
            </div>

            <button
              type="button"
              onClick={closePanel}
              className="flex h-8 w-8 shrink-0 items-center justify-center text-white/45 transition hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-300/70"
              aria-label="Close social sidebar"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </header>

        <nav className="social-sidebar-tabs grid grid-cols-3 border-b border-white/[0.06] px-4" role="tablist" aria-label="Social sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'social-sidebar-tab flex min-w-0 items-center justify-center gap-2 px-2.5 font-display text-xs transition focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-400/70',
                activeTab === tab.id
                  ? 'text-orange-100'
                  : 'text-white/[0.42] hover:text-white/[0.75]',
              )}
            >
              {tab.icon}
              <span className="min-w-0 truncate">{tab.label.toUpperCase()}</span>
              {tab.count > 0 && (
                <span className={cn(
                  'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] leading-none',
                  activeTab === tab.id ? 'bg-orange-300/[0.16] text-orange-50' : 'bg-white/[0.08] text-white/50',
                )}>
                  {Math.min(99, tab.count)}
                </span>
              )}
            </button>
          ))}
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 custom-scrollbar" role="tabpanel">
          <div className="space-y-4">
            {error && <StatusBanner message={error} tone="error" />}
            {!error && notice && <StatusBanner message={notice} tone="success" />}

            {isLoading ? (
              <div className="flex h-52 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-orange-300" />
              </div>
            ) : (
              <>
                {activeTab === 'friends' && (
                  <div className="space-y-5">
                    <section className="space-y-3">
                      <SectionHeader title="Find Player" />
                      <form
                        className="social-row flex items-center gap-2 rounded-lg p-2.5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const targetName = searchQuery.trim();
                          if (targetName.length >= 2) {
                            sendFriendRequest({ targetName });
                          }
                        }}
                      >
                        <input
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          placeholder="Callsign"
                          maxLength={24}
                          className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3.5 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-orange-500/80 hover:border-white/20 hover:bg-white/[0.08]"
                        />
                        <IconButton
                          label="Send friend request"
                          title="Send friend request"
                          tone="primary"
                          disabled={searchQuery.trim().length < 2 || Boolean(pendingAction)}
                          onClick={() => sendFriendRequest({ targetName: searchQuery.trim() })}
                        >
                          <PlusIcon className="h-4 w-4" />
                        </IconButton>
                      </form>

                      {(isSearching || searchResults.length > 0) && (
                        <div className="space-y-2">
                          {isSearching && (
                            <p className="py-4 text-center text-xs font-body text-white/35">SEARCHING...</p>
                          )}
                          {!isSearching && searchResults.map((result) => (
                            <PlayerResultCard
                              key={result.user.userId}
                              result={result}
                              pendingAction={pendingAction}
                              onRequest={(targetUserId) => sendFriendRequest({ targetUserId })}
                            />
                          ))}
                        </div>
                      )}
                    </section>

                    {social.discordPlayers.length > 0 && (
                      <section className="space-y-2 border-t border-white/[0.06] pt-4">
                        <SectionHeader title="Discord Players" />
                        {social.discordPlayers.map((result) => (
                          <PlayerResultCard
                            key={result.user.userId}
                            result={result}
                            detail="Discord"
                            pendingAction={pendingAction}
                            onRequest={(targetUserId) => sendFriendRequest({ targetUserId })}
                          />
                        ))}
                      </section>
                    )}

                    <section className="space-y-2 border-t border-white/[0.06] pt-4">
                      <SectionHeader
                        title="Friends"
                        meta={<span className="font-display text-xs text-white/35">{social.friends.length}</span>}
                      />
                      {social.friends.length > 0 ? (
                        social.friends.map((friend) => (
                          <FriendCard
                            key={friend.friendshipId}
                            friend={friend}
                            canInvite={canInviteFriend}
                            pendingAction={pendingAction}
                            onInvite={inviteFriend}
                            onRemove={removeFriend}
                          />
                        ))
                      ) : (
                        <EmptyState title="NO FRIENDS YET" />
                      )}
                    </section>

                    {canInviteFromMenu && (
                      <section className="social-party-section space-y-3">
                        <SectionHeader
                          title="Party Bots"
                          meta={(
                            <span className="rounded-full border border-cyan-200/15 bg-cyan-400/10 px-2 py-1 text-[10px] font-display text-cyan-100/75">
                              {assumedPartyMemberCount}/{PARTY_MAX_MEMBERS}
                            </span>
                          )}
                        />
                        <p className="text-xs font-body text-white/40">
                          Add an AI teammate to open party slots.
                        </p>
                        <div className="flex items-end gap-2">
                          <BotDifficultySelect
                            value={selectedBotDifficulty}
                            disabled={!canAddPartyBot || Boolean(pendingAction)}
                            onChange={setSelectedBotDifficulty}
                          />
                          <button
                            type="button"
                            disabled={!canAddPartyBot || Boolean(pendingAction)}
                            onClick={() => invitePartyBot(selectedBotDifficulty)}
                            className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-orange-300/25 bg-orange-500/[0.12] px-3.5 font-display text-xs text-orange-100 transition hover:border-orange-200/45 hover:bg-orange-500/[0.2] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/25"
                          >
                            <PlusIcon className="h-4 w-4" />
                            ADD BOT
                          </button>
                        </div>
                        <p className="text-xs font-body text-white/35">
                          {partySlotsRemaining > 0 ? `${partySlotsRemaining} slots open` : 'Party full'}
                        </p>
                        {partyBotMembers.length > 0 && (
                          <div className="space-y-2 border-t border-white/[0.06] pt-3">
                            {partyBotMembers.map((bot) => (
                              <PartyBotCard
                                key={bot.userId}
                                bot={bot}
                                canManage={canManagePartyBots}
                                pendingAction={pendingAction}
                                onRemove={removePartyBotMember}
                              />
                            ))}
                          </div>
                        )}
                      </section>
                    )}
                  </div>
                )}

                {activeTab === 'requests' && (
                  <div className="space-y-4">
                    <RequestGroup
                      title="INCOMING"
                      requests={social.incomingRequests}
                      emptyTitle="NO INCOMING REQUESTS"
                      pendingAction={pendingAction}
                      onAccept={acceptFriendRequest}
                      onDecline={declineFriendRequest}
                    />
                    <RequestGroup
                      title="OUTGOING"
                      requests={social.outgoingRequests}
                      emptyTitle="NO OUTGOING REQUESTS"
                      pendingAction={pendingAction}
                      onCancel={cancelFriendRequest}
                    />
                  </div>
                )}

                {activeTab === 'invites' && (
                  <div className="space-y-2">
                    {social.partyInvites.length === 0 && social.lobbyInvites.length === 0 ? (
                      <EmptyState title="NO INVITES" />
                    ) : (
                      <>
                        {social.partyInvites.map((invite) => (
                          <SocialRow key={invite.inviteId} className="items-start">
                            <UserIdentity user={invite.from} detail="PARTY - Main Play" />
                            <div className="flex shrink-0 items-center gap-2">
                              <IconButton
                                label="Join party"
                                title="Join party"
                                tone="success"
                                disabled={Boolean(pendingAction)}
                                onClick={() => acceptPartyInvite(invite)}
                              >
                                <CheckIcon className="h-4 w-4" />
                              </IconButton>
                              <IconButton
                                label="Decline invite"
                                title="Decline invite"
                                tone="danger"
                                disabled={Boolean(pendingAction)}
                                onClick={() => declinePartyInvite(invite.inviteId)}
                              >
                                <XIcon className="h-4 w-4" />
                              </IconButton>
                            </div>
                          </SocialRow>
                        ))}
                        {social.lobbyInvites.map((invite) => (
                          <SocialRow key={invite.inviteId} className="items-start">
                            <UserIdentity
                              user={invite.from}
                              detail={`${matchModeLabel(invite.matchMode)} - ${invite.lobbyName}`}
                            />
                            <div className="flex shrink-0 items-center gap-2">
                              <IconButton
                                label="Join lobby"
                                title="Join lobby"
                                tone="success"
                                disabled={Boolean(pendingAction)}
                                onClick={() => acceptLobbyInvite(invite)}
                              >
                                <CheckIcon className="h-4 w-4" />
                              </IconButton>
                              <IconButton
                                label="Decline invite"
                                title="Decline invite"
                                tone="danger"
                                disabled={Boolean(pendingAction)}
                                onClick={() => declineLobbyInvite(invite.inviteId)}
                              >
                                <XIcon className="h-4 w-4" />
                              </IconButton>
                            </div>
                          </SocialRow>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </aside>
    </div>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-white/[0.055] bg-white/[0.008]">
      <p className="font-display text-lg text-white/25">{title}</p>
    </div>
  );
}

function RequestGroup({
  title,
  requests,
  emptyTitle,
  pendingAction,
  onAccept,
  onDecline,
  onCancel,
}: {
  title: string;
  requests: FriendRequest[];
  emptyTitle: string;
  pendingAction: string | null;
  onAccept?: (requestId: string) => void;
  onDecline?: (requestId: string) => void;
  onCancel?: (requestId: string) => void;
}) {
  return (
    <section className="space-y-3">
      <SectionHeader title={title} />
      <div className="space-y-2">
        {requests.length === 0 ? (
          <EmptyState title={emptyTitle} />
        ) : requests.map((request) => (
          <SocialRow key={request.requestId}>
            <UserIdentity user={request.user} />
            <div className="flex shrink-0 items-center gap-2">
              {onAccept && (
                <IconButton
                  label={`Accept ${request.user.name}`}
                  title={`Accept ${request.user.name}`}
                  tone="success"
                  disabled={Boolean(pendingAction)}
                  onClick={() => onAccept(request.requestId)}
                >
                  <CheckIcon className="h-4 w-4" />
                </IconButton>
              )}
              {onDecline && (
                <IconButton
                  label={`Decline ${request.user.name}`}
                  title={`Decline ${request.user.name}`}
                  tone="danger"
                  disabled={Boolean(pendingAction)}
                  onClick={() => onDecline(request.requestId)}
                >
                  <XIcon className="h-4 w-4" />
                </IconButton>
              )}
              {onCancel && (
                <IconButton
                  label={`Cancel ${request.user.name}`}
                  title={`Cancel ${request.user.name}`}
                  tone="neutral"
                  disabled={Boolean(pendingAction)}
                  onClick={() => onCancel(request.requestId)}
                >
                  <XIcon className="h-4 w-4" />
                </IconButton>
              )}
            </div>
          </SocialRow>
        ))}
      </div>
    </section>
  );
}
