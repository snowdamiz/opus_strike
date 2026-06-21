import { useEffect } from 'react';
import { Client, type Room } from 'colyseus.js';
import { create } from 'zustand';
import type { MatchMode } from '@voxel-strike/shared';
import { config } from '../config/environment';
import { loggers } from '../utils/logger';

export type SocialTab = 'friends' | 'requests' | 'invites';
export type RelationshipState = 'none' | 'friend' | 'pending_incoming' | 'pending_outgoing';

export interface SocialRank {
  label: string;
  tierLabel: string;
  isRanked: boolean;
}

export interface SocialUser {
  userId: string;
  name: string;
  rank: SocialRank;
  lastLoginAt: string | null;
}

export interface SocialFriend {
  friendshipId: string;
  friendedAt: string;
  user: SocialUser;
}

export interface FriendRequest {
  requestId: string;
  status: string;
  direction: 'incoming' | 'outgoing';
  requestedAt: string;
  respondedAt: string | null;
  user: SocialUser;
}

export interface LobbyInvite {
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

export interface PartyInvite {
  inviteId: string;
  partyId: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  from: SocialUser;
  to: SocialUser;
}

export interface SearchResult {
  user: SocialUser;
  relationship: RelationshipState;
}

export interface SocialState {
  friends: SocialFriend[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  lobbyInvites: LobbyInvite[];
  partyInvites: PartyInvite[];
  discordPlayers: SearchResult[];
}

type SocialRealtimeStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface SocialStateMessage {
  social: SocialState;
  reason?: string;
  updatedAt?: string;
}

interface SocialRealtimeStore {
  social: SocialState;
  status: SocialRealtimeStatus;
  error: string | null;
  hasLoaded: boolean;
  updatedAt: string | null;
  setConnecting: () => void;
  setConnected: () => void;
  setError: (error: string) => void;
  setSocial: (message: SocialStateMessage) => void;
  reset: () => void;
}

export const emptySocialState: SocialState = {
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  lobbyInvites: [],
  partyInvites: [],
  discordPlayers: [],
};

const BASE_RECONNECT_DELAY_MS = 750;
const MAX_RECONNECT_DELAY_MS = 10_000;
const RECONNECT_JITTER_MS = 350;

let client: Client | null = null;
let room: Room | null = null;
let connectPromise: Promise<void> | null = null;
let reconnectTimer: number | null = null;
let retainCount = 0;
let activeUserKey: string | null = null;
let reconnectAttempts = 0;
let intentionallyClosed = false;

export const useSocialRealtimeStore = create<SocialRealtimeStore>((set) => ({
  social: emptySocialState,
  status: 'idle',
  error: null,
  hasLoaded: false,
  updatedAt: null,
  setConnecting: () => set((state) => ({
    status: state.hasLoaded ? state.status : 'connecting',
    error: null,
  })),
  setConnected: () => set({ status: 'connected', error: null }),
  setError: (error) => set({ status: 'error', error }),
  setSocial: (message) => set({
    social: message.social,
    status: 'connected',
    error: null,
    hasLoaded: true,
    updatedAt: message.updatedAt ?? new Date().toISOString(),
  }),
  reset: () => set({
    social: emptySocialState,
    status: 'idle',
    error: null,
    hasLoaded: false,
    updatedAt: null,
  }),
}));

export function actionableSocialCount(social: SocialState): number {
  return social.incomingRequests.length + social.lobbyInvites.length + social.partyInvites.length;
}

export function useSocialRealtime(userKey: string | null | undefined): void {
  useEffect(() => {
    if (!userKey) {
      resetSocialRealtime();
      return;
    }

    return retainSocialRealtime(userKey);
  }, [userKey]);
}

export function requestSocialRealtimeRefresh(): boolean {
  if (!room) return false;
  room.send('refreshSocial');
  return true;
}

function isSocialStateMessage(value: unknown): value is SocialStateMessage {
  return Boolean(
    value
      && typeof value === 'object'
      && 'social' in value
      && typeof (value as SocialStateMessage).social === 'object'
      && (value as SocialStateMessage).social !== null
  );
}

function retainSocialRealtime(userKey: string): () => void {
  if (activeUserKey && activeUserKey !== userKey) {
    closeSocialRoom();
    useSocialRealtimeStore.getState().reset();
  }

  activeUserKey = userKey;
  retainCount += 1;
  intentionallyClosed = false;
  void connectSocialRoom(userKey);

  return () => {
    retainCount = Math.max(0, retainCount - 1);
    if (retainCount === 0) {
      closeSocialRoom();
    }
  };
}

function getClient(): Client {
  if (!client) {
    client = new Client(config.serverUrl);
  }
  return client;
}

function connectSocialRoom(userKey: string): Promise<void> {
  if (room || connectPromise) {
    return connectPromise ?? Promise.resolve();
  }

  clearReconnectTimer();
  useSocialRealtimeStore.getState().setConnecting();

  connectPromise = getClient().create('social_room')
    .then((nextRoom) => {
      if (activeUserKey !== userKey || retainCount === 0 || intentionallyClosed) {
        nextRoom.leave(false);
        return;
      }

      room = nextRoom;
      reconnectAttempts = 0;
      useSocialRealtimeStore.getState().setConnected();

      nextRoom.onMessage('socialState', (payload: unknown) => {
        if (!isSocialStateMessage(payload)) {
          loggers.network.warn('ignored malformed social state payload', payload);
          return;
        }
        useSocialRealtimeStore.getState().setSocial(payload);
      });

      nextRoom.onMessage('error', (payload: unknown) => {
        const message = typeof payload === 'object' && payload && 'message' in payload
          ? String((payload as { message?: unknown }).message || 'Social updates failed')
          : 'Social updates failed';
        useSocialRealtimeStore.getState().setError(message);
      });

      nextRoom.onError((_code, message) => {
        useSocialRealtimeStore.getState().setError(message || 'Social connection failed');
      });

      nextRoom.onLeave(() => {
        if (room !== nextRoom) return;
        room = null;
        if (!intentionallyClosed && retainCount > 0 && activeUserKey === userKey) {
          scheduleReconnect(userKey);
        }
      });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Failed to connect social updates';
      useSocialRealtimeStore.getState().setError(message);
      scheduleReconnect(userKey);
    })
    .finally(() => {
      connectPromise = null;
    });

  return connectPromise;
}

function scheduleReconnect(userKey: string): void {
  if (retainCount === 0 || activeUserKey !== userKey || intentionallyClosed) return;
  if (reconnectTimer !== null) return;

  const exponentDelay = BASE_RECONNECT_DELAY_MS * (2 ** Math.min(reconnectAttempts, 4));
  const delayMs = Math.min(MAX_RECONNECT_DELAY_MS, exponentDelay) + Math.floor(Math.random() * RECONNECT_JITTER_MS);
  reconnectAttempts += 1;

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    void connectSocialRoom(userKey);
  }, delayMs);
}

function closeSocialRoom(): void {
  intentionallyClosed = true;
  clearReconnectTimer();

  const currentRoom = room;
  room = null;
  connectPromise = null;
  if (currentRoom) {
    currentRoom.leave(false);
  }
}

function resetSocialRealtime(): void {
  retainCount = 0;
  activeUserKey = null;
  reconnectAttempts = 0;
  closeSocialRoom();
  useSocialRealtimeStore.getState().reset();
}

function clearReconnectTimer(): void {
  if (reconnectTimer === null) return;
  window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
}
