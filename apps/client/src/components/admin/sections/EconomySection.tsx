import type { ReactNode } from 'react';
import {
  formatAge,
  formatBps,
  formatCompactIdentifier,
  formatCount,
  formatDate,
  formatDraftBps,
  formatDraftDuration,
  formatDraftTokenAmount,
  formatDraftTokenProduct,
  formatDraftWhole,
  formatNumber,
  getPendingGoldenRewardCount,
  lamportsToSolDisplay,
  toneForSystemStatus,
} from '../format';
import { Button, EmptyState, Field, Panel, Pill, Segmented, TableScroll, Td, Th, Toggle } from '../primitives';
import type { AdminConsoleController } from '../useAdminConsole';
import type { AdminOverview, GoldenBiomeDistributionMode, RewardEconomyDraft } from '../types';

export function EconomySection({ ctrl, overview }: { ctrl: AdminConsoleController; overview: AdminOverview }) {
  return (
    <div className="space-y-4">
      <RewardEconomy ctrl={ctrl} overview={overview} />
      <SkinShop ctrl={ctrl} overview={overview} />
      <GoldenRewards ctrl={ctrl} overview={overview} />
    </div>
  );
}

function EconField({
  label,
  hint,
  value,
  suffix,
  detail,
  inputMode = 'decimal',
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  suffix?: string;
  detail: string;
  inputMode?: 'decimal' | 'numeric' | 'text';
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} hint={detail}>
      <div className="flex">
        <input
          className="ac-input ac-mono rounded-r-none"
          inputMode={inputMode}
          value={value}
          disabled={disabled}
          aria-label={`${label}. ${hint}`}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix && (
          <span className="ac-text-faint flex shrink-0 items-center rounded-r-[9px] border border-l-0 border-[color:var(--ac-border)] bg-[color:var(--ac-surface-3)] px-2.5 text-[10px] font-semibold uppercase">
            {suffix}
          </span>
        )}
      </div>
    </Field>
  );
}

