import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { type MatchMode } from '@voxel-strike/shared';
import { config } from '../../config/environment';
import { useNetwork } from '../../contexts/NetworkContext';
import { useWallet } from '../../contexts/WalletContext';
import { useGameStore } from '../../store/gameStore';
import { GameDialog } from './GameDialog';

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

interface SocialState {
  friends: SocialFriend[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  lobbyInvites: LobbyInvite[];
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
};

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
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 11a4 4 0 10-8 0 4 4 0 008 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 20a8 8 0 0116 0" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M18.5 8.5a3 3 0 110 6" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 20a5.5 5.5 0 00-3.5-5.1" />
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
      return 'QUICK PLAY';
    case 'custom_wager':
      return 'SOL POT';
    case 'custom':
      return 'CUSTOM';
    default:
      return 'LOBBY';
  }
}

function UserIdentity({ user, detail }: { user: SocialUser; detail?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.055]">
        <span className="font-display text-lg leading-none text-white">{user.name.slice(0, 1).toUpperCase()}</span>
      </div>
      <div className="min-w-0">
        <p className="truncate font-display text-base leading-none text-white">{user.name}</p>
        <p className="mt-1 truncate text-[11px] font-body text-white/40">
          {detail ?? user.rank?.label ?? 'Unranked'}
        </p>
      </div>
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
    neutral: 'border-white/10 bg-white/[0.055] text-white/55 hover:border-white/25 hover:bg-white/10 hover:text-white',
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

export function SocialButton({
  onClick,
  badgeCount = 0,
}: {
  onClick: () => void;
  badgeCount?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] text-white/60 transition hover:border-orange-300/35 hover:bg-orange-500/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      aria-label="Open social"
      title="Social"
    >
      <span className="absolute inset-0 rounded-lg opacity-0 transition group-hover:opacity-100 bg-[radial-gradient(circle_at_50%_0%,rgba(249,115,22,0.22),transparent_64%)]" />
      <UsersIcon className="relative h-5 w-5" />
      {badgeCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold leading-none text-white">
          {Math.min(9, badgeCount)}
        </span>
      )}
    </button>
  );
}

