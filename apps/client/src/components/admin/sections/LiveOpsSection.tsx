import { useEffect, useState } from 'react';
import { Coins, Loader2, Megaphone, Radio, ShieldCheck, Sparkles, Trophy } from 'lucide-react';
import type { SectionProps } from '../section';
import type { RankedEntryGateMode, RankedSeasonMode } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Field, KeyValue, SectionHeader } from '../common';
import { formatRelativeTime, truncateAddress } from '../format';
import { cn } from '../lib/utils';

const NOTIFICATION_MAX = 240;

/** Convert an ISO timestamp to a `datetime-local` input value (local time). */
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const date = new Date(ms);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(ms - offsetMs).toISOString().slice(0, 16);
}

/** Convert a `datetime-local` input value back to an ISO string (or null). */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

export function LiveOpsSection({ console }: SectionProps) {
  if (!console.overview) return null;

  const { globalNotification, rankedSeason, rankedEntryGate, gameToken, eventBiome } = console.overview;

  /* ----------------------------- Broadcast -------------------------- */
  const [message, setMessage] = useState('');
  const [broadcastSaving, setBroadcastSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  /* ----------------------------- Event biome ------------------------ */
  const [eventBiomeEnabled, setEventBiomeEnabled] = useState(eventBiome.enabled);
  const [eventBiomeSaving, setEventBiomeSaving] = useState(false);

  /* ----------------------------- Entry gate ------------------------- */
  const [gateMode, setGateMode] = useState<RankedEntryGateMode>(
    rankedEntryGate.mode ?? 'locked'
  );
  const [requiredAmount, setRequiredAmount] = useState(() => {
    const n = Number(rankedEntryGate.requiredTokenAmount);
    return Number.isFinite(n) ? String(n) : '';
  });
  const [gateSaving, setGateSaving] = useState(false);

  /* ----------------------------- Season ----------------------------- */
  const [seasonMode, setSeasonMode] = useState<RankedSeasonMode>(
    rankedSeason.mode ?? 'season'
  );
  const [seasonNumber, setSeasonNumber] = useState(
    rankedSeason.seasonNumber != null ? String(rankedSeason.seasonNumber) : '1'
  );
  const [seasonEndsAt, setSeasonEndsAt] = useState(isoToLocalInput(rankedSeason.endsAt));
  const [seasonSaving, setSeasonSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Re-sync controlled state when the underlying source objects change.
  useEffect(() => {
    setGateMode(rankedEntryGate.mode ?? 'locked');
    const n = Number(rankedEntryGate.requiredTokenAmount);
    setRequiredAmount(Number.isFinite(n) ? String(n) : '');
  }, [rankedEntryGate]);

  useEffect(() => {
    setSeasonMode(rankedSeason.mode ?? 'season');
    setSeasonNumber(rankedSeason.seasonNumber != null ? String(rankedSeason.seasonNumber) : '1');
    setSeasonEndsAt(isoToLocalInput(rankedSeason.endsAt));
  }, [rankedSeason]);

  useEffect(() => {
    setEventBiomeEnabled(eventBiome.enabled);
  }, [eventBiome]);

  async function handleToggleEventBiome(next: boolean) {
    setEventBiomeEnabled(next); // optimistic; refresh re-syncs on completion
    setEventBiomeSaving(true);
    try {
      const result = await console.saveEventBiome({ enabled: next });
      if (!result.ok) setEventBiomeEnabled(!next);
    } finally {
      setEventBiomeSaving(false);
    }
  }

  /* ----------------------------- Handlers --------------------------- */
  const trimmedMessage = message.trim();

  async function handleSetNotification() {
    if (!trimmedMessage) return;
    setBroadcastSaving(true);
    try {
      await console.setGlobalNotification(trimmedMessage);
      setMessage('');
    } finally {
      setBroadcastSaving(false);
    }
  }

  async function handleRemoveNotification() {
    setRemoving(true);
    try {
      await console.removeGlobalNotification();
    } finally {
      setRemoving(false);
    }
  }

  const gameTokenConfigured = gameToken.mintAddress != null;
  const gameTokenTicker = gameToken.symbol || 'tokens';
  const gateAmountNumber = Number(requiredAmount);
  const gateValid =
    gateMode === 'locked' ||
    (gameTokenConfigured &&
      Number.isFinite(gateAmountNumber) &&
      gateAmountNumber > 0);

  async function handleSaveGate() {
    if (!gateValid) return;
    setGateSaving(true);
    try {
      if (gateMode === 'token_required') {
        await console.saveRankedEntryGate({
          mode: 'token_required',
          requiredTokenAmount: Math.floor(gateAmountNumber),
        });
      } else {
        await console.saveRankedEntryGate({ mode: 'locked' });
      }
    } finally {
      setGateSaving(false);
    }
  }

  const seasonNumberNumber = Number(seasonNumber);
  const seasonValid = Number.isFinite(seasonNumberNumber) && seasonNumberNumber > 0;
  const seasonIdentityChanged =
    seasonMode !== (rankedSeason.mode ?? 'season') ||
    seasonNumberNumber !== (rankedSeason.seasonNumber ?? 1);

  async function performSaveSeason() {
    if (!seasonValid) return;
    setSeasonSaving(true);
    try {
      await console.saveRankedSeason({
        mode: seasonMode,
        seasonNumber: Math.floor(seasonNumberNumber),
        endsAt: localInputToIso(seasonEndsAt),
      });
      setConfirmOpen(false);
    } finally {
      setSeasonSaving(false);
    }
  }

  function handleSaveSeasonClick() {
    if (!seasonValid) return;
    if (seasonIdentityChanged) {
      setConfirmOpen(true);
      return;
    }
    void performSaveSeason();
  }

  const rpcConfigured = gameToken.rpcConfigured === true;

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={Radio}
        title="Live Ops"
        description="Broadcast messages, gate ranked entry, and manage the competitive season."
      />

      {/* Game Token (read-only) */}
      <Card
        className={cn(
          !gameTokenConfigured && 'border-ui-warning/30 bg-ui-warning/[0.04]'
        )}
      >
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-accent-primary" />
              Game Token
            </span>
            <Badge variant={rpcConfigured ? 'success' : 'danger'}>
              {rpcConfigured ? 'RPC Ready' : 'RPC Not Configured'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!gameTokenConfigured ? (
            <div className="rounded-lg border border-ui-warning/25 bg-ui-warning/[0.06] px-3.5 py-3 text-sm text-ui-warning">
              No game token is configured. Set GAME_TOKEN_MINT in the server environment to enable
              token-gated features.
            </div>
          ) : null}
          <div className="divide-y divide-strike-border">
            <KeyValue
              label="Mint"
              value={
                gameToken.mintAddress ? (
                  <span className="font-mono text-xs">
                    {truncateAddress(gameToken.mintAddress)}
                  </span>
                ) : (
                  <span className="text-white/40">Not configured</span>
                )
              }
            />
            <KeyValue
              label="Ticker"
              value={
                gameToken.symbol ? (
                  <Badge variant="primary">{gameToken.symbol}</Badge>
                ) : (
                  '—'
                )
              }
            />
            <KeyValue
              label="Cluster"
              value={
                gameToken.cluster ? <Badge variant="secondary">{gameToken.cluster}</Badge> : '—'
              }
            />
            <KeyValue
              label="RPC"
              value={
                <Badge variant={rpcConfigured ? 'success' : 'danger'}>
                  {rpcConfigured ? 'RPC Ready' : 'RPC Not Configured'}
                </Badge>
              }
            />
          </div>
          <p className="text-[11px] text-white/35">
            Configured via server environment (GAME_TOKEN_MINT / GAME_TOKEN_SYMBOL). Every feature
            uses this one token; it can&apos;t be edited here.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Global Broadcast */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-accent-primary" />
              Global Broadcast
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {globalNotification ? (
              <div className="rounded-lg border border-accent-secondary/25 bg-accent-secondary/[0.06] px-3.5 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-accent-secondary">
                      Active broadcast
                    </div>
                    <p className="mt-1 text-sm text-white/85">{globalNotification.message}</p>
                    <p className="mt-1 text-[11px] text-white/40">
                      updated {formatRelativeTime(globalNotification.updatedAt)}
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleRemoveNotification()}
                    disabled={removing}
                  >
                    {removing ? <Loader2 className="animate-spin" /> : null}
                    Remove
                  </Button>
                </div>
              </div>
            ) : null}

            <Field
              label="Message"
              hint="Shown to every connected player until removed."
            >
              <Textarea
                value={message}
                maxLength={NOTIFICATION_MAX}
                placeholder="Servers will restart in 10 minutes for maintenance…"
                onChange={(e) => setMessage(e.target.value)}
              />
            </Field>

            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-white/35">
                {message.length}/{NOTIFICATION_MAX}
              </span>
              <Button
                onClick={() => void handleSetNotification()}
                disabled={broadcastSaving || trimmedMessage.length === 0}
              >
                {broadcastSaving ? <Loader2 className="animate-spin" /> : null}
                Set Notification
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Event Biome */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent-primary" />
              Event Biome
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-strike-border bg-white/[0.02] px-3.5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white/85">Independence Day biome</span>
                  <Badge variant={eventBiomeEnabled ? 'success' : 'secondary'}>
                    {eventBiomeEnabled ? 'Live' : 'Off'}
                  </Badge>
                  {eventBiomeSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />
                  ) : null}
                </div>
                <p className="mt-1 text-[12px] text-white/45">
                  When on, a 4th-of-July dusk-and-fireworks map is guaranteed as one of the three
                  Capture the Flag and Team Deathmatch vote options. Temporary — turn off to end the event.
                </p>
              </div>
              <Switch
                checked={eventBiomeEnabled}
                disabled={eventBiomeSaving}
                onCheckedChange={(v) => void handleToggleEventBiome(v)}
                aria-label="Toggle Independence Day event biome"
              />
            </div>
          </CardContent>
        </Card>

        {/* Ranked Entry Gate */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-accent-primary" />
                Ranked Entry Gate
              </span>
              <Badge variant={rpcConfigured ? 'success' : 'warning'}>
                {rpcConfigured ? 'RPC Ready' : 'RPC Not Configured'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Mode" hint="Require a token balance to queue for ranked.">
              <Select
                value={gateMode}
                onValueChange={(v) => setGateMode(v as RankedEntryGateMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="locked">Locked</SelectItem>
                  <SelectItem value="token_required">Token Required</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {gateMode === 'token_required' ? (
              <Field
                label={`Required amount (${gameTokenTicker})`}
                hint={`Players must hold this many ${gameTokenTicker}.`}
              >
                <Input
                  type="number"
                  min={0}
                  value={requiredAmount}
                  placeholder="100"
                  onChange={(e) => setRequiredAmount(e.target.value)}
                />
              </Field>
            ) : null}

            <div className="flex items-center justify-between gap-4">
              {gateMode === 'token_required' && !gameTokenConfigured ? (
                <span className="text-[11px] text-ui-warning">
                  No game token is configured — set GAME_TOKEN_MINT in the server environment first.
                </span>
              ) : gateMode === 'token_required' && !gateValid ? (
                <span className="text-[11px] text-white/35">
                  Enter a required amount above 0.
                </span>
              ) : (
                <span />
              )}
              <Button
                onClick={() => void handleSaveGate()}
                disabled={gateSaving || !gateValid}
              >
                {gateSaving ? <Loader2 className="animate-spin" /> : null}
                Save Gate
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Ranked Season */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-accent-primary" />
              Ranked Season
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mode">
                <Select
                  value={seasonMode}
                  onValueChange={(v) => setSeasonMode(v as RankedSeasonMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="season">Season</SelectItem>
                    <SelectItem value="preseason">Preseason</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Season Number">
                <Input
                  type="number"
                  min={1}
                  value={seasonNumber}
                  onChange={(e) => setSeasonNumber(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Season Ends At" hint="When the current season boundary lands.">
              <Input
                type="datetime-local"
                value={seasonEndsAt}
                onChange={(e) => setSeasonEndsAt(e.target.value)}
              />
            </Field>

            <div className="flex items-center justify-between gap-4">
              {!seasonValid ? (
                <span className="text-[11px] text-white/35">
                  Season number must be greater than 0.
                </span>
              ) : (
                <span />
              )}
              <Button
                onClick={handleSaveSeasonClick}
                disabled={seasonSaving || !seasonValid}
              >
                {seasonSaving ? <Loader2 className="animate-spin" /> : null}
                Save Season
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive current season?</DialogTitle>
            <DialogDescription>
              Changing the ranked season identity will archive the current season and reset all
              player ratings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={seasonSaving}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void performSaveSeason()}
              disabled={seasonSaving}
            >
              {seasonSaving ? <Loader2 className="animate-spin" /> : null}
              Archive &amp; Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
