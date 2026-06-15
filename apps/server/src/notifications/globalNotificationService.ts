import prisma from '../db';

export const GLOBAL_NOTIFICATION_ID = 'active';
export const GLOBAL_NOTIFICATION_MAX_MESSAGE_LENGTH = 240;

export interface GlobalNotificationView {
  id: string;
  message: string;
  updatedByUserId: string | null;
  updatedAt: string;
}

function normalizeGlobalNotificationMessage(message: string): string {
  return message.trim().replace(/\s+/g, ' ').slice(0, GLOBAL_NOTIFICATION_MAX_MESSAGE_LENGTH);
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

  return toGlobalNotificationView(notification);
}

export async function removeGlobalNotification(): Promise<void> {
  await prisma.globalNotification.deleteMany({
    where: { id: GLOBAL_NOTIFICATION_ID },
  });
}
