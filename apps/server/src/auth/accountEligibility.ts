import prisma from '../db';
import { getActiveAccountRestriction } from '../anticheat/service';

export interface GameplayAccountRestriction {
  actionType: 'suspension' | 'ban';
  reason: string;
  expiresAt: Date | null;
}

export class AccountRestrictedError extends Error {
  readonly statusCode = 403;

  constructor(readonly restriction: GameplayAccountRestriction) {
    super(restriction.actionType === 'ban'
      ? 'Account is not eligible to join matches'
      : 'Account is temporarily restricted from matches');
    this.name = 'AccountRestrictedError';
  }
}

export async function getGameplayAccountRestriction(
  userId: string
): Promise<GameplayAccountRestriction | null> {
  return getActiveAccountRestriction(prisma, userId);
}

export async function assertGameplayAccountEligible(userId: string): Promise<void> {
  const restriction = await getGameplayAccountRestriction(userId);
  if (restriction) {
    throw new AccountRestrictedError(restriction);
  }
}
