import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Coins,
  LayoutDashboard,
  Radio,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Target,
  Users,
  X,
} from 'lucide-react';
import { cn } from './lib/utils';
import { useAdminConsole } from './useAdminConsole';
import type { SectionId } from './types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { TooltipProvider } from './ui/tooltip';
import { StatusDot } from './common';
import { formatRelativeTime, truncateAddress } from './format';
import { OverviewSection } from './sections/OverviewSection';
import { LiveOpsSection } from './sections/LiveOpsSection';
import { MissionsSection } from './sections/MissionsSection';
import { PlayersSection } from './sections/PlayersSection';
import { EconomySection } from './sections/EconomySection';
import { InfrastructureSection } from './sections/InfrastructureSection';
import { AntiCheatSection } from './sections/AntiCheatSection';

interface NavItem {
  id: SectionId;
  label: string;
  icon: typeof LayoutDashboard;
}

const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'live-ops', label: 'Live Ops', icon: Radio },
  { id: 'missions', label: 'Missions', icon: Target },
  { id: 'players', label: 'Players', icon: Users },
  { id: 'economy', label: 'Economy', icon: Coins },
  { id: 'infrastructure', label: 'Infrastructure', icon: Server },
  { id: 'anti-cheat', label: 'Anti-Cheat', icon: ShieldAlert },
];

