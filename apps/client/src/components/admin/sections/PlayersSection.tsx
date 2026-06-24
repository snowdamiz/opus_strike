import { useMemo } from 'react';
import { RankBadge } from '../../ui/RankBadge';
import {
  RANK_OPTIONS,
  formatAge,
  formatCompactIdentifier,
  formatCount,
  formatNumber,
  getActiveReportCount,
  getRankFromRating,
  getRankPreview,
  parseDraftRating,
  toneForSystemStatus,
} from '../format';
import { Button, EmptyState, Panel, Pill, TableScroll, Td, Th } from '../primitives';
import type { AdminConsoleController } from '../useAdminConsole';
import { ADMIN_MANUAL_RATING_MAX, type AdminOverview, type AdminRankUser } from '../types';

export function PlayersSection({ ctrl, overview }: { ctrl: AdminConsoleController; overview: AdminOverview }) {
  const reports = overview.playerReports?.reports ?? [];

  return (
    <div className="space-y-4">
      <Panel title="Player reports" meta={`${formatNumber(getActiveReportCount(overview))} active`} bleed>
        {reports.length === 0 ? (
          <EmptyState label="No player reports." />
        ) : (
          <TableScroll minWidth={1120}>
            <thead>
              <tr>
                <Th>Report</Th>
                <Th>Status</Th>
                <Th>Target</Th>
                <Th>Reporter</Th>
                <Th>Reason</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => {
                const busy = ctrl.busyReportId === report.id;
                return (
                  <tr key={report.id}>
                    <Td mono>
                      <div className="break-all">{report.id}</div>
                      <div className="ac-text-faint mt-1 text-[11px]">{formatAge(Date.parse(report.createdAt))}</div>
                    </Td>
                    <Td><Pill tone={toneForSystemStatus(report.status)}>{report.status}</Pill></Td>
                    <Td>
                      <div className="truncate">{report.targetUser?.name || report.targetName}</div>
                      <div className="ac-mono ac-text-faint mt-1 break-all text-[11px]">{report.targetUserId}</div>
                      {report.targetTeam && <div className="ac-text-faint mt-0.5 text-[11px]">{report.targetTeam}</div>}
                    </Td>
                    <Td>
                      <div className="ac-text-muted truncate">{report.reporterUser?.name || report.reporterName}</div>
                      <div className="ac-mono ac-text-faint mt-1 break-all text-[11px]">{report.matchId || report.roomId}</div>
                    </Td>
                    <Td>
                      <div className="ac-text-muted">{report.reason}</div>
                      {report.details && <div className="ac-text-faint mt-1 line-clamp-2 text-[11px]">{report.details}</div>}
                      {report.resolution && <div className="ac-text-success mt-1.5 line-clamp-2 text-[11px]">{report.resolution}</div>}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" disabled={busy} onClick={() => ctrl.updateReportStatus(report, 'reviewing')}>Review</Button>
                        <Button size="sm" disabled={busy} onClick={() => ctrl.updateReportStatus(report, 'cleared')}>Clear</Button>
                        <Button size="sm" disabled={busy} onClick={() => ctrl.updateReportStatus(report, 'dismissed')}>Dismiss</Button>
                        <Button size="sm" disabled={busy} onClick={() => ctrl.applyReportAccountAction(report, 'suspension')}>Suspend</Button>
                        <Button size="sm" variant="danger" disabled={busy} onClick={() => ctrl.applyReportAccountAction(report, 'ban')}>Ban</Button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableScroll>
        )}
      </Panel>

      <PlayerRanks ctrl={ctrl} />
    </div>
  );
}

function PlayerRanks({ ctrl }: { ctrl: AdminConsoleController }) {
  const { rankUsersPagination: pagination } = ctrl;
  const firstVisible = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const lastVisible = Math.min(pagination.total, pagination.page * pagination.limit);

  const gateOptions = useMemo(() => [
    { value: '', label: 'Exact override' },
    ...RANK_OPTIONS.map((option) => ({ value: option.rating.toString(), label: `${option.label} · ${option.rangeLabel}` })),
  ], []);

  return (
    <Panel title="Player ranks" meta={`${formatNumber(pagination.total)} users`} bleed>
      <form
        className="grid gap-3 border-b border-[color:var(--ac-border)] p-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto]"
        onSubmit={(event) => { event.preventDefault(); ctrl.searchRankUsers(); }}
      >
        <label className="block min-w-0">
          <span className="ac-label">Search</span>
          <input
            className="ac-input mt-2"
            value={ctrl.rankSearch}
            placeholder="Name, wallet, or user id"
            onChange={(event) => ctrl.setRankSearch(event.target.value)}
          />
        </label>
        <label className="block min-w-0">
          <span className="ac-label">Reason</span>
          <input
            className="ac-input mt-2"
            value={ctrl.rankReason}
            placeholder="Manual correction"
            onChange={(event) => ctrl.setRankReason(event.target.value)}
          />
        </label>
        <div className="flex items-end gap-2">
          <Button variant="primary" type="submit" disabled={ctrl.rankUsersLoading}>Search</Button>
          <Button disabled={ctrl.rankUsersLoading} onClick={ctrl.clearRankUserSearch}>Clear</Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--ac-border)] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="accent">{formatNumber(pagination.total)} users</Pill>
          <span className="ac-text-faint text-[11px]">
            Showing {formatNumber(firstVisible)}–{formatNumber(lastVisible)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={ctrl.rankUsersLoading || !pagination.hasPrevious} onClick={() => ctrl.changeRankUserPage(pagination.page - 1)}>Prev</Button>
          <span className="ac-mono ac-text-faint min-w-[5rem] text-center text-[11px]">{formatNumber(pagination.page)} / {formatNumber(pagination.totalPages)}</span>
          <Button size="sm" disabled={ctrl.rankUsersLoading || !pagination.hasNext} onClick={() => ctrl.changeRankUserPage(pagination.page + 1)}>Next</Button>
        </div>
      </div>

      {ctrl.rankUsers.length === 0 ? (
        <EmptyState label={ctrl.rankUsersLoading ? 'Loading players…' : 'No users found.'} />
      ) : (
        <TableScroll minWidth={1180}>
          <thead>
            <tr>
              <Th>Player</Th>
              <Th>Current</Th>
              <Th>Set rating</Th>
              <Th>Ranked record</Th>
              <Th>Peak</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {ctrl.rankUsers.map((user) => (
              <RankRow key={user.id} ctrl={ctrl} user={user} gateOptions={gateOptions} />
            ))}
          </tbody>
        </TableScroll>
      )}
    </Panel>
  );
}

function RankRow({
  ctrl,
  user,
  gateOptions,
}: {
  ctrl: AdminConsoleController;
  user: AdminRankUser;
  gateOptions: Array<{ value: string; label: string }>;
}) {
  const draft = ctrl.rankUserDrafts[user.id] ?? user.competitiveRating.toString();
  const parsedRating = parseDraftRating(draft);
  const busy = ctrl.busyRankUserId === user.id;
  const canSave = parsedRating !== null && parsedRating !== user.competitiveRating && !busy;
  const optionValue = parsedRating !== null && RANK_OPTIONS.some((option) => option.rating === parsedRating)
    ? parsedRating.toString()
    : '';
  const preview = getRankPreview(draft, user.rankedGames);
  const currentRank = getRankFromRating(user.competitiveRating, user.rankedGames);
  const peakRank = getRankFromRating(user.rankedPeakRating, user.rankedGames);

  return (
    <tr>
      <Td>
        <div className="truncate">{user.name}</div>
        {user.walletAddress && (
          <div className="ac-mono ac-text-faint mt-1 truncate text-[10px]" title={user.walletAddress}>
            {formatCompactIdentifier(user.walletAddress)}
          </div>
        )}
        <div className="ac-text-faint mt-1 text-[11px]">
          Last login {user.lastLoginAt ? formatAge(Date.parse(user.lastLoginAt)) : 'never'}
        </div>
      </Td>
      <Td>
        <RankBadge rank={currentRank} compact className="max-w-full rounded-md" />
        <div className="ac-text-muted mt-1.5 text-[11px]">{formatNumber(user.competitiveRating)} rating</div>
      </Td>
      <Td>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6.5rem]">
          <select
            className="ac-input"
            aria-label={`Target rank gate for ${user.name}`}
            value={optionValue}
            disabled={busy}
            onChange={(event) => { if (event.target.value) ctrl.updateRankUserDraft(user.id, event.target.value); }}
          >
            {gateOptions.map((option) => (
              <option key={option.value || 'exact'} value={option.value}>{option.label}</option>
            ))}
          </select>
          <input
            className="ac-input ac-mono"
            type="number"
            min={0}
            max={ADMIN_MANUAL_RATING_MAX}
            value={draft}
            disabled={busy}
            onChange={(event) => ctrl.updateRankUserDraft(user.id, event.target.value)}
          />
        </div>
        <div className={`mt-2 text-[11px] ${parsedRating === null ? 'ac-text-danger' : 'ac-text-faint'}`}>
          {preview.rating === null
            ? preview.label
            : `→ ${preview.label} · gate ${preview.gateLabel} (${preview.rangeLabel})`}
        </div>
      </Td>
      <Td>
        <div className="ac-text-muted">{formatNumber(user.rankedWins)}W / {formatNumber(user.rankedLosses)}L / {formatNumber(user.rankedDraws)}D</div>
        <div className="ac-text-faint mt-1 text-[11px]">{formatCount(user.rankedGames, 'ranked game')}</div>
      </Td>
      <Td>
        <RankBadge rank={peakRank} compact className="max-w-full rounded-md" />
        <div className="ac-text-muted mt-1.5 text-[11px]">{formatNumber(user.rankedPeakRating)} rating</div>
      </Td>
      <Td>
        <Button size="sm" variant="primary" disabled={!canSave} onClick={() => ctrl.saveRankUser(user)}>Save rank</Button>
      </Td>
    </tr>
  );
}
