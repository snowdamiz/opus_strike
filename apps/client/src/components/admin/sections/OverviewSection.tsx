import {
  formatCount,
  formatDate,
  formatDateAge,
  formatNumber,
  formatRankedEntryGateMode,
  getActiveReportCount,
  getPendingGoldenRewardCount,
  toneForPressure,
} from '../format';
import { Kpi, Panel, Pill } from '../primitives';
import type { AdminOverview, AdminSectionId, Tone } from '../types';

interface AttentionItem {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
  page: AdminSectionId;
  urgent: boolean;
}

function buildAttention(overview: AdminOverview): AttentionItem[] {
  const activeReports = getActiveReportCount(overview);
  const pendingGolden = getPendingGoldenRewardCount(overview);
  const items: AttentionItem[] = [];

  if (overview.capacity.full || overview.capacity.capacityPressure >= 0.7) {
    items.push({
      label: 'Capacity pressure',
      value: `${Math.round(overview.capacity.capacityPressure * 100)}%`,
      detail: `${formatNumber(overview.capacity.availablePlayers)} player slots open across ${formatCount(overview.capacity.machineCount, 'machine')}`,
      tone: overview.capacity.full ? 'danger' : toneForPressure(overview.capacity.capacityPressure),
      page: 'infrastructure',
      urgent: overview.capacity.full,
    });
  }

  if (activeReports > 0) {
    items.push({
      label: 'Player reports waiting',
      value: `${formatNumber(activeReports)} open`,
      detail: 'Open and reviewing reports need a decision',
      tone: 'warning',
      page: 'players',
      urgent: true,
    });
  }

  if (pendingGolden > 0) {
    items.push({
      label: 'Golden rewards pending',
      value: `${formatNumber(pendingGolden)} pending`,
      detail: `${overview.goldenBiomeRewards?.settings.distributionMode ?? 'manual'} distribution mode`,
      tone: 'warning',
      page: 'economy',
      urgent: false,
    });
  }

  if (!overview.diagnostics.redis.ok) {
    items.push({
      label: 'Redis unhealthy',
      value: overview.diagnostics.redis.status,
      detail: overview.diagnostics.redis.error || 'Shared runtime state is degraded',
      tone: 'danger',
      page: 'infrastructure',
      urgent: true,
    });
  }

  if (overview.globalNotification) {
    items.push({
      label: 'Broadcast live',
      value: 'Active',
      detail: overview.globalNotification.message,
      tone: 'info',
      page: 'liveOps',
      urgent: false,
    });
  }

  return items;
}

export function OverviewSection({
  overview,
  onNavigate,
}: {
  overview: AdminOverview;
  onNavigate: (page: AdminSectionId) => void;
}) {
  const activeReports = getActiveReportCount(overview);
  const pendingGolden = getPendingGoldenRewardCount(overview);
  const capacityTone: Tone = overview.capacity.full ? 'danger' : toneForPressure(overview.capacity.capacityPressure);
  const attention = buildAttention(overview);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Kpi
          label="Players in game"
          value={formatNumber(overview.totals.playersInGame)}
          sub={`${formatNumber(overview.totals.botsInGame)} bots · ${formatNumber(overview.totals.totalConnectedClients)} clients`}
          tone="success"
        />
        <Kpi
          label="Active rooms"
          value={formatNumber(overview.totals.gameRooms + overview.totals.lobbyRooms)}
          sub={`${formatCount(overview.totals.gameRooms, 'game')} · ${formatCount(overview.totals.lobbyRooms, 'lobby', 'lobbies')}`}
          tone="info"
        />
        <Kpi
          label="Capacity"
          value={`${Math.round(overview.capacity.capacityPressure * 100)}%`}
          sub={`${formatNumber(overview.capacity.reservedPlayers)} / ${formatNumber(overview.capacity.maxPlayers)} reserved`}
          tone={capacityTone}
          meter={overview.capacity.capacityPressure}
        />
        <Kpi
          label="Machines"
          value={formatNumber(overview.totals.runningMachines)}
          sub={formatCount(overview.totals.serverProcesses, 'process', 'processes')}
          tone="neutral"
        />
        <Kpi
          label="Open reports"
          value={formatNumber(activeReports)}
          sub={`${formatNumber(overview.playerReports?.reports.length ?? 0)} in queue`}
          tone={activeReports > 0 ? 'warning' : 'success'}
        />
        <Kpi
          label="Golden pending"
          value={formatNumber(pendingGolden)}
          sub={overview.goldenBiomeRewards?.settings.distributionMode ?? 'manual'}
          tone={pendingGolden > 0 ? 'warning' : 'success'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.42fr)]">
        <Panel title="Needs attention" meta={attention.length > 0 ? `${attention.length} item${attention.length === 1 ? '' : 's'}` : 'all clear'} bleed>
          {attention.length === 0 ? (
            <div className="ac-empty">Nothing needs attention. Everything is running cleanly.</div>
          ) : (
            <div>
              {attention.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => onNavigate(item.page)}
                  className="ac-row ac-row--btn"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      {item.urgent && <span className="ac-pill__dot" style={{ background: 'var(--ac-danger)' }} />}
                      <span className="truncate text-[13px] font-semibold">{item.label}</span>
                    </span>
                    <span className="ac-text-faint mt-1 block truncate text-[11px]">{item.detail}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Pill tone={item.tone}>{item.value}</Pill>
                    <span className="ac-text-faint text-[11px]">open →</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Runtime" meta={overview.diagnostics.distributed ? 'distributed' : 'single'} bleed>
          <div>
            <Fact label="World activity" value={`${formatNumber(overview.totals.participantsInGame)} live`} detail={`${formatCount(overview.totals.gameRooms, 'game')} / ${formatCount(overview.totals.lobbyRooms, 'lobby', 'lobbies')}`} tone={overview.totals.participantsInGame > 0 ? 'success' : 'neutral'} />
            <Fact label="Ranked" value={overview.rankedSeason.label} detail={formatRankedEntryGateMode(overview.rankedEntryGate.mode)} tone={overview.rankedEntryGate.mode === 'token_required' ? 'success' : 'accent'} />
            <Fact label="Skin shop" value={overview.skinShop.shop.enabled ? 'Online' : 'Locked'} detail={`token ${overview.skinShop.shop.tokenSymbol || 'unset'}`} tone={overview.skinShop.shop.enabled ? 'success' : 'accent'} />
            <Fact label="Redis" value={overview.diagnostics.redis.status} detail={overview.diagnostics.redis.error || 'Shared runtime state'} tone={overview.diagnostics.redis.ok ? 'success' : 'danger'} />
            <Fact label="Last sample" value={formatDateAge(overview.generatedAt)} detail={formatDate(overview.generatedAt)} tone={overview.status === 'ok' ? 'success' : 'warning'} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Fact({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: Tone }) {
  return (
    <div className="ac-row">
      <div className="min-w-0">
        <div className="ac-text-faint text-[10px] font-bold uppercase tracking-wide">{label}</div>
        <div className="ac-text-faint mt-1 truncate text-[11px]">{detail}</div>
      </div>
      <Pill tone={tone}>{value}</Pill>
    </div>
  );
}
