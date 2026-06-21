import { create } from 'zustand';
import {
  hasDuplicatePartyHeroes,
  requiresUniquePartyHeroes,
  type PartyMemberSnapshot,
  type PartyStateSnapshot,
} from '@voxel-strike/shared';

interface PartyStoreState {
  party: PartyStateSnapshot | null;
  localUserId: string | null;
  launchError: string | null;
  setPartyState: (party: PartyStateSnapshot, localUserId?: string | null) => void;
  setLocalUserId: (userId: string | null) => void;
  setLaunchError: (error: string | null) => void;
  clearParty: () => void;
}

export function getPartyMember(
  party: PartyStateSnapshot | null,
  userId: string | null | undefined
): PartyMemberSnapshot | null {
  if (!party || !userId) return null;
  return party.members.find((member) => member.userId === userId) ?? null;
}

export function isPartyLeader(
  party: PartyStateSnapshot | null,
  userId: string | null | undefined
): boolean {
  return Boolean(party && userId && party.leaderUserId === userId);
}

export function arePartyMembersReady(party: PartyStateSnapshot | null): boolean {
  if (!party) return false;
  if (!party.leaderUserId) return false;
  if (requiresUniquePartyHeroes(party.selectedMode) && hasDuplicatePartyHeroes(party.members)) return false;
  return party.members.every((member) => member.leader || member.ready);
}

export const usePartyStore = create<PartyStoreState>((set) => ({
  party: null,
  localUserId: null,
  launchError: null,
  setPartyState: (party, localUserId) => set((state) => ({
    party,
    localUserId: localUserId === undefined ? state.localUserId : localUserId,
    launchError: party.launchError,
  })),
  setLocalUserId: (localUserId) => set({ localUserId }),
  setLaunchError: (launchError) => set({ launchError }),
  clearParty: () => set({
    party: null,
    localUserId: null,
    launchError: null,
  }),
}));
