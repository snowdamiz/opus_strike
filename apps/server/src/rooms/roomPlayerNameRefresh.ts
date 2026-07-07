import type { RoomAuthContext } from '../auth/session';
import prisma from '../db';

export async function refreshRoomAuthDisplayName(authContext: RoomAuthContext | null | undefined): Promise<string | null> {
  if (!authContext?.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: authContext.userId },
    select: { name: true },
  });

  if (!user) return null;
  authContext.displayName = user.name;
  return user.name;
}