export function SocialBox({
  onClose,
  onRequireAuth,
}: {
  onClose: () => void;
  onRequireAuth?: () => void;
}) {
  const { isAuthenticated, user } = useWallet();
  const { joinLobby } = useNetwork();
  const playerName = useGameStore((state) => state.playerName);
  const appPhase = useGameStore((state) => state.appPhase);
  const currentLobbyId = useGameStore((state) => state.currentLobbyId);
  const currentLobbyName = useGameStore((state) => state.currentLobbyName);
  const currentLobbyMatchMode = useGameStore((state) => state.currentLobbyWager.matchMode ?? null);

  const [activeTab, setActiveTab] = useState<SocialTab>('friends');
  const [social, setSocial] = useState<SocialState>(emptySocialState);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canInviteFromLobby = isAuthenticated && appPhase === 'in_lobby' && Boolean(currentLobbyId);
  const requestCount = social.incomingRequests.length + social.outgoingRequests.length;
  const inviteCount = social.lobbyInvites.length;
  const tabCounts = useMemo(() => ({
    friends: social.friends.length,
    requests: requestCount,
    invites: inviteCount,
  }), [inviteCount, requestCount, social.friends.length]);

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
    }, 10000);

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
      if (!currentLobbyId) {
        throw new Error('Create or join a lobby before inviting friends');
      }

      await socialApi('/social/lobby-invites', {
        method: 'POST',
        body: JSON.stringify({
          toUserId: friend.user.userId,
          lobbyId: currentLobbyId,
          lobbyName: currentLobbyName ?? 'Game Lobby',
          matchMode: currentLobbyMatchMode ?? 'custom',
        }),
      });
      setNotice(`Invite sent to ${friend.user.name}.`);
      await refreshSocial();
    });
  };

  const acceptLobbyInvite = (invite: LobbyInvite) => {
    runAction(`accept-invite:${invite.inviteId}`, async () => {
      const data = await socialApi<{ invite: LobbyInvite }>(
        `/social/lobby-invites/${encodeURIComponent(invite.inviteId)}/accept`,
        { method: 'POST' }
      );
      await joinLobby(playerName || user?.name || 'Player', data.invite.lobbyId);
      onClose();
    });
  };

  const declineLobbyInvite = (inviteId: string) => {
    runAction(`decline-invite:${inviteId}`, async () => {
      await socialApi(`/social/lobby-invites/${encodeURIComponent(inviteId)}/decline`, { method: 'POST' });
      await refreshSocial();
    });
  };

  return (
    <GameDialog
      title="SOCIAL"
      icon={<UsersIcon className="h-5 w-5" />}
      iconClassName="bg-orange-500/15 text-orange-200 border border-orange-300/15"
      size="lg"
      onClose={onClose}
      bodyClassName="p-0 overflow-hidden"
      panelClassName="max-w-[min(94vw,48rem)]"
    >
      {!isAuthenticated ? (
        <div className="p-6">
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-orange-500/15 text-orange-200">
              <UsersIcon className="h-6 w-6" />
            </div>
            <p className="font-display text-xl text-white">SIGN IN REQUIRED</p>
            <button
              type="button"
              onClick={() => {
                onClose();
                onRequireAuth?.();
              }}
              className="mt-4 rounded-lg bg-orange-500 px-5 py-2.5 font-display text-sm text-white hover:bg-orange-400"
            >
              SIGN IN
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[min(66vh,34rem)] flex-col">
          <div className="border-b border-white/5 bg-strike-elevated/35 px-4 py-3">
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-black/20 p-1">
              {(['friends', 'requests', 'invites'] as SocialTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`relative rounded-md px-3 py-2 font-display text-sm transition ${
                    activeTab === tab
                      ? 'bg-orange-500 text-white shadow-[0_0_24px_rgba(249,115,22,0.22)]'
                      : 'text-white/45 hover:bg-white/[0.055] hover:text-white/75'
                  }`}
                >
                  {tab.toUpperCase()}
                  {tabCounts[tab] > 0 && (
                    <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${
                      activeTab === tab ? 'bg-white/20 text-white' : 'bg-white/10 text-white/55'
                    }`}>
                      {tabCounts[tab]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[17rem_1fr]">
            <aside className="border-b border-white/5 bg-white/[0.018] p-4 md:border-b-0 md:border-r">
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const targetName = searchQuery.trim();
                  if (targetName.length >= 2) {
                    sendFriendRequest({ targetName });
                  }
                }}
              >
                <label className="block text-[10px] font-body uppercase tracking-widest text-white/40">
                  Find Player
                </label>
                <div className="flex gap-2">
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Callsign"
                    maxLength={24}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-orange-300/45"
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
                </div>
              </form>

              <div className="mt-4 max-h-56 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                {isSearching && (
                  <p className="py-4 text-center text-xs font-body text-white/35">SEARCHING...</p>
                )}
                {!isSearching && searchResults.map((result) => {
                  const canSend = result.relationship === 'none';
                  return (
                    <div key={result.user.userId} className="rounded-lg border border-white/5 bg-white/[0.03] p-2">
                      <UserIdentity user={result.user} />
                      <button
                        type="button"
                        disabled={!canSend || Boolean(pendingAction)}
                        onClick={() => sendFriendRequest({ targetUserId: result.user.userId })}
                        className={`mt-2 w-full rounded-md border px-3 py-1.5 font-display text-xs transition ${
                          canSend
                            ? 'border-orange-300/25 bg-orange-500/15 text-orange-100 hover:bg-orange-500/25'
                            : 'cursor-not-allowed border-white/5 bg-white/[0.03] text-white/35'
                        }`}
                      >
                        {statusLabel(result.relationship)}
                      </button>
                    </div>
                  );
                })}
              </div>

              {canInviteFromLobby ? (
                <div className="mt-4 rounded-lg border border-cyan-300/15 bg-cyan-500/[0.055] px-3 py-2">
                  <p className="truncate font-display text-sm text-cyan-100">{currentLobbyName ?? 'Game Lobby'}</p>
                  <p className="mt-1 text-[11px] font-body text-cyan-100/45">INVITES ENABLED</p>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-white/5 bg-white/[0.025] px-3 py-2">
                  <p className="font-display text-sm text-white/45">NO ACTIVE LOBBY</p>
                </div>
              )}
            </aside>

            <main className="min-h-0 overflow-y-auto p-4 custom-scrollbar">
              {(error || notice) && (
                <div className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
                  error
                    ? 'border-red-400/20 bg-red-500/10 text-red-200'
                    : 'border-green-300/20 bg-green-500/10 text-green-200'
                }`}>
                  {error || notice}
                </div>
              )}

              {isLoading ? (
                <div className="flex h-52 items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-orange-300" />
                </div>
              ) : (
                <>
                  {activeTab === 'friends' && (
                    <div className="space-y-2">
                      {social.friends.length === 0 ? (
                        <EmptyState title="NO FRIENDS YET" />
                      ) : social.friends.map((friend) => (
                        <div key={friend.friendshipId} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3">
                          <UserIdentity user={friend.user} />
                          <div className="flex shrink-0 items-center gap-2">
                            <IconButton
                              label={`Invite ${friend.user.name}`}
                              title={canInviteFromLobby ? `Invite ${friend.user.name}` : 'Create or join a lobby to invite'}
                              tone="primary"
                              disabled={!canInviteFromLobby || Boolean(pendingAction)}
                              onClick={() => inviteFriend(friend)}
                            >
                              <InviteIcon className="h-4 w-4" />
                            </IconButton>
                            <IconButton
                              label={`Remove ${friend.user.name}`}
                              title={`Remove ${friend.user.name}`}
                              tone="danger"
                              disabled={Boolean(pendingAction)}
                              onClick={() => removeFriend(friend.user.userId)}
                            >
                              <XIcon className="h-4 w-4" />
                            </IconButton>
                          </div>
                        </div>
                      ))}
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
                      {social.lobbyInvites.length === 0 ? (
                        <EmptyState title="NO LOBBY INVITES" />
                      ) : social.lobbyInvites.map((invite) => (
                        <div key={invite.inviteId} className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                          <div className="flex items-start justify-between gap-3">
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
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </main>
          </div>
        </div>
      )}
    </GameDialog>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-white/10 bg-white/[0.018]">
      <p className="font-display text-lg text-white/35">{title}</p>
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
    <section>
      <h3 className="mb-2 font-display text-sm text-white/45">{title}</h3>
      <div className="space-y-2">
        {requests.length === 0 ? (
          <EmptyState title={emptyTitle} />
        ) : requests.map((request) => (
          <div key={request.requestId} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3">
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
          </div>
        ))}
      </div>
    </section>
  );
}
