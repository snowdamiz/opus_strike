import prisma from '../db';

export const GLOBAL_NOTIFICATION_ID = 'active';
export const GLOBAL_NOTIFICATION_MAX_MESSAGE_LENGTH = 240;
const GLOBAL_NOTIFICATION_CACHE_TTL_MS = 30_000;

export interface GlobalNotificationView {
  id: string;
  message: string;
  updatedByUserId: string | null;
  updatedAt: string;
}

export interface CachedGlobalNotification {
  notification: GlobalNotificationView | null;
  etag: string;
}

let cachedGlobalNotification: (CachedGlobalNotification & { expiresAt: number }) | null = null;

function normalizeGlobalNotificationMessage(message: string): string {
  return message.trim().replace(/\s+/g, ' ').slice(0, GLOBAL_NOTIFICATION_MAX_MESSAGE_LENGTH);
}

function createGlobalNotificationEtag(notification: GlobalNotificationView | null): string {
  if (!notification) return 'W/"global-notification-empty"';
  return `W/"global-notification-${notification.id}-${notification.updatedAt}"`;
}

function clearGlobalNotificationCache(): void {
  cachedGlobalNotification = null;
}

function toGlobalNotificationView(row: {
  id: string;
  message: string;
  updatedByUserId: string | null;
  updatedAt: Date;
}): GlobalNotificationView {
  return {
    id: row.id,
    message: row.message,
    updatedByUserId: row.updatedByUserId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getGlobalNotification(): Promise<GlobalNotificationView | null> {
  const notification = await prisma.globalNotification.findUnique({
    where: { id: GLOBAL_NOTIFICATION_ID },
  });

  return notification ? toGlobalNotificationView(notification) : null;
}

export async function getCachedGlobalNotification(): Promise<CachedGlobalNotification> {
  const now = Date.now();
  if (cachedGlobalNotification && cachedGlobalNotification.expiresAt > now) {
    return {
      notification: cachedGlobalNotification.notification,
      etag: cachedGlobalNotification.etag,
    };
  }

  const notification = await getGlobalNotification();
  const etag = createGlobalNotificationEtag(notification);
  cachedGlobalNotification = {
    notification,
    etag,
    expiresAt: now + GLOBAL_NOTIFICATION_CACHE_TTL_MS,
  };

  return { notification, etag };
}

export async function setGlobalNotification(
  message: string,
  updatedByUserId: string | null
): Promise<GlobalNotificationView> {
  const normalizedMessage = normalizeGlobalNotificationMessage(message);
  if (!normalizedMessage) throw new Error('Notification message is required');

  const notification = await prisma.globalNotification.upsert({
    where: { id: GLOBAL_NOTIFICATION_ID },
    create: {
      id: GLOBAL_NOTIFICATION_ID,
      message: normalizedMessage,
      updatedByUserId,
    },
    update: {
      message: normalizedMessage,
      updatedByUserId,
    },
  });

  clearGlobalNotificationCache();
  return toGlobalNotificationView(notification);
}

export async function removeGlobalNotification(): Promise<void> {
  await prisma.globalNotification.deleteMany({
    where: { id: GLOBAL_NOTIFICATION_ID },
  });
  clearGlobalNotificationCache();
}
