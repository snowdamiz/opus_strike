import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronRight,
  Cpu,
  Database,
  Gauge,
  Bell,
  LayoutDashboard,
  Radio,
  ShieldAlert,
  Swords,
  Users,
} from 'lucide-react';
import type { SectionProps } from '../section';
import type { SectionId } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { EmptyState, KeyValue, SectionHeader, Stat } from '../common';
import { cn } from '../lib/utils';
import { formatDateTime, formatNumber, formatPercent } from '../format';

interface AttentionItem {
  id: string;
  tone: 'danger' | 'warning' | 'info';
  icon: typeof AlertTriangle;
  title: string;
  detail: string;
  target: SectionId;
}

export function OverviewSection({ console, navigate }: SectionProps) {
  const overview = console.overview;
  if (!overview) return null;

  const { totals, capacity, diagnostics } = overview;
  const reports = overview.playerReports?.reports ?? [];
  const openReports = reports.filter((r) => r.status === 'open' || r.status === 'reviewing').length;
  const goldenRewards = overview.goldenBiomeRewards?.rewards ?? [];
  const pendingGolden = goldenRewards.filter(
    (r) => r.status === 'pending' || r.status === 'failed'
  ).length;
  const pressure = typeof capacity.capacityPressure === 'number' ? capacity.capacityPressure : null;

  const attention: AttentionItem[] = [];
  if (capacity.full || (pressure != null && pressure >= 0.85)) {
    attention.push({
      id: 'capacity',
      tone: capacity.full ? 'danger' : 'warning',
      icon: Gauge,
      title: capacity.full ? 'Capacity is full' : 'Capacity pressure is high',
      detail:
        pressure != null
          ? `Pressure at ${formatPercent(pressure, 0)} — review machine scaling.`
          : 'Review machine scaling.',
      target: 'infrastructure',
    });
  }
  if (openReports > 0) {
    attention.push({
      id: 'reports',
      tone: 'warning',
      icon: ShieldAlert,
      title: `${openReports} player report${openReports === 1 ? '' : 's'} need review`,
      detail: 'Triage the report queue and apply account actions.',
      target: 'players',
    });
  }
  if (pendingGolden > 0) {
    attention.push({
      id: 'golden',
      tone: 'info',
      icon: Activity,
      title: `${pendingGolden} golden reward${pendingGolden === 1 ? '' : 's'} pending`,
      detail: 'Distribute pending or failed golden biome rewards.',
      target: 'economy',
    });
  }
  if (!diagnostics.redis.ok) {
    attention.push({
      id: 'redis',
      tone: 'danger',
      icon: Database,
      title: 'Redis is unhealthy',
      detail: diagnostics.redis.error || `Status: ${diagnostics.redis.status}`,
      target: 'infrastructure',
    });
  }
  if (overview.globalNotification) {
    attention.push({
      id: 'broadcast',
      tone: 'info',
      icon: Bell,
      title: 'A global broadcast is active',
      detail: overview.globalNotification.message,
      target: 'live-ops',
    });
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={LayoutDashboard}
        title="Overview"
        description={`Sampled system status — generated ${formatDateTime(overview.generatedAt)}.`}
        actions={
          <Badge variant={overview.status === 'ok' ? 'success' : 'warning'}>
            {overview.status === 'ok' ? 'Healthy' : 'Degraded'}
          </Badge>
        }
      />

      {/* Activity */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <Stat label="Connected Clients" value={formatNumber(totals.totalConnectedClients)} icon={Users} tone="primary" />
        <Stat label="Players In Game" value={formatNumber(totals.playersInGame)} icon={Swords} />
        <Stat label="Bots In Game" value={formatNumber(totals.botsInGame)} icon={Bot} />
        <Stat label="Participants" value={formatNumber(totals.participantsInGame)} icon={Activity} />
        <Stat label="Game Rooms" value={formatNumber(totals.gameRooms)} icon={Swords} />
        <Stat label="Lobby Rooms" value={formatNumber(totals.lobbyRooms)} icon={Radio} />
        <Stat label="Lobby Participants" value={formatNumber(totals.lobbyParticipants)} icon={Users} />
        <Stat
          label="Machines / Procs"
          value={`${formatNumber(totals.runningMachines)} / ${formatNumber(totals.serverProcesses)}`}
          icon={Cpu}
          tone="secondary"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Capacity */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Capacity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pressure != null ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-white/45">Pressure</span>
                  <span
                    className={cn(
                      'font-mono',
                      pressure >= 0.85 ? 'text-ui-danger' : pressure >= 0.6 ? 'text-ui-warning' : 'text-ui-success'
                    )}
                  >
                    {formatPercent(pressure, 0)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      pressure >= 0.85 ? 'bg-ui-danger' : pressure >= 0.6 ? 'bg-ui-warning' : 'bg-ui-success'
                    )}
                    style={{ width: `${Math.min(100, Math.max(2, pressure * 100))}%` }}
                  />
                </div>
              </div>
            ) : null}
            <div className="divide-y divide-strike-border">
              <KeyValue label="Reserved Players" value={formatNumber(capacity.reservedPlayers)} />
              <KeyValue label="Maximum Players" value={formatNumber(capacity.maxPlayers)} />
              <KeyValue label="Available Slots" value={formatNumber(capacity.availablePlayers)} />
              <KeyValue label="Projected Machines" value={formatNumber(capacity.projectedMachineCount)} />
              <KeyValue
                label="Status"
                value={
                  <Badge variant={capacity.full ? 'danger' : 'success'}>
                    {capacity.full ? 'Full' : 'Has Headroom'}
                  </Badge>
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Attention */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Needs Attention</CardTitle>
          </CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="All clear"
                description="No capacity, report, reward, or infrastructure items need attention right now."
              />
            ) : (
              <div className="space-y-2">
                {attention.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.target)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors',
                      item.tone === 'danger' && 'border-ui-danger/25 bg-ui-danger/[0.06] hover:bg-ui-danger/[0.1]',
                      item.tone === 'warning' && 'border-ui-warning/25 bg-ui-warning/[0.06] hover:bg-ui-warning/[0.1]',
                      item.tone === 'info' && 'border-accent-secondary/25 bg-accent-secondary/[0.06] hover:bg-accent-secondary/[0.1]'
                    )}
                  >
                    <item.icon
                      className={cn(
                        'h-5 w-5 shrink-0',
                        item.tone === 'danger' && 'text-ui-danger',
                        item.tone === 'warning' && 'text-ui-warning',
                        item.tone === 'info' && 'text-accent-secondary'
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-white">{item.title}</div>
                      <div className="truncate text-xs text-white/45">{item.detail}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
