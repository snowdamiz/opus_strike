import type { Prisma, PrismaClient } from '@prisma/client';

export const PLAYER_REPORT_STATUSES = ['open', 'reviewing', 'cleared', 'actioned', 'dismissed'] as const;
export type PlayerReportStatus = typeof PLAYER_REPORT_STATUSES[number];

const ACTIVE_REPORT_STATUSES = new Set<PlayerReportStatus>(['open', 'reviewing']);
const REPORT_STATUS_RANK: Record<PlayerReportStatus, number> = {
  open: 0,
  reviewing: 1,
  actioned: 2,
  cleared: 3,
  dismissed: 4,
};

export function isPlayerReportStatus(value: unknown): value is PlayerReportStatus {
  return typeof value === 'string' && PLAYER_REPORT_STATUSES.includes(value as PlayerReportStatus);
}

function serializeDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function reportStatusRank(status: string): number {
  return REPORT_STATUS_RANK[status as PlayerReportStatus] ?? 99;
}

function summarizeUsers(users: Array<{ id: string; name: string; walletAddress: string | null }>) {
  return new Map(users.map((user) => [user.id, user]));
}

export interface CreatePlayerReportInput {
  reason: string;
  details: string | null;
  reporterUserId: string;
  reporterPlayerSessionId: string;
  reporterName: string;
  targetUserId: string;
  targetPlayerSessionId: string;
  targetName: string;
  targetTeam: string | null;
  roomId: string;
  matchId: string | null;
  lobbyId: string | null;
  matchMode: Prisma.PlayerReportCreateInput['matchMode'];
  mapSeed: number | null;
  serverTick: number;
  evidenceEventId: string | null;
  metadata: unknown;
}

export async function createPlayerReport(
  prisma: PrismaClient,
  input: CreatePlayerReportInput
): Promise<{ id: string }> {
  return prisma.playerReport.create({
    select: { id: true },
    data: {
      status: 'open',
      reason: input.reason,
      details: input.details,
      reporterUserId: input.reporterUserId,
      reporterPlayerSessionId: input.reporterPlayerSessionId,
      reporterName: input.reporterName,
      targetUserId: input.targetUserId,
      targetPlayerSessionId: input.targetPlayerSessionId,
      targetName: input.targetName,
      targetTeam: input.targetTeam,
      roomId: input.roomId,
      matchId: input.matchId,
      lobbyId: input.lobbyId,
      matchMode: input.matchMode,
      mapSeed: input.mapSeed,
      serverTick: input.serverTick,
      evidenceEventId: input.evidenceEventId,
      metadata: serializeReportMetadata(input.metadata),
    },
  });
}

export async function listPlayerReportQueue(prisma: PrismaClient): Promise<{
  reports: Array<{
    id: string;
    status: string;
    reason: string;
    details: string | null;
    reporterUserId: string;
    reporterPlayerSessionId: string;
    reporterName: string;
    reporterUser: { id: string; name: string; walletAddress: string | null } | null;
    targetUserId: string;
    targetPlayerSessionId: string;
    targetName: string;
    targetTeam: string | null;
    targetUser: { id: string; name: string; walletAddress: string | null } | null;
    roomId: string;
    matchId: string | null;
    lobbyId: string | null;
    matchMode: string | null;
    mapSeed: number | null;
    serverTick: number;
    evidenceEventId: string | null;
    resolvedByUserId: string | null;
    resolvedByUser: { id: string; name: string; walletAddress: string | null } | null;
    resolvedAt: string | null;
    resolution: string | null;
    actionType: string | null;
    accountActionId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  counts: Record<string, number>;
}> {
  const reports = await prisma.playerReport.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  const userIds = Array.from(new Set(reports.flatMap((report) => [
    report.reporterUserId,
    report.targetUserId,
    report.resolvedByUserId,
  ]).filter((id): id is string => Boolean(id))));

  const usersById = summarizeUsers(userIds.length === 0 ? [] : await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, walletAddress: true },
  }));

  const sortedReports = [...reports].sort((a, b) => (
    reportStatusRank(a.status) - reportStatusRank(b.status)
    || b.updatedAt.getTime() - a.updatedAt.getTime()
  ));

  const counts: Record<string, number> = {};
  for (const report of reports) {
    counts[report.status] = (counts[report.status] ?? 0) + 1;
  }

  return {
    reports: sortedReports.map((report) => ({
      id: report.id,
      status: report.status,
      reason: report.reason,
      details: report.details,
      reporterUserId: report.reporterUserId,
      reporterPlayerSessionId: report.reporterPlayerSessionId,
      reporterName: report.reporterName,
      reporterUser: usersById.get(report.reporterUserId) ?? null,
      targetUserId: report.targetUserId,
      targetPlayerSessionId: report.targetPlayerSessionId,
      targetName: report.targetName,
      targetTeam: report.targetTeam,
      targetUser: usersById.get(report.targetUserId) ?? null,
      roomId: report.roomId,
      matchId: report.matchId,
      lobbyId: report.lobbyId,
      matchMode: report.matchMode,
      mapSeed: report.mapSeed,
      serverTick: report.serverTick,
      evidenceEventId: report.evidenceEventId,
      resolvedByUserId: report.resolvedByUserId,
      resolvedByUser: report.resolvedByUserId ? usersById.get(report.resolvedByUserId) ?? null : null,
      resolvedAt: serializeDate(report.resolvedAt),
      resolution: report.resolution,
      actionType: report.actionType,
      accountActionId: report.accountActionId,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    })),
    counts,
  };
}

export function buildPlayerReportResolution(input: {
  status: PlayerReportStatus;
  actorName: string;
  note: string;
}): string {
  const suffix = input.note ? `: ${input.note}` : '';
  return `${input.status} by ${input.actorName}${suffix}`;
}

export function buildReportActionResolution(input: {
  actionType: string;
  actorName: string;
  reason: string;
}): string {
  return `${input.actionType} by ${input.actorName}: ${input.reason}`;
}

export function createPlayerReportUpdate(input: {
  status: PlayerReportStatus;
  actorUserId: string;
  resolution: string;
}): Prisma.PlayerReportUpdateInput {
  const resolved = !ACTIVE_REPORT_STATUSES.has(input.status);
  return {
    status: input.status,
    resolvedByUserId: resolved ? input.actorUserId : null,
    resolvedAt: resolved ? new Date() : null,
    resolution: input.resolution,
  };
}

export function serializeReportMetadata(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
