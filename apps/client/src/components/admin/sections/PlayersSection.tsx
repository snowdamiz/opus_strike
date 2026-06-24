import * as React from 'react';
import { Loader2, Search, ShieldAlert, Users, X } from 'lucide-react';
import type { SectionProps } from '../section';
import type {
  AccountActionType,
  AdminUserRecord,
  PlayerReport,
  PlayerReportStatus,
} from '../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Separator } from '../ui/separator';
import { EmptyState, Field, KeyValue, SectionHeader } from '../common';
import { cn } from '../lib/utils';
import {
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  truncateAddress,
} from '../format';

/* ----------------------------- Helpers ------------------------------ */

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

const reportStatusVariant: Record<PlayerReportStatus, BadgeVariant> = {
  open: 'warning',
  reviewing: 'info',
  actioned: 'danger',
  cleared: 'success',
  dismissed: 'outline',
};

type ReportStatusChoice = 'reviewing' | 'cleared' | 'dismissed';

function truncateId(value: string | null | undefined, max = 12): string {
  if (!value) return '—';
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function toIsoOrUndefined(local: string): string | undefined {
  const trimmed = local.trim();
  if (!trimmed) return undefined;
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toISOString();
}

/* ----------------------------- Section ------------------------------ */

export function PlayersSection({ console }: SectionProps) {
  if (!console.overview) return null;

  const reports = console.overview.playerReports?.reports ?? [];

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={Users}
        title="Players"
        description="Triage player reports, apply account actions, and manage competitive ranks."
      />

      <Tabs defaultValue="reports">
        <TabsList>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="players">Players</TabsTrigger>
        </TabsList>

        <TabsContent value="reports">
          <ReportsTab console={console} reports={reports} />
        </TabsContent>

        <TabsContent value="players">
          <PlayersTab console={console} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ----------------------------- Reports ------------------------------ */

function ReportsTab({
  console,
  reports,
}: {
  console: SectionProps['console'];
  reports: PlayerReport[];
}) {
  if (reports.length === 0) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="No player reports"
        description="When players submit reports, they will appear here for triage and action."
      />
    );
  }

  return (
    <div className="rounded-xl border border-strike-border bg-strike-panel-raised">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Reporter</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Context</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.map((report) => (
            <TableRow key={report.id}>
              <TableCell>
                <Badge variant={reportStatusVariant[report.status] ?? 'default'}>
                  {report.status}
                </Badge>
              </TableCell>
              <TableCell className="text-white/80">
                {report.reporterName || report.reporterUserId || '—'}
              </TableCell>
              <TableCell className="text-white/80">
                {report.targetName || report.targetUserId || '—'}
              </TableCell>
              <TableCell className="max-w-[16rem] truncate text-white/70">
                {report.reason || '—'}
              </TableCell>
              <TableCell className="font-mono text-xs text-white/50">
                {report.matchId
                  ? truncateId(report.matchId)
                  : report.roomId
                    ? truncateId(report.roomId)
                    : '—'}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-white/50">
                {formatRelativeTime(report.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                <ManageReportDialog console={console} report={report} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ManageReportDialog({
  console,
  report,
}: {
  console: SectionProps['console'];
  report: PlayerReport;
}) {
  const [open, setOpen] = React.useState(false);

  // Status update state
  const [statusChoice, setStatusChoice] = React.useState<ReportStatusChoice>('reviewing');
  const [statusNote, setStatusNote] = React.useState('');
  const [savingStatus, setSavingStatus] = React.useState(false);

  // Account action state
  const [actionType, setActionType] = React.useState<AccountActionType>('suspension');
  const [actionReason, setActionReason] = React.useState('');
  const [expiresAt, setExpiresAt] = React.useState('');
  const [savingAction, setSavingAction] = React.useState(false);

  const busy = savingStatus || savingAction;

  React.useEffect(() => {
    if (!open) {
      setStatusChoice('reviewing');
      setStatusNote('');
      setActionType('suspension');
      setActionReason('');
      setExpiresAt('');
    }
  }, [open]);

  async function handleUpdateStatus() {
    setSavingStatus(true);
    try {
      const res = await console.updateReportStatus(report.id, {
        status: statusChoice,
        note: statusNote.trim() || undefined,
      });
      if (res.ok) setOpen(false);
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleApplyAction() {
    setSavingAction(true);
    try {
      const res = await console.createAccountAction(report.id, {
        actionType,
        reason: actionReason.trim(),
        expiresAt: toIsoOrUndefined(expiresAt),
      });
      if (res.ok) setOpen(false);
    } finally {
      setSavingAction(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Manage
      </Button>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage Report</DialogTitle>
          <DialogDescription>
            Review the report detail and apply a status change or account action.
          </DialogDescription>
        </DialogHeader>

        {/* Detail */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant={reportStatusVariant[report.status] ?? 'default'}>
              {report.status}
            </Badge>
            <span className="text-xs text-white/40">
              {formatRelativeTime(report.createdAt)}
            </span>
          </div>
          <div className="divide-y divide-strike-border rounded-lg border border-strike-border bg-strike-canvas/40 px-3">
            <KeyValue
              label="Reporter"
              value={report.reporterName || report.reporterUserId || '—'}
            />
            <KeyValue
              label="Target"
              value={report.targetName || report.targetUserId || '—'}
            />
            <KeyValue label="Reason" value={report.reason || '—'} />
            {report.matchId ? (
              <KeyValue label="Match" value={report.matchId} mono />
            ) : null}
            {report.roomId ? (
              <KeyValue label="Room" value={report.roomId} mono />
            ) : null}
            {report.resolution ? (
              <KeyValue label="Resolution" value={report.resolution} />
            ) : null}
            {report.resolvedByUser || report.resolvedByUserId ? (
              <KeyValue
                label="Resolved By"
                value={report.resolvedByUser?.name ?? report.resolvedByUserId ?? '—'}
              />
            ) : null}
            {report.resolvedAt ? (
              <KeyValue label="Resolved" value={formatDateTime(report.resolvedAt)} />
            ) : null}
            <KeyValue label="Created" value={formatDateTime(report.createdAt)} />
            <KeyValue label="Updated" value={formatDateTime(report.updatedAt)} />
          </div>
          {report.details ? (
            <div className="rounded-lg border border-strike-border bg-strike-canvas/40 p-3">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-white/45">
                Details
              </p>
              <p className="whitespace-pre-wrap text-sm text-white/75">{report.details}</p>
            </div>
          ) : null}
        </div>

        <Separator />

        {/* Update status */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
            Update Status
          </p>
          <Field label="New Status">
            <Select
              value={statusChoice}
              onValueChange={(v) => setStatusChoice(v as ReportStatusChoice)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reviewing">Reviewing</SelectItem>
                <SelectItem value="cleared">Cleared</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Note" hint="Optional context recorded with the status change.">
            <Textarea
              value={statusNote}
              onChange={(e) => setStatusNote(e.target.value)}
              placeholder="Add a note for the audit trail…"
            />
          </Field>
          <div className="flex justify-end">
            <Button onClick={handleUpdateStatus} disabled={busy}>
              {savingStatus ? <Loader2 className="animate-spin" /> : null}
              Update Status
            </Button>
          </div>
        </div>

        <Separator />

        {/* Account action */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
            Account Action
          </p>
          <Field label="Action Type">
            <Select
              value={actionType}
              onValueChange={(v) => setActionType(v as AccountActionType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="suspension">Suspension</SelectItem>
                <SelectItem value="ban">Ban</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Reason" hint="Required. Stored with the enforcement record.">
            <Textarea
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              placeholder="Describe the violation and rationale…"
            />
          </Field>
          <Field
            label="Expires At"
            hint="Optional. Leave empty for an indefinite action."
          >
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <Button
              variant="destructive"
              onClick={handleApplyAction}
              disabled={busy || actionReason.trim().length === 0}
            >
              {savingAction ? <Loader2 className="animate-spin" /> : null}
              Apply Action
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- Players ------------------------------ */

function PlayersTab({ console }: { console: SectionProps['console'] }) {
  const { users, usersLoading, usersError, loadUsers } = console;

  const [searchInput, setSearchInput] = React.useState('');
  const [activeQuery, setActiveQuery] = React.useState('');
  const requestedRef = React.useRef(false);

  // Load the first page once when the Players tab first renders.
  React.useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    void loadUsers({ page: 1 });
  }, [loadUsers]);

  function handleSearch() {
    const query = searchInput.trim();
    setActiveQuery(query);
    void loadUsers({ page: 1, query });
  }

  function handleClear() {
    setSearchInput('');
    setActiveQuery('');
    void loadUsers({ page: 1 });
  }

  const pagination = users?.pagination;
  const bounds = users?.ratingBounds ?? { min: 0, max: 5000, default: 1000 };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            placeholder="Search by name or wallet…"
            className="pl-9"
          />
        </div>
        <Button variant="secondary" onClick={handleSearch} disabled={usersLoading}>
          Search
        </Button>
        {activeQuery ? (
          <Button variant="ghost" onClick={handleClear} disabled={usersLoading}>
            <X className="h-4 w-4" />
            Clear
          </Button>
        ) : null}
      </div>

      {usersError ? (
        <div className="rounded-lg border border-ui-danger/25 bg-ui-danger/[0.06] px-4 py-3 text-sm text-ui-danger">
          {usersError}
        </div>
      ) : null}

      {/* Table */}
      <div className="rounded-xl border border-strike-border bg-strike-panel-raised">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Wallet</TableHead>
              <TableHead>Rank</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Ranked W/L/D</TableHead>
              <TableHead>Peak</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersLoading && !users ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-white/40">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </span>
                </TableCell>
              </TableRow>
            ) : users && users.users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-white/40">
                  No players match this search.
                </TableCell>
              </TableRow>
            ) : (
              users?.users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium text-white">{user.name}</TableCell>
                  <TableCell className="font-mono text-xs text-white/55">
                    {truncateAddress(user.walletAddress)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <Badge variant="secondary" className="w-fit">
                        {user.rank?.label ?? '—'}
                      </Badge>
                      {user.rank?.rangeLabel ? (
                        <span className="text-[10px] text-white/35">
                          {user.rank.rangeLabel}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-white/80">
                    {formatNumber(user.competitiveRating)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-white/65">
                    {formatNumber(user.rankedWins)}/{formatNumber(user.rankedLosses)}/
                    {formatNumber(user.rankedDraws)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-white/65">
                    {formatNumber(user.rankedPeakRating)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-white/50">
                    {formatRelativeTime(user.lastLoginAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <EditRankDialog console={console} user={user} bounds={bounds} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pagination ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-white/45">
            Page {pagination.page} of {pagination.totalPages} ·{' '}
            {formatNumber(pagination.total)} total
            {usersLoading ? (
              <span className="ml-2 inline-flex items-center gap-1 text-white/35">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </span>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasPrevious || usersLoading}
              onClick={() =>
                void loadUsers({ page: pagination.page - 1, query: activeQuery })
              }
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasNext || usersLoading}
              onClick={() =>
                void loadUsers({ page: pagination.page + 1, query: activeQuery })
              }
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EditRankDialog({
  console,
  user,
  bounds,
}: {
  console: SectionProps['console'];
  user: AdminUserRecord;
  bounds: { min: number; max: number; default: number };
}) {
  const [open, setOpen] = React.useState(false);
  const [rating, setRating] = React.useState<string>(String(user.competitiveRating));
  const [reason, setReason] = React.useState('');
  const [confirming, setConfirming] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setRating(String(user.competitiveRating));
      setReason('');
      setConfirming(false);
    }
  }, [open, user.competitiveRating]);

  const parsed = Number(rating);
  const valid =
    rating.trim() !== '' &&
    Number.isFinite(parsed) &&
    parsed >= bounds.min &&
    parsed <= bounds.max;

  async function handleConfirmSave() {
    if (!valid) return;
    setSaving(true);
    try {
      const res = await console.updateUserRank(user.id, {
        competitiveRating: parsed,
        reason: reason.trim() || undefined,
      });
      if (res.ok) setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Edit Rank
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Rank · {user.name}</DialogTitle>
          <DialogDescription>
            Manually override the player's competitive rating. Current rating:{' '}
            <span className="font-mono text-white/80">
              {formatNumber(user.competitiveRating)}
            </span>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field
            label="Competitive Rating"
            hint={`Allowed range: ${formatNumber(bounds.min)} – ${formatNumber(bounds.max)}.`}
          >
            <Input
              type="number"
              min={bounds.min}
              max={bounds.max}
              value={rating}
              onChange={(e) => {
                setRating(e.target.value);
                setConfirming(false);
              }}
              className={cn(!valid && 'border-ui-danger/60 focus-visible:border-ui-danger/60')}
            />
          </Field>
          <Field label="Reason" hint="Optional. Recorded with the rating change.">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. corrective adjustment after appeal"
            />
          </Field>
        </div>

        {confirming ? (
          <div className="space-y-3 rounded-lg border border-ui-danger/25 bg-ui-danger/[0.06] p-3">
            <p className="text-sm text-white/80">
              Confirm manual rating change to{' '}
              <span className="font-mono text-ui-warning">{formatNumber(parsed)}</span>?
              This overrides the player's earned rating.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleConfirmSave}
                disabled={saving || !valid}
              >
                {saving ? <Loader2 className="animate-spin" /> : null}
                Confirm & Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button onClick={() => setConfirming(true)} disabled={!valid}>
              Save Rank
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
