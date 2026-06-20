import { Prisma, type PersistentParty } from '@prisma/client';
import type { PartyRosterRuntime } from './partyRuntime';
import prisma from '../db';

export const PERSISTENT_PARTY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SavePersistentPartyInput {
  persistentPartyId: string;
  roomId: string;
  ownerUserId: string;
  leaderUserId: string | null;
  allowedUserIds: string[];
  party: PartyRosterRuntime;
}

export type PersistentPartyRecord = PersistentParty;

function dedupeUserIds(userIds: Iterable<string>): string[] {
  return Array.from(new Set(
    Array.from(userIds)
      .map((userId) => userId.trim())
      .filter(Boolean)
  ));
}

function serializeSnapshot(party: PartyRosterRuntime): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(party.persistentSnapshot())) as Prisma.InputJsonValue;
}

export async function savePersistentParty(input: SavePersistentPartyInput): Promise<PersistentPartyRecord> {
  const allowedUserIds = dedupeUserIds([
    input.ownerUserId,
    input.leaderUserId ?? '',
    ...input.allowedUserIds,
  ]);
  const expiresAt = new Date(Date.now() + PERSISTENT_PARTY_TTL_MS);

  return prisma.persistentParty.upsert({
    where: { id: input.persistentPartyId },
    create: {
      id: input.persistentPartyId,
      roomId: input.roomId,
      ownerUserId: input.ownerUserId,
      leaderUserId: input.leaderUserId,
      allowedUserIds,
      snapshot: serializeSnapshot(input.party),
      expiresAt,
    },
    update: {
      roomId: input.roomId,
      ownerUserId: input.ownerUserId,
      leaderUserId: input.leaderUserId,
      allowedUserIds,
      snapshot: serializeSnapshot(input.party),
      expiresAt,
    },
  });
}

export async function deletePersistentParty(persistentPartyId: string): Promise<void> {
  await prisma.persistentParty.deleteMany({
    where: { id: persistentPartyId },
  });
}

export async function deletePersistentPartyByRoomId(roomId: string): Promise<void> {
  await prisma.persistentParty.deleteMany({
    where: { roomId },
  });
}

export async function loadPersistentPartyForRestore(
  persistentPartyId: string,
  userId: string,
  now = new Date()
): Promise<PersistentPartyRecord | null> {
  return prisma.persistentParty.findFirst({
    where: {
      id: persistentPartyId,
      expiresAt: { gt: now },
      OR: [
        { ownerUserId: userId },
        { allowedUserIds: { has: userId } },
      ],
    },
  });
}

export async function findActivePersistentPartyForUser(
  userId: string,
  now = new Date()
): Promise<PersistentPartyRecord | null> {
  return prisma.persistentParty.findFirst({
    where: {
      expiresAt: { gt: now },
      OR: [
        { ownerUserId: userId },
        { allowedUserIds: { has: userId } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function canUserAccessPersistentPartyRoom(roomId: string, userId: string): Promise<boolean> {
  const party = await prisma.persistentParty.findFirst({
    where: {
      roomId,
      expiresAt: { gt: new Date() },
      OR: [
        { ownerUserId: userId },
        { allowedUserIds: { has: userId } },
      ],
    },
    select: { id: true },
  });

  return Boolean(party);
}
