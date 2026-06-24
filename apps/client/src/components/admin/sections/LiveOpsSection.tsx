import {
  formatCompactIdentifier,
  formatDate,
  formatRankedEntryGateMode,
  formatSeasonBoundary,
  getRankedSeasonIdentity,
  isPositiveWholeNumberString,
} from '../format';
import { Button, Field, Panel, Pill, Segmented } from '../primitives';
import type { AdminConsoleController } from '../useAdminConsole';
import type {
  AdminOverview,
  RankedEntryGateMode,
  RankedSeasonMode,
} from '../types';

export function LiveOpsSection({ ctrl, overview }: { ctrl: AdminConsoleController; overview: AdminOverview }) {
  return (
    <div className="space-y-4">
      <GlobalNotification ctrl={ctrl} overview={overview} />
      <RankedEntryGate ctrl={ctrl} overview={overview} />
      <RankedSeason ctrl={ctrl} overview={overview} />
    </div>
  );
}

function GlobalNotification({ ctrl, overview }: { ctrl: AdminConsoleController; overview: AdminOverview }) {
  const notification = overview.globalNotification;
  const draft = ctrl.globalNotificationDraft;
  const trimmed = draft.trim();

  return (
    <Panel title="Global notification" meta={notification ? 'active' : 'off'}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.38fr)]">
        <div className="min-w-0">
          <Field label="Broadcast message" hint={`${trimmed.length} / 240`}>
            <textarea
              className="ac-textarea min-h-[72px]"
              value={draft}
              maxLength={240}
              disabled={ctrl.busyGlobalNotification}
              placeholder="Maintenance starts in 10 minutes."
              onChange={(event) => ctrl.setGlobalNotificationDraft(event.target.value)}
            />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" disabled={!trimmed || ctrl.busyGlobalNotification} onClick={ctrl.saveGlobalNotification}>
              {ctrl.busyGlobalNotification ? 'Saving…' : 'Set message'}
            </Button>
            <Button variant="danger" disabled={!notification || ctrl.busyGlobalNotification} onClick={ctrl.removeGlobalNotification}>
              Remove
            </Button>
          </div>
        </div>

        <div className="rounded-[11px] border border-[color:var(--ac-border)] bg-[color:var(--ac-surface-3)] p-3.5">
          <div className="ac-subhead">Currently live</div>
          {notification ? (
            <>
              <div className="mt-2"><Pill tone="warning" withDot>Active</Pill></div>
              <p className="mt-2.5 break-words text-[13px] leading-relaxed">{notification.message}</p>
              <div className="ac-text-faint mt-2.5 text-[11px]">Updated {formatDate(notification.updatedAt)}</div>
            </>
          ) : (
            <>
              <div className="mt-2"><Pill>Off</Pill></div>
              <p className="ac-text-faint mt-2.5 text-[13px]">No active message.</p>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

function RankedEntryGate({ ctrl, overview }: { ctrl: AdminConsoleController; overview: AdminOverview }) {
  const gate = overview.rankedEntryGate;
  const draft = ctrl.rankedEntryGateDraft;
  const tokenMint = draft.tokenMintAddress.trim();
  const tokenSymbol = draft.tokenSymbol.trim().replace(/^\$/, '').toUpperCase();
  const requiredTokenAmount = draft.requiredTokenAmount.trim();
  const tokenRequired = draft.mode === 'token_required';
  const draftValid = !tokenRequired
    || (tokenMint.length > 0 && /^[A-Z0-9]{1,12}$/.test(tokenSymbol) && isPositiveWholeNumberString(requiredTokenAmount));
  const canSave = !ctrl.busyRankedEntryGate && draftValid;

  return (
    <Panel title="Ranked entry gate" meta={formatRankedEntryGateMode(gate.mode)}>
      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,0.34fr)_minmax(0,1fr)]">
        <div className="rounded-[11px] border border-[color:var(--ac-border)] bg-[color:var(--ac-surface-3)] p-3.5">
          <div className="ac-subhead">Current gate</div>
          <div className="mt-2"><Pill tone={gate.mode === 'token_required' ? 'success' : 'warning'}>{formatRankedEntryGateMode(gate.mode)}</Pill></div>
          <div className="ac-mono ac-text-muted mt-3 break-all text-[11px]">
            {gate.tokenMintAddress ? formatCompactIdentifier(gate.tokenMintAddress, 6, 6) : 'No token mint'}
          </div>
          <div className="ac-text-faint mt-2 text-[11px]">{gate.requiredTokenAmount} {gate.tokenSymbol} required</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone={gate.rpcConfigured ? 'success' : 'warning'}>{gate.rpcConfigured ? 'RPC ready' : 'RPC missing'}</Pill>
            <Pill>{gate.cluster}</Pill>
          </div>
        </div>

        <div className="min-w-0">
          <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)_minmax(6rem,0.25fr)_minmax(8rem,0.4fr)]">
            <Field label="Mode">
              <Segmented<RankedEntryGateMode>
                value={draft.mode}
                disabled={ctrl.busyRankedEntryGate}
                tone="amber"
                options={[{ value: 'locked', label: 'Locked' }, { value: 'token_required', label: 'Token' }]}
                onChange={(mode) => ctrl.updateRankedEntryGateDraft({ ...draft, mode })}
              />
            </Field>
            <Field label="Mint address">
              <input
                className="ac-input ac-mono"
                value={draft.tokenMintAddress}
                disabled={ctrl.busyRankedEntryGate}
                placeholder="SPL mint address"
                onChange={(event) => ctrl.updateRankedEntryGateDraft({ ...draft, tokenMintAddress: event.target.value })}
              />
            </Field>
            <Field label="Symbol">
              <input
                className="ac-input"
                value={draft.tokenSymbol}
                maxLength={12}
                disabled={ctrl.busyRankedEntryGate}
                onChange={(event) => ctrl.updateRankedEntryGateDraft({ ...draft, tokenSymbol: event.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="Tokens required">
              <input
                className="ac-input ac-mono"
                inputMode="numeric"
                value={draft.requiredTokenAmount}
                disabled={ctrl.busyRankedEntryGate}
                onChange={(event) => ctrl.updateRankedEntryGateDraft({ ...draft, requiredTokenAmount: event.target.value.replace(/\D/g, '') })}
              />
            </Field>
          </div>

          <div className={`ac-alert mt-3 ${tokenRequired ? (draftValid ? 'ac-text-success' : 'ac-alert--warning') : ''}`}>
            {tokenRequired
              ? draftValid
                ? 'Ranked will require the configured whole-token amount.'
                : 'Token mode needs a mint address, symbol, and positive whole-token amount.'
              : 'Ranked entry is locked until token mode is enabled.'}
          </div>

          <div className="mt-3">
            <Button variant="primary" disabled={!canSave} onClick={ctrl.saveRankedEntryGate}>
              {ctrl.busyRankedEntryGate ? 'Saving…' : 'Save gate'}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function RankedSeason({ ctrl, overview }: { ctrl: AdminConsoleController; overview: AdminOverview }) {
  const season = overview.rankedSeason;
  const draft = ctrl.rankedSeasonDraft;
  const nextSeasonNumber = Number(draft.seasonNumber);
  const invalidSeasonNumber = !Number.isFinite(nextSeasonNumber) || nextSeasonNumber < 1 || nextSeasonNumber > 999;
  const willReset = getRankedSeasonIdentity(season.mode, season.seasonNumber) !== getRankedSeasonIdentity(draft.mode, nextSeasonNumber);
  const boundaryLabel = draft.mode === 'preseason' ? 'Next season begins at' : 'Ends at';

  return (
    <Panel title="Ranked season" meta={season.label}>
      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,0.34fr)_minmax(0,1fr)]">
        <div className="rounded-[11px] border border-[color:var(--ac-border)] bg-[color:var(--ac-surface-3)] p-3.5">
          <div className="ac-subhead">Current cycle</div>
          <div className="mt-2 text-2xl font-semibold leading-none">{season.label}</div>
          <div className="mt-2.5"><Pill>{formatSeasonBoundary(season.mode, season.endsAt)}</Pill></div>
          <div className="ac-text-faint mt-2.5 text-[11px]">
            Last reset {season.lastResetAt ? formatDate(season.lastResetAt) : 'not recorded'}
          </div>
        </div>

        <div className="min-w-0">
          <div className="grid gap-3 md:grid-cols-[auto_minmax(6rem,0.3fr)_minmax(0,1fr)]">
            <Field label="Mode">
              <Segmented<RankedSeasonMode>
                value={draft.mode}
                disabled={ctrl.busyRankedSeason}
                options={[{ value: 'season', label: 'Season' }, { value: 'preseason', label: 'Pre-season' }]}
                onChange={(mode) => ctrl.updateRankedSeasonDraft({ ...draft, mode })}
              />
            </Field>
            <Field label="Number">
              <input
                className="ac-input"
                type="number"
                min={1}
                max={999}
                value={draft.seasonNumber}
                disabled={ctrl.busyRankedSeason || draft.mode === 'preseason'}
                onChange={(event) => ctrl.updateRankedSeasonDraft({ ...draft, seasonNumber: event.target.value })}
              />
            </Field>
            <Field label={boundaryLabel}>
              <input
                className="ac-input"
                type="datetime-local"
                value={draft.endsAtLocal}
                disabled={ctrl.busyRankedSeason}
                onChange={(event) => ctrl.updateRankedSeasonDraft({ ...draft, endsAtLocal: event.target.value })}
              />
            </Field>
          </div>

          <div className={`ac-alert mt-3 ${willReset ? 'ac-alert--warning' : ''}`}>
            {willReset
              ? 'Changing this season will archive the current season and reset player ratings to ranked defaults.'
              : 'Schedule edits keep ranked stats intact.'}
          </div>

          <div className="mt-3">
            <Button
              variant="primary"
              disabled={ctrl.busyRankedSeason || (draft.mode === 'season' && invalidSeasonNumber)}
              onClick={ctrl.saveRankedSeason}
            >
              {ctrl.busyRankedSeason ? 'Saving…' : 'Save season'}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