export function AdminConsole() {
  const console = useAdminConsole();
  const [active, setActive] = useState<SectionId>('overview');
  const { overview, loading, refreshing, error, lastUpdatedAt, notices, dismissNotice } = console;

  const badges = useMemo(() => {
    const reports = overview?.playerReports?.reports ?? [];
    const openReports = reports.filter(
      (r) => r.status === 'open' || r.status === 'reviewing'
    ).length;
    const goldenRewards = overview?.goldenBiomeRewards?.rewards ?? [];
    const pendingGolden = goldenRewards.filter(
      (r) => r.status === 'pending' || r.status === 'failed'
    ).length;
    const warnings = overview?.diagnostics?.warnings?.length ?? 0;
    const missionWarnings = (overview?.missions?.summary.failedGrants ?? 0)
      + (overview?.missions?.summary.pendingTokenPayouts ?? 0);
    return {
      players: openReports,
      missions: missionWarnings,
      economy: pendingGolden,
      infrastructure: warnings,
    } as Partial<Record<SectionId, number>>;
  }, [overview]);

  const renderSection = () => {
    const props = { console, navigate: setActive };
    switch (active) {
      case 'overview':
        return <OverviewSection {...props} />;
      case 'live-ops':
        return <LiveOpsSection {...props} />;
      case 'missions':
        return <MissionsSection {...props} />;
      case 'players':
        return <PlayersSection {...props} />;
      case 'economy':
        return <EconomySection {...props} />;
      case 'infrastructure':
        return <InfrastructureSection {...props} />;
      case 'anti-cheat':
        return <AntiCheatSection {...props} />;
      default:
        return null;
    }
  };

  // Full-screen access-denied / fatal error state (no data yet).
  if (!overview && !loading && error) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-strike-bg p-6 font-body text-white">
        <div className="max-w-md rounded-2xl border border-ui-danger/30 bg-strike-panel-raised p-8 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-ui-danger" />
          <h1 className="mt-4 font-display text-2xl tracking-wide">Access unavailable</h1>
          <p className="mt-2 text-sm text-white/55">{error}</p>
          <Button className="mt-6" onClick={() => void console.refresh()}>
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-h-screen bg-strike-bg font-body text-white">
        {/* Sidebar */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-strike-border bg-strike-chrome/80 px-3 py-5 lg:flex">
          <div className="flex items-center gap-2.5 px-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-primary text-strike-bg shadow-glow-orange">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="font-display text-lg tracking-widest text-white">SLOP OPS</div>
              <div className="text-[10px] uppercase tracking-wider text-white/35">Admin Console</div>
            </div>
          </div>

          <nav className="mt-7 flex flex-1 flex-col gap-1">
            {NAV.map((item) => {
              const count = badges[item.id];
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActive(item.id)}
                  className={cn(
                    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent-primary/12 text-accent-primary'
                      : 'text-white/55 hover:bg-white/[0.04] hover:text-white'
                  )}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {count ? (
                    <span
                      className={cn(
                        'min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold',
                        isActive
                          ? 'bg-accent-primary text-strike-bg'
                          : 'bg-ui-danger/20 text-ui-danger'
                      )}
                    >
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <AdminIdentityCard overview={overview} />
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-strike-border bg-strike-bg/85 px-5 py-3 backdrop-blur-md">
            {/* Mobile section pills */}
            <div className="flex items-center gap-1 overflow-x-auto lg:hidden">
              {NAV.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActive(item.id)}
                  className={cn(
                    'flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                    active === item.id
                      ? 'bg-accent-primary/12 text-accent-primary'
                      : 'text-white/50 hover:text-white'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-3">
              <SystemStatusPill status={overview?.status} />
              <div className="hidden items-center gap-1.5 text-xs text-white/40 sm:flex">
                <StatusDot tone={refreshing ? 'info' : 'success'} pulse={refreshing} />
                <span>
                  {lastUpdatedAt ? `Synced ${formatRelativeTime(lastUpdatedAt)}` : 'Syncing…'}
                </span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void console.refresh()}
                disabled={refreshing}
              >
                <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-y-auto px-5 py-6">
            <div className="mx-auto w-full max-w-6xl">
              {loading && !overview ? (
                <LoadingState />
              ) : (
                <div key={active} className="animate-fade-up">{renderSection()}</div>
              )}
            </div>
          </main>
        </div>

        {/* Toasts */}
        <div className="pointer-events-none fixed bottom-5 right-5 z-[2000] flex w-full max-w-sm flex-col gap-2">
          {notices.map((notice) => (
            <div
              key={notice.id}
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-xl animate-slide-in-right',
                notice.type === 'success'
                  ? 'border-ui-success/30 bg-strike-elevated text-white'
                  : 'border-ui-danger/40 bg-strike-elevated text-white'
              )}
            >
              {notice.type === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ui-success" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ui-danger" />
              )}
              <span className="flex-1">{notice.message}</span>
              <button
                type="button"
                className="text-white/40 transition hover:text-white"
                onClick={() => dismissNotice(notice.id)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}

function AdminIdentityCard({ overview }: { overview: ReturnType<typeof useAdminConsole>['overview'] }) {
  const admin = overview?.admin;
  return (
    <div className="mt-4 rounded-lg border border-strike-border bg-strike-panel p-3">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-secondary/15 text-xs font-bold uppercase text-accent-secondary">
          {admin?.name?.slice(0, 2) ?? '—'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">{admin?.name ?? 'Admin'}</div>
          <div className="truncate font-mono text-[10px] text-white/40">
            {truncateAddress(admin?.walletAddress, 6, 6)}
          </div>
        </div>
      </div>
      {admin?.elevatedAntiCheatRole ? (
        <Badge variant="secondary" className="mt-2.5 w-full justify-center">
          <ShieldCheck className="h-3 w-3" /> Anti-Cheat Elevated
        </Badge>
      ) : null}
    </div>
  );
}

function SystemStatusPill({ status }: { status?: 'ok' | 'degraded' }) {
  if (!status) return null;
  const ok = status === 'ok';
  return (
    <Badge variant={ok ? 'success' : 'warning'} className="gap-1.5">
      <span className="relative flex h-1.5 w-1.5">
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
            ok ? 'bg-ui-success' : 'bg-ui-warning'
          )}
        />
        <span
          className={cn(
            'relative inline-flex h-1.5 w-1.5 rounded-full',
            ok ? 'bg-ui-success' : 'bg-ui-warning'
          )}
        />
      </span>
      {ok ? 'Operational' : 'Degraded'}
    </Badge>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-32 text-white/40">
      <RefreshCw className="h-6 w-6 animate-spin text-accent-primary" />
      <span className="text-sm">Loading admin console…</span>
    </div>
  );
}
