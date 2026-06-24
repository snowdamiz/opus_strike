import { useState } from 'react';
import { cx, formatCompactIdentifier, formatDateAge } from './format';
import { Button, EmptyState, Pill, StatusPill } from './primitives';
import { useAdminConsole } from './useAdminConsole';
import type { AdminSectionDef, AdminSectionId } from './types';
import { OverviewSection } from './sections/OverviewSection';
import { LiveOpsSection } from './sections/LiveOpsSection';
import { PlayersSection } from './sections/PlayersSection';
import { EconomySection } from './sections/EconomySection';
import { InfrastructureSection } from './sections/InfrastructureSection';

const SECTIONS: AdminSectionDef[] = [
  { id: 'overview', label: 'Overview', hint: 'Live health & what needs attention' },
  { id: 'liveOps', label: 'Live Ops', hint: 'Broadcasts & ranked access' },
  { id: 'players', label: 'Players', hint: 'Reports & ranked corrections' },
  { id: 'economy', label: 'Economy', hint: 'Rewards, skins & golden maps' },
  { id: 'infrastructure', label: 'Infrastructure', hint: 'Machines, rooms & diagnostics' },
];

function Nav({
  active,
  onChange,
  orientation,
}: {
  active: AdminSectionId;
  onChange: (id: AdminSectionId) => void;
  orientation: 'sidebar' | 'mobile';
}) {
  return (
    <nav
      aria-label="Admin sections"
      className={orientation === 'mobile' ? 'ac-scroll -mx-1 flex gap-2 overflow-x-auto px-1' : 'flex flex-col gap-1.5'}
    >
      {SECTIONS.map((section) => {
        const isActive = section.id === active;
        return (
          <button
            key={section.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onChange(section.id)}
            className={cx(
              'ac-nav-item flex items-center gap-3 rounded-[10px]',
              orientation === 'mobile' ? 'h-10 shrink-0 px-3' : 'px-3 py-2.5',
              isActive && 'is-active',
            )}
          >
            <span className="ac-nav-rail h-6 w-[3px] shrink-0 rounded-full" />
            <span className="min-w-0">
              <span className="block whitespace-nowrap text-[13px] font-semibold leading-none">{section.label}</span>
              {orientation === 'sidebar' && (
                <span className="ac-text-faint mt-1 block truncate text-[11px] leading-none">{section.hint}</span>
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export function AdminConsole() {
  const [active, setActive] = useState<AdminSectionId>('overview');
  const ctrl = useAdminConsole(active);
  const { overview, error, loading } = ctrl;
  const current = SECTIONS.find((section) => section.id === active) ?? SECTIONS[0];

  return (
    <main className="admin-console">
      <div className="grid h-full min-h-0 lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="ac-sidebar hidden min-h-0 flex-col lg:flex">
          <div className="px-5 pt-6 pb-5">
            <div className="ac-brand-kicker text-[10px] font-bold uppercase leading-none">Slop Heroes</div>
            <h1 className="mt-2 text-[22px] font-semibold leading-none">Admin Console</h1>
            <div className="mt-3 flex flex-wrap gap-2">
              {overview ? <StatusPill status={overview.status} /> : <Pill>Loading</Pill>}
              {overview?.admin.elevatedAntiCheatRole && <Pill tone="info">Anti-cheat</Pill>}
            </div>
          </div>

          <div className="ac-scroll min-h-0 flex-1 overflow-y-auto px-3">
            <Nav active={active} onChange={setActive} orientation="sidebar" />
          </div>

          <div className="space-y-3 p-3">
            {overview && (
              <div className="rounded-[11px] border border-[color:var(--ac-border)] bg-[color:var(--ac-surface-3)] p-3">
                <div className="truncate text-xs font-semibold">{overview.admin.name}</div>
                <div className="ac-mono ac-text-faint mt-1 truncate text-[11px]" title={overview.admin.walletAddress}>
                  {formatCompactIdentifier(overview.admin.walletAddress, 6, 6)}
                </div>
                <div className="ac-text-faint mt-2 text-[11px]">Sampled {formatDateAge(overview.generatedAt)}</div>
              </div>
            )}
            <Button className="w-full" onClick={() => void ctrl.loadOverview()}>Refresh</Button>
          </div>
        </aside>

        {/* Main */}
        <section className="flex min-h-0 flex-col">
          <header className="ac-topbar z-20 px-4 py-3.5 md:px-6">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div className="min-w-0">
                <div className="ac-text-faint text-[10px] font-bold uppercase leading-none lg:hidden">Slop Heroes Admin</div>
                <h2 className="text-xl font-semibold leading-tight md:text-2xl">{current.label}</h2>
                <div className="ac-text-faint mt-0.5 text-xs">{current.hint}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {overview && <StatusPill status={overview.status} />}
                <Button onClick={() => void ctrl.loadOverview()}>Refresh</Button>
              </div>
            </div>
            <div className="mt-3 lg:hidden">
              <Nav active={active} onChange={setActive} orientation="mobile" />
            </div>
          </header>

          <div className="ac-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1560px] space-y-4 p-4 md:p-6">
              {error && <div className="ac-alert ac-alert--danger">{error}</div>}

              {overview && overview.diagnostics.warnings.length > 0 && (
                <div className="ac-alert ac-alert--warning space-y-1">
                  {overview.diagnostics.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                </div>
              )}

              {overview ? (
                <>
                  {active === 'overview' && <OverviewSection overview={overview} onNavigate={setActive} />}
                  {active === 'liveOps' && <LiveOpsSection ctrl={ctrl} overview={overview} />}
                  {active === 'players' && <PlayersSection ctrl={ctrl} overview={overview} />}
                  {active === 'economy' && <EconomySection ctrl={ctrl} overview={overview} />}
                  {active === 'infrastructure' && <InfrastructureSection overview={overview} />}
                </>
              ) : (
                <div className="ac-panel"><EmptyState label={loading ? 'Loading admin telemetry…' : 'Telemetry unavailable.'} /></div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default AdminConsole;