function EconGroup({ title, summary, action, children }: { title: string; summary: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-4 border-b border-[color:var(--ac-border)] p-4 last:border-b-0 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide">{title}</h3>
        <p className="ac-text-faint mt-2 text-[12px] leading-relaxed">{summary}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function RewardEconomy({ ctrl, overview }: { ctrl: AdminConsoleController; overview: AdminOverview }) {
  const draft = ctrl.rewardEconomyDraft;
  const disabled = ctrl.busyRewardEconomy;
  const set = (patch: Partial<RewardEconomyDraft>) => ctrl.updateRewardEconomyDraft(patch);
  const tokenSuffix = overview.rewardEconomy?.rewardTokenSymbol?.trim().replace(/^\$/, '').toUpperCase() || 'UNITS';
  const updatedAt = overview.rewardEconomy?.playerRewards.updatedAt ?? overview.goldenBiomeRewards?.settings.updatedAt ?? null;

  return (
    <Panel title="Reward economy" meta={ctrl.rewardEconomyDraftDirty ? 'unsaved' : 'live'} bleed>
      <EconGroup
        title="Ranked rewards"
        summary="Token paid out for qualifying ranked matches and objective play."
        action={<Toggle label="Ranked payouts" checked={draft.enabled} disabled={disabled} onChange={(enabled) => set({ enabled })} />}
      >
        <EconField label="Base match payout" hint="Paid once per qualifying ranked match." value={draft.dailyRankedDripLamports} suffix={tokenSuffix} detail={formatDraftTokenAmount(draft.dailyRankedDripLamports, tokenSuffix)} disabled={disabled} onChange={(v) => set({ dailyRankedDripLamports: v })} />
        <EconField label="Daily paid matches" hint="Caps base payouts per player per day." value={draft.dailyRankedDripMaxMatches} suffix="matches" inputMode="numeric" detail={`${formatDraftTokenProduct(draft.dailyRankedDripLamports, draft.dailyRankedDripMaxMatches, tokenSuffix)} max/day`} disabled={disabled} onChange={(v) => set({ dailyRankedDripMaxMatches: v })} />
        <EconField label="Win bonus" hint="Winning objective outcome." value={draft.objectiveWinLamports} suffix={tokenSuffix} detail={formatDraftTokenAmount(draft.objectiveWinLamports, tokenSuffix)} disabled={disabled} onChange={(v) => set({ objectiveWinLamports: v })} />
        <EconField label="Assist bonus" hint="Objective support actions." value={draft.objectiveAssistLamports} suffix={tokenSuffix} detail={formatDraftTokenAmount(draft.objectiveAssistLamports, tokenSuffix)} disabled={disabled} onChange={(v) => set({ objectiveAssistLamports: v })} />
        <EconField label="Flag capture" hint="Primary objective action." value={draft.objectiveFlagCaptureLamports} suffix={tokenSuffix} detail={formatDraftTokenAmount(draft.objectiveFlagCaptureLamports, tokenSuffix)} disabled={disabled} onChange={(v) => set({ objectiveFlagCaptureLamports: v })} />
        <EconField label="Flag return" hint="Defensive objective action." value={draft.objectiveFlagReturnLamports} suffix={tokenSuffix} detail={formatDraftTokenAmount(draft.objectiveFlagReturnLamports, tokenSuffix)} disabled={disabled} onChange={(v) => set({ objectiveFlagReturnLamports: v })} />
      </EconGroup>

      <EconGroup
        title="Weekly & limits"
        summary="Weekly leaderboard pool and the per-match payout guardrails."
        action={<Toggle label="Weekly pool" checked={draft.weeklyEnabled} disabled={disabled} onChange={(weeklyEnabled) => set({ weeklyEnabled })} />}
      >
        <EconField label="Weekly prize pool" hint="Total weekly leaderboard pool." value={draft.weeklyPoolLamports} suffix={tokenSuffix} detail={formatDraftTokenAmount(draft.weeklyPoolLamports, tokenSuffix)} disabled={disabled} onChange={(v) => set({ weeklyPoolLamports: v })} />
        <EconField label="Paid placements" hint="Leaderboard positions sharing the pool." value={draft.weeklyTopPlayers} suffix="top" inputMode="numeric" detail={`Top ${formatDraftWhole(draft.weeklyTopPlayers)}`} disabled={disabled} onChange={(v) => set({ weeklyTopPlayers: v })} />
        <EconField label="Player match cap" hint="Ceiling for one player in one match." value={draft.maxPlayerMatchLamports} suffix={tokenSuffix} detail={formatDraftTokenAmount(draft.maxPlayerMatchLamports, tokenSuffix)} disabled={disabled} onChange={(v) => set({ maxPlayerMatchLamports: v })} />
        <EconField label="Whole match cap" hint="Ceiling for all payouts from one match." value={draft.maxMatchPayoutLamports} suffix={tokenSuffix} detail={formatDraftTokenAmount(draft.maxMatchPayoutLamports, tokenSuffix)} disabled={disabled} onChange={(v) => set({ maxMatchPayoutLamports: v })} />
        <EconField label="Minimum match time" hint="Shorter matches do not qualify." value={draft.minMatchDurationMs} suffix="ms" inputMode="numeric" detail={formatDraftDuration(draft.minMatchDurationMs)} disabled={disabled} onChange={(v) => set({ minMatchDurationMs: v })} />
        <EconField label="Payout batch size" hint="Reward rows per payout worker pass." value={draft.payoutBatchSize} suffix="rows" inputMode="numeric" detail={`${formatDraftWhole(draft.payoutBatchSize)} rows`} disabled={disabled} onChange={(v) => set({ payoutBatchSize: v })} />
        <EconField label="Treasury reserve" hint="Balance kept untouched before payouts." value={draft.treasuryReserveLamports} suffix="lamports" inputMode="numeric" detail={formatDraftTokenAmount(draft.treasuryReserveLamports, 'LAMPORTS')} disabled={disabled} onChange={(v) => set({ treasuryReserveLamports: v })} />
      </EconGroup>

      <EconGroup
        title="Golden maps & wagers"
        summary="Golden map roll, winner SOL payout, and the platform wager fee."
        action={(
          <div className="space-y-3">
            <Toggle label="Golden maps" checked={draft.goldenBiomeEnabled} disabled={disabled} onChange={(goldenBiomeEnabled) => set({ goldenBiomeEnabled })} />
            <div>
              <div className="ac-label mb-2">Distribution</div>
              <Segmented<GoldenBiomeDistributionMode>
                value={draft.goldenBiomeDistributionMode}
                disabled={disabled}
                tone="amber"
                options={[{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Auto' }]}
                onChange={(goldenBiomeDistributionMode) => set({ goldenBiomeDistributionMode })}
              />
            </div>
          </div>
        )}
      >
        <EconField label="Golden map chance" hint="Roll chance for a golden reward match." value={draft.goldenBiomeChanceBps} suffix="bps" inputMode="numeric" detail={formatDraftBps(draft.goldenBiomeChanceBps)} disabled={disabled} onChange={(v) => set({ goldenBiomeChanceBps: v })} />
        <EconField label="Winner SOL payout" hint="SOL each paid winner receives." value={draft.goldenBiomeWinnerRewardSol} suffix="SOL" detail={`${draft.goldenBiomeWinnerRewardSol || '0'} SOL each`} disabled={disabled} onChange={(v) => set({ goldenBiomeWinnerRewardSol: v })} />
        <EconField label="SOL treasury reserve" hint="Minimum SOL before golden payouts run." value={draft.goldenBiomeTreasuryMinSol} suffix="SOL" detail={`${draft.goldenBiomeTreasuryMinSol || '0'} SOL reserve`} disabled={disabled} onChange={(v) => set({ goldenBiomeTreasuryMinSol: v })} />
        <EconField label="Platform wager fee" hint="Percentage kept from wager settlements." value={draft.platformFeeBps} suffix="bps" inputMode="numeric" detail={formatDraftBps(draft.platformFeeBps)} disabled={disabled} onChange={(v) => set({ platformFeeBps: v })} />
      </EconGroup>

      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="ac-text-faint text-[11px]">{updatedAt ? `Updated ${formatDate(updatedAt)}` : 'Using default economy settings'}</div>
        <Button variant="primary" disabled={disabled || !ctrl.rewardEconomyDraftDirty} onClick={ctrl.saveRewardEconomy}>
          {ctrl.busyRewardEconomy ? 'Saving…' : 'Save economy'}
        </Button>
      </div>
    </Panel>
  );
}

function SkinShop({ ctrl, overview }: { ctrl: AdminConsoleController; overview: AdminOverview }) {
  const shop = overview.skinShop;
  const draft = ctrl.skinShopDraft;
  const disabled = ctrl.busySkinShopSettings;

  return (
    <Panel title="Skin shop" meta={shop.shop.enabled ? 'online' : 'locked'}>
      <div className="grid gap-3 rounded-[11px] border border-[color:var(--ac-border)] bg-[color:var(--ac-surface-3)] p-3.5 lg:grid-cols-[auto_minmax(0,1fr)_8rem_8rem_auto] lg:items-end">
        <Field label="Shop">
          <Toggle label={draft.enabled ? 'Enabled' : 'Locked'} checked={draft.enabled} disabled={disabled} onChange={(enabled) => ctrl.updateSkinShopDraft({ ...draft, enabled })} />
        </Field>
        <Field label="Token mint">
          <input className="ac-input ac-mono" value={draft.tokenMintAddress} disabled={disabled} placeholder="SPL mint address" onChange={(event) => ctrl.updateSkinShopDraft({ ...draft, tokenMintAddress: event.target.value })} />
        </Field>
        <Field label="Symbol">
          <input className="ac-input" value={draft.tokenSymbol} maxLength={16} disabled={disabled} onChange={(event) => ctrl.updateSkinShopDraft({ ...draft, tokenSymbol: event.target.value.toUpperCase() })} />
        </Field>
        <Field label="Cluster">
          <input className="ac-input" value={draft.cluster} disabled={disabled} onChange={(event) => ctrl.updateSkinShopDraft({ ...draft, cluster: event.target.value })} />
        </Field>
        <Button variant="primary" disabled={disabled} onClick={ctrl.saveSkinShopSettings}>Save shop</Button>

        <div className="lg:col-span-5 flex flex-wrap gap-2">
          <Pill tone={shop.shop.rpcConfigured ? 'success' : 'warning'}>RPC {shop.shop.rpcConfigured ? 'ready' : 'missing'}</Pill>
          <Pill tone={shop.shop.treasuryWallet ? 'success' : 'warning'}>
            {shop.shop.treasuryWallet ? `Treasury ${formatCompactIdentifier(shop.shop.treasuryWallet, 6, 6)}` : 'Treasury wallet missing'}
          </Pill>
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        {shop.items.map((item) => {
          const itemDraft = ctrl.skinShopItemDrafts[item.settings.skinId] ?? {
            saleEnabled: item.settings.saleEnabled,
            tokenAmountBaseUnits: item.settings.tokenAmountBaseUnits ?? '',
            maxSupply: item.settings.maxSupply?.toString() ?? '',
            expectedPriceVersion: item.settings.priceVersion,
          };
          const busy = ctrl.busySkinShopItemId === item.settings.skinId;
          const canSave = !busy && Boolean(ctrl.skinShopItemDraftDirtyById[item.settings.skinId]);
          const hasCap = item.settings.maxSupply !== null;
          const remaining = item.settings.remainingSupply ?? 0;

          return (
            <article key={item.settings.skinId} className="rounded-[11px] border border-[color:var(--ac-border)] bg-[color:var(--ac-surface-3)] p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold leading-tight">{item.skin.displayName}</h3>
                  <p className="ac-text-faint mt-0.5 text-[11px] uppercase">{item.settings.skinId} · v{item.settings.priceVersion}</p>
                </div>
                <Toggle
                  label={itemDraft.saleEnabled ? 'For sale' : 'Locked'}
                  checked={itemDraft.saleEnabled}
                  disabled={busy}
                  onChange={(saleEnabled) => ctrl.updateSkinShopItemDraft(item.settings.skinId, { ...itemDraft, saleEnabled })}
                />
              </div>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
                <Field label="Base units">
                  <input className="ac-input ac-mono" inputMode="numeric" value={itemDraft.tokenAmountBaseUnits} disabled={busy} onChange={(event) => ctrl.updateSkinShopItemDraft(item.settings.skinId, { ...itemDraft, tokenAmountBaseUnits: event.target.value.replace(/\D/g, '') })} />
                </Field>
                <Field label="Supply cap">
                  <input className="ac-input ac-mono" inputMode="numeric" value={itemDraft.maxSupply} disabled={busy} placeholder="Unlimited" onChange={(event) => ctrl.updateSkinShopItemDraft(item.settings.skinId, { ...itemDraft, maxSupply: event.target.value.replace(/\D/g, '') })} />
                </Field>
                <Button disabled={!canSave} onClick={() => ctrl.saveSkinShopItem(item.settings.skinId)}>Save</Button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Pill>{item.settings.tokenAmountBaseUnits ?? 'no price'} {shop.shop.tokenSymbol}</Pill>
                <Pill tone={!hasCap ? 'neutral' : remaining === 0 ? 'danger' : 'info'}>
                  {hasCap ? `${formatNumber(remaining)} left` : `${formatNumber(item.settings.soldCount)} sold`}
                </Pill>
                {item.settings.reservedCount > 0 && <Pill tone="warning">{formatNumber(item.settings.reservedCount)} reserved</Pill>}
                {item.lastAudit && <span className="ac-text-faint self-center text-[11px]">Updated {formatAge(Date.parse(item.lastAudit.createdAt))}</span>}
              </div>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

function GoldenRewards({ ctrl, overview }: { ctrl: AdminConsoleController; overview: AdminOverview }) {
  const golden = overview.goldenBiomeRewards;
  if (!golden) {
    return <Panel title="Golden rewards" meta="unavailable"><EmptyState label="Golden reward telemetry unavailable." /></Panel>;
  }
  const treasury = golden.treasury;
  const pending = getPendingGoldenRewardCount(overview);

  return (
    <Panel title="Golden rewards" meta={`${formatNumber(pending)} pending`} bleed>
      <div className="grid gap-4 border-b border-[color:var(--ac-border)] p-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
        <div>
          <div className="ac-label mb-2">Distribution</div>
          <Segmented<GoldenBiomeDistributionMode>
            value={golden.settings.distributionMode}
            disabled={ctrl.busyGoldenMode}
            tone="amber"
            options={[{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Auto' }]}
            onChange={ctrl.setGoldenDistributionMode}
          />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ac-subhead">Treasury</span>
            <Pill tone={treasury.eligible ? 'success' : 'warning'}>{treasury.eligible ? 'Eligible' : treasury.reason || 'Not eligible'}</Pill>
          </div>
          <div className="ac-mono ac-text-faint mt-2 break-all text-[11px]">{treasury.treasuryWallet || golden.settings.treasuryWallet || 'No treasury wallet'}</div>
          <div className="ac-text-faint mt-1 text-[11px]">
            {lamportsToSolDisplay(treasury.treasuryBalanceLamports)} SOL balance / {lamportsToSolDisplay(treasury.requiredLamports)} SOL minimum
          </div>
        </div>
        <div className="flex gap-5">
          <div>
            <div className="ac-label">Reward</div>
            <div className="mt-1 text-lg font-semibold">{lamportsToSolDisplay(golden.settings.winnerRewardLamports)} SOL</div>
          </div>
          <div>
            <div className="ac-label">Chance</div>
            <div className="mt-1 text-lg font-semibold">{formatBps(golden.settings.chanceBps)}</div>
          </div>
        </div>
      </div>

      {golden.rewards.length === 0 ? (
        <EmptyState label="No golden biome reward records yet." />
      ) : (
        <TableScroll minWidth={1100}>
          <thead>
            <tr>
              <Th>Match</Th>
              <Th>Status</Th>
              <Th>Team</Th>
              <Th right>Reward</Th>
              <Th>Transfers</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {golden.rewards.map((reward) => {
              const canDistribute = reward.status === 'pending' || reward.status === 'failed';
              return (
                <tr key={reward.id}>
                  <Td mono>
                    <div className="break-all">{reward.matchId}</div>
                    <div className="ac-text-faint mt-1 text-[11px]">seed {reward.mapSeed} · {formatAge(Date.parse(reward.createdAt))}</div>
                    {reward.lastError && <div className="ac-text-danger mt-1.5 text-[11px]">{reward.lastError}</div>}
                  </Td>
                  <Td>
                    <Pill tone={toneForSystemStatus(reward.status)}>{reward.status}</Pill>
                    <div className="ac-text-faint mt-1.5 text-[11px]">{reward.distributionMode}</div>
                  </Td>
                  <Td>
                    <div>{reward.winningTeam}</div>
                    <div className="ac-text-faint mt-1 text-[11px]">{formatCount(reward.paidPlayerCount, 'winner')}</div>
                  </Td>
                  <Td right>
                    {lamportsToSolDisplay(reward.rewardLamports)} SOL
                    <div className="ac-text-faint text-[11px]">{lamportsToSolDisplay(reward.totalRewardLamports)} SOL total</div>
                  </Td>
                  <Td>
                    <div className="space-y-1.5">
                      {reward.transfers.map((transfer) => (
                        <div key={transfer.id} className="min-w-0 border-l border-[color:var(--ac-border)] pl-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="ac-text-muted truncate">{transfer.displayName || transfer.userId}</span>
                            <Pill tone={toneForSystemStatus(transfer.status)}>{transfer.status}</Pill>
                          </div>
                          {transfer.lastError && <div className="ac-text-danger mt-1 text-[11px]">{transfer.lastError}</div>}
                        </div>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <Button size="sm" disabled={!canDistribute || ctrl.busyGoldenRewardId === reward.id} onClick={() => ctrl.distributeGoldenReward(reward)}>Distribute</Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableScroll>
      )}
    </Panel>
  );
}
