import {
  ClipboardList,
  Gavel,
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SectionProps } from '../section';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { EmptyState, SectionHeader, Stat } from '../common';
import { formatRelativeTime } from '../format';

/**
 * Reads the first present, stringifiable value among `keys` from an opaque
 * object. Handles string/number/boolean. Returns '—' when nothing usable
 * is found so cells always render something sensible.
 */
function readField(obj: unknown, ...keys: string[]): string {
  if (obj == null || typeof obj !== 'object') return '—';
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    } else if (typeof value === 'number' && !Number.isNaN(value)) {
      return String(value);
    } else if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
  }
  return '—';
}

interface AntiCheatTableColumn {
  header: string;
  /** Pull the cell value defensively from an opaque item. */
  read: (item: unknown) => string;
  mono?: boolean;
  muted?: boolean;
}

interface AntiCheatTable {
  id: string;
  title: string;
  icon: LucideIcon;
  items: unknown[];
  columns: AntiCheatTableColumn[];
}

function asItemArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function AntiCheatSection({ console }: SectionProps) {
  const overview = console.overview;
  if (!overview) return null;

  const elevated = overview.admin.elevatedAntiCheatRole === true;
  const antiCheat = overview.antiCheat ?? {};

  const cases = asItemArray(antiCheat.cases);
  const rankedHolds = asItemArray(antiCheat.rankedHolds);
  const accountActions = asItemArray(antiCheat.accountActions);

  const tables: AntiCheatTable[] = [
    {
      id: 'cases',
      title: 'Review Cases',
      icon: ClipboardList,
      items: cases,
      columns: [
        { header: 'ID', read: (i) => readField(i, 'id', 'caseId'), mono: true },
        { header: 'Status', read: (i) => readField(i, 'status', 'state', 'verdict') },
        {
          header: 'Target',
          read: (i) => readField(i, 'targetUserId', 'userId', 'playerId', 'targetName'),
          mono: true,
        },
        { header: 'Reason', read: (i) => readField(i, 'reason', 'note', 'details'), muted: true },
        {
          header: 'Updated',
          read: (i) => formatRelativeTime(readField(i, 'updatedAt', 'createdAt')),
          muted: true,
        },
      ],
    },
    {
      id: 'rankedHolds',
      title: 'Ranked Holds',
      icon: Gavel,
      items: rankedHolds,
      columns: [
        { header: 'Match', read: (i) => readField(i, 'matchId', 'roomId', 'id'), mono: true },
        { header: 'Status', read: (i) => readField(i, 'status', 'state') },
        {
          header: 'Target',
          read: (i) => readField(i, 'userId', 'targetUserId', 'playerId'),
          mono: true,
        },
        { header: 'Reason', read: (i) => readField(i, 'reason', 'note', 'details'), muted: true },
        {
          header: 'Created',
          read: (i) => formatRelativeTime(readField(i, 'createdAt', 'updatedAt')),
          muted: true,
        },
      ],
    },
    {
      id: 'accountActions',
      title: 'Account Actions',
      icon: ShieldBan,
      items: accountActions,
      columns: [
        { header: 'ID', read: (i) => readField(i, 'id', 'actionId'), mono: true },
        { header: 'Type', read: (i) => readField(i, 'actionType', 'type', 'action') },
        {
          header: 'Target',
          read: (i) => readField(i, 'targetUserId', 'userId', 'playerId', 'targetName'),
          mono: true,
        },
        { header: 'Reason', read: (i) => readField(i, 'reason', 'note', 'details'), muted: true },
        {
          header: 'Created',
          read: (i) => formatRelativeTime(readField(i, 'createdAt', 'updatedAt', 'expiresAt')),
          muted: true,
        },
      ],
    },
  ];

  const populatedTables = tables.filter((t) => t.items.length > 0);
  const hasAnyItems = populatedTables.length > 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={ShieldAlert}
        title="Anti-Cheat"
        description="Review queue, ranked holds, and account actions reported in the overview snapshot."
      />

      {/* Access / role */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <CardTitle>Access</CardTitle>
          {elevated ? (
            <Badge variant="success">
              <ShieldCheck className="h-3 w-3" />
              Anti-Cheat Elevated
            </Badge>
          ) : (
            <Badge variant="outline">
              <ShieldAlert className="h-3 w-3" />
              Standard Access
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          <p className="text-sm text-white/55">
            {elevated
              ? 'This wallet holds elevated anti-cheat access. Sensitive review data is visible and elevated moderation actions are authorized for this operator.'
              : 'This wallet has standard access. Anti-cheat review data is visible, but elevated moderation actions are unavailable from this console.'}
          </p>
        </CardContent>
      </Card>

      {/* Counts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Cases" value={cases.length} icon={ClipboardList} tone="primary" />
        <Stat label="Ranked Holds" value={rankedHolds.length} icon={Gavel} tone="warning" />
        <Stat label="Account Actions" value={accountActions.length} icon={ShieldBan} tone="danger" />
      </div>

      {/* Per-array tables */}
      {hasAnyItems ? (
        populatedTables.map((table) => (
          <Card key={table.id}>
            <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
              <CardTitle className="flex items-center gap-2">
                <table.icon className="h-4 w-4 text-white/40" />
                {table.title}
              </CardTitle>
              <Badge variant="outline">{table.items.length}</Badge>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {table.columns.map((col) => (
                      <TableHead key={col.header}>{col.header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {table.items.map((item, rowIndex) => (
                    <TableRow key={`${table.id}-${rowIndex}`}>
                      {table.columns.map((col) => (
                        <TableCell
                          key={col.header}
                          className={
                            col.mono
                              ? 'font-mono text-xs text-white/70'
                              : col.muted
                                ? 'text-white/50'
                                : undefined
                          }
                        >
                          {col.read(item)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      ) : (
        <EmptyState
          icon={ShieldCheck}
          title="No anti-cheat items"
          description="The overview snapshot currently reports no cases, ranked holds, or account actions to review."
        />
      )}

      <p className="text-xs text-white/35">
        This is a read-only view of anti-cheat data carried in the overview payload. The dedicated
        case-resolution workflow and standalone anti-cheat endpoints are not yet wired into this
        console.
      </p>
    </div>
  );
}
