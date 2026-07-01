import * as React from 'react';
import { Coins, Gift, Loader2, Send, ShoppingBag, Sparkles } from 'lucide-react';
import type { HeroSkinRarity } from '@voxel-strike/shared';
import type { SectionProps } from '../section';
import type {
  PlayerRewardSettings,
  GoldenBiomeSettings,
  GoldenDistributionMode,
  GoldenRewardStatus,
  GoldenReward,
  SkinShopItem,
} from '../types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Separator } from '../ui/separator';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../ui/table';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../ui/select';
import { EmptyState, SectionHeader } from '../common';
import { cn } from '../lib/utils';
import {
  formatSol,
  formatNumber,
  formatBps,
  formatRelativeTime,
  truncateAddress,
  lamportsToSol,
  solToLamports,
  titleCase,
} from '../format';
import { SkinRarityChrome } from '../../ui/SkinRarityChrome';

const AdminHeroPreviewCanvas = React.lazy(() => import('../../ui/HeroPreviewCanvas').then((module) => ({
  default: module.HeroPreviewCanvas,
})));

/* ----------------------------- NumberField -------------------------- */

function NumberField({
  label,
  value,
  onChange,
  hint,
  placeholder,
  disabled,
  step,
  min,
  className,
}: {
  label: React.ReactNode;
  value: string;
  onChange: (next: string) => void;
  hint?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  step?: string;
  min?: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label>{label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        value={value}
        step={step}
        min={min}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <p className="text-[11px] text-white/35">{hint}</p> : null}
    </div>
  );
}

/* ----------------------------- SaveButton --------------------------- */

function SaveButton({
  saving,
  disabled,
  onClick,
  children,
}: {
  saving: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button type="button" onClick={onClick} disabled={saving || disabled}>
      {saving ? <Loader2 className="animate-spin" /> : null}
      {children}
    </Button>
  );
}

/* helpers: amounts arrive as strings (serialized BigInt) or numbers */
function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function str(value: string | number | null | undefined): string {
  return value == null ? '' : String(value);
}
function positiveIntegerText(value: string): boolean {
  const normalized = value.trim();
  if (!/^[0-9]+$/.test(normalized)) return false;
  try {
    return BigInt(normalized) > 0n;
  } catch {
    return false;
  }
}

/* ----------------------------- Rewards Tab -------------------------- */

interface RewardsForm {
  enabled: boolean;
  dailyRankedDripLamports: string;
  dailyRankedDripMaxMatches: string;
  minMatchDurationMs: string;
  objectiveWinLamports: string;
  objectiveFlagCaptureLamports: string;
  objectiveFlagReturnLamports: string;
  objectiveAssistLamports: string;
  maxPlayerMatchLamports: string;
  maxMatchPayoutLamports: string;
  treasuryReserveLamports: string;
  payoutBatchSize: string;
  platformFeeBps: string;
}

function buildRewardsForm(
  rewards: PlayerRewardSettings,
  platformFeeBps: number
): RewardsForm {
  return {
    enabled: rewards.enabled,
    dailyRankedDripLamports: str(rewards.dailyRankedDripLamports),
    dailyRankedDripMaxMatches: str(rewards.dailyRankedDripMaxMatches),
    minMatchDurationMs: str(rewards.minMatchDurationMs),
    objectiveWinLamports: str(rewards.objectiveWinLamports),
    objectiveFlagCaptureLamports: str(rewards.objectiveFlagCaptureLamports),
    objectiveFlagReturnLamports: str(rewards.objectiveFlagReturnLamports),
    objectiveAssistLamports: str(rewards.objectiveAssistLamports),
    maxPlayerMatchLamports: str(rewards.maxPlayerMatchLamports),
    maxMatchPayoutLamports: str(rewards.maxMatchPayoutLamports),
    treasuryReserveLamports: str(rewards.treasuryReserveLamports),
    payoutBatchSize: str(rewards.payoutBatchSize),
    platformFeeBps: str(platformFeeBps),
  };
}

function RewardsTab({ console: c }: { console: SectionProps['console'] }) {
  const overview = c.overview;
  const economy = overview?.rewardEconomy;
  const rankedSeason = overview?.rankedSeason;
  const tokenSymbol = economy?.rewardTokenSymbol ?? null;
  const tokenLabel = tokenSymbol ? ` (${tokenSymbol})` : '';

  const [form, setForm] = React.useState<RewardsForm>(() =>
    buildRewardsForm(
      economy?.playerRewards ?? ({} as PlayerRewardSettings),
      economy?.wagers?.platformFeeBps ?? 0
    )
  );
  const [saving, setSaving] = React.useState(false);
  const [settlingSeasonTopTen, setSettlingSeasonTopTen] = React.useState(false);
  const [seasonTopTenAmount, setSeasonTopTenAmount] = React.useState('');
  const [seasonTopTenNumber, setSeasonTopTenNumber] = React.useState(
    rankedSeason?.seasonNumber != null ? String(rankedSeason.seasonNumber) : '1'
  );

  React.useEffect(() => {
    if (!economy) return;
    setForm(buildRewardsForm(economy.playerRewards, economy.wagers?.platformFeeBps ?? 0));
  }, [economy?.playerRewards, economy?.wagers]);

  React.useEffect(() => {
    if (rankedSeason?.seasonNumber != null) {
      setSeasonTopTenNumber(String(rankedSeason.seasonNumber));
    }
  }, [rankedSeason?.seasonNumber]);

  const set = <K extends keyof RewardsForm>(key: K, value: RewardsForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  if (!economy) return null;

  const onSave = async () => {
    setSaving(true);
    try {
      await c.saveRewardEconomy({
        playerRewards: {
          enabled: form.enabled,
          dailyRankedDripLamports: num(form.dailyRankedDripLamports),
          dailyRankedDripMaxMatches: num(form.dailyRankedDripMaxMatches),
          minMatchDurationMs: num(form.minMatchDurationMs),
          objectiveWinLamports: num(form.objectiveWinLamports),
          objectiveFlagCaptureLamports: num(form.objectiveFlagCaptureLamports),
          objectiveFlagReturnLamports: num(form.objectiveFlagReturnLamports),
          objectiveAssistLamports: num(form.objectiveAssistLamports),
          maxPlayerMatchLamports: num(form.maxPlayerMatchLamports),
          maxMatchPayoutLamports: num(form.maxMatchPayoutLamports),
          treasuryReserveLamports: num(form.treasuryReserveLamports),
          payoutBatchSize: num(form.payoutBatchSize),
        },
        wagers: { platformFeeBps: num(form.platformFeeBps) },
      });
    } finally {
      setSaving(false);
    }
  };

  const onSettleSeasonTopTen = async () => {
    if (!rankedSeason) return;
    setSettlingSeasonTopTen(true);
    try {
      await c.settleSeasonTopTenPayout({
        mode: rankedSeason.mode,
        seasonNumber: Math.max(1, Math.floor(num(seasonTopTenNumber))),
        amountLamports: seasonTopTenAmount.trim(),
      });
    } finally {
      setSettlingSeasonTopTen(false);
    }
  };

  const unitHint = tokenSymbol
    ? `Integer ${tokenSymbol} base units.`
    : 'Integer token base units.';
  const seasonTopTenSeasonNumber = num(seasonTopTenNumber);
  const canSettleSeasonTopTen = Boolean(
    rankedSeason
    && positiveIntegerText(seasonTopTenAmount)
    && Number.isInteger(seasonTopTenSeasonNumber)
    && seasonTopTenSeasonNumber > 0
  );

  return (
    <div className="space-y-6">
      {/* Ranked Token Payouts */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>Ranked Token Payouts</CardTitle>
              <CardDescription>
                Per-match token drips for ranked play.
                {tokenSymbol ? (
                  <>
                    {' '}
                    Reward token: <span className="text-white/70">{tokenSymbol}</span>.
                  </>
                ) : null}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {tokenSymbol ? <Badge variant="secondary">{tokenSymbol}</Badge> : null}
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => set('enabled', v)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <NumberField
              label={`Base Match Payout${tokenLabel}`}
              value={form.dailyRankedDripLamports}
              onChange={(v) => set('dailyRankedDripLamports', v)}
              hint={unitHint}
            />
            <NumberField
              label="Daily Paid Matches"
              value={form.dailyRankedDripMaxMatches}
              onChange={(v) => set('dailyRankedDripMaxMatches', v)}
              hint="Max paid matches per day."
            />
            <NumberField
              label={`Win Bonus${tokenLabel}`}
              value={form.objectiveWinLamports}
              onChange={(v) => set('objectiveWinLamports', v)}
              hint={unitHint}
            />
            <NumberField
              label={`Assist Bonus${tokenLabel}`}
              value={form.objectiveAssistLamports}
              onChange={(v) => set('objectiveAssistLamports', v)}
              hint={unitHint}
            />
            <NumberField
              label={`Flag Capture Bonus${tokenLabel}`}
              value={form.objectiveFlagCaptureLamports}
              onChange={(v) => set('objectiveFlagCaptureLamports', v)}
              hint={unitHint}
            />
            <NumberField
              label={`Flag Return Bonus${tokenLabel}`}
              value={form.objectiveFlagReturnLamports}
              onChange={(v) => set('objectiveFlagReturnLamports', v)}
              hint={unitHint}
            />
          </div>

          <Separator />

          {/* Guardrails */}
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/50">
              Guardrails
            </h4>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <NumberField
                label={`Per-Player Match Cap${tokenLabel}`}
                value={form.maxPlayerMatchLamports}
                onChange={(v) => set('maxPlayerMatchLamports', v)}
                hint={unitHint}
              />
              <NumberField
                label={`Whole-Match Cap${tokenLabel}`}
                value={form.maxMatchPayoutLamports}
                onChange={(v) => set('maxMatchPayoutLamports', v)}
                hint={unitHint}
              />
              <NumberField
                label="Min Match Duration (ms)"
                value={form.minMatchDurationMs}
                onChange={(v) => set('minMatchDurationMs', v)}
                hint="Matches shorter than this pay nothing."
              />
              <NumberField
                label="Payout Batch Size"
                value={form.payoutBatchSize}
                onChange={(v) => set('payoutBatchSize', v)}
                hint="Transfers per batch."
              />
              <NumberField
                label={`Treasury Reserve${tokenLabel}`}
                value={form.treasuryReserveLamports}
                onChange={(v) => set('treasuryReserveLamports', v)}
                hint={unitHint}
              />
            </div>
          </div>

          <Separator />

          {/* Season Top 10 */}
          <div>
            <div className="mb-3 flex items-center justify-between gap-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Season Top 10
              </h4>
              {rankedSeason ? <Badge variant="secondary">{rankedSeason.label}</Badge> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <NumberField
                label={`Per-Player Payout${tokenLabel}`}
                value={seasonTopTenAmount}
                onChange={setSeasonTopTenAmount}
                hint={unitHint}
              />
              <NumberField
                label="Season Number"
                value={seasonTopTenNumber}
                onChange={setSeasonTopTenNumber}
                hint="Pays the ranked top 10 for this season."
              />
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onSettleSeasonTopTen}
                  disabled={settlingSeasonTopTen || !canSettleSeasonTopTen}
                  className="w-full"
                >
                  {settlingSeasonTopTen ? <Loader2 className="animate-spin" /> : <Send />}
                  Create Payouts
                </Button>
              </div>
            </div>
          </div>

          <Separator />

          {/* Wager */}
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/50">
              Wager
            </h4>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <NumberField
                label="Platform Fee (bps)"
                value={form.platformFeeBps}
                onChange={(v) => set('platformFeeBps', v)}
                hint={`Equivalent to ${formatBps(num(form.platformFeeBps))}.`}
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <SaveButton saving={saving} onClick={onSave}>
              Save Rewards
            </SaveButton>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ----------------------------- Golden Biome Tab --------------------- */

interface GoldenForm {
  enabled: boolean;
  chanceBps: string;
  winnerRewardSol: string;
  treasuryMinSol: string;
  distributionMode: GoldenDistributionMode;
}

function buildGoldenForm(golden: GoldenBiomeSettings): GoldenForm {
  return {
    enabled: golden.enabled,
    chanceBps: str(golden.chanceBps),
    winnerRewardSol: str(lamportsToSol(golden.winnerRewardLamports)),
    treasuryMinSol: str(lamportsToSol(golden.treasuryMinLamports)),
    distributionMode: golden.distributionMode,
  };
}

function statusBadgeVariant(
  status: GoldenRewardStatus | undefined
): React.ComponentProps<typeof Badge>['variant'] {
  switch (status) {
    case 'complete':
      return 'success';
    case 'pending':
      return 'warning';
    case 'processing':
      return 'info';
    case 'failed':
      return 'danger';
    default:
      return 'default';
  }
}

function GoldenRewardRow({
  reward,
  console: c,
}: {
  reward: GoldenReward;
  console: SectionProps['console'];
}) {
  const [saving, setSaving] = React.useState(false);
  const onDistribute = async () => {
    setSaving(true);
    try {
      await c.distributeGoldenReward(reward.id);
    } finally {
      setSaving(false);
    }
  };
  const target = reward.mapThemeId || reward.matchId;
  const signature = reward.transfers?.[0]?.signature ?? null;
  const actionable = reward.status === 'pending' || reward.status === 'failed';
  return (
    <TableRow>
      <TableCell className="font-mono text-xs text-white/70">
        {target ? truncateAddress(target, 6, 6) : '—'}
      </TableCell>
      <TableCell>{formatNumber(reward.paidPlayerCount)}</TableCell>
      <TableCell className="text-white/85">{formatSol(reward.rewardLamports)}</TableCell>
      <TableCell>
        <Badge variant={statusBadgeVariant(reward.status)}>
          {titleCase(reward.status ?? 'unknown')}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-xs text-white/60">
        {truncateAddress(signature)}
      </TableCell>
      <TableCell className="max-w-[16rem] truncate text-xs text-ui-danger">
        {reward.lastError ? reward.lastError : '—'}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-white/45">
        {formatRelativeTime(reward.createdAt)}
      </TableCell>
      <TableCell className="text-right">
        {actionable ? (
          <Button size="sm" variant="secondary" onClick={onDistribute} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Send />}
            Distribute
          </Button>
        ) : (
          <span className="text-xs text-white/30">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function GoldenTab({ console: c }: { console: SectionProps['console'] }) {
  const goldenOverview = c.overview?.goldenBiomeRewards;
  const golden = goldenOverview?.settings;
  const treasury = goldenOverview?.treasury;
  const rewards = goldenOverview?.rewards ?? [];

  const [form, setForm] = React.useState<GoldenForm>(() =>
    buildGoldenForm(golden ?? ({} as GoldenBiomeSettings))
  );
  const [saving, setSaving] = React.useState(false);
  const [modeSaving, setModeSaving] = React.useState(false);

  React.useEffect(() => {
    if (!golden) return;
    setForm(buildGoldenForm(golden));
  }, [golden]);

  const set = <K extends keyof GoldenForm>(key: K, value: GoldenForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  if (!golden) return null;

  const onSave = async () => {
    setSaving(true);
    try {
      await c.saveRewardEconomy({
        goldenBiome: {
          enabled: form.enabled,
          chanceBps: num(form.chanceBps),
          winnerRewardLamports: solToLamports(num(form.winnerRewardSol)),
          treasuryMinLamports: solToLamports(num(form.treasuryMinSol)),
          distributionMode: form.distributionMode,
        },
      });
    } finally {
      setSaving(false);
    }
  };

  const onModeChange = async (mode: GoldenDistributionMode) => {
    set('distributionMode', mode);
    setModeSaving(true);
    try {
      await c.setGoldenDistributionMode(mode);
    } finally {
      setModeSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>Golden Biome</CardTitle>
              <CardDescription>
                Rare golden maps award a SOL prize to the winners.
              </CardDescription>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <NumberField
              label="Golden Map Chance (bps)"
              value={form.chanceBps}
              onChange={(v) => set('chanceBps', v)}
              hint={`Roughly ${formatBps(num(form.chanceBps))} of maps.`}
            />
            <NumberField
              label="Winner Payout (SOL)"
              value={form.winnerRewardSol}
              onChange={(v) => set('winnerRewardSol', v)}
              step="0.0001"
              min="0"
              hint="Stored as lamports."
            />
            <NumberField
              label="Treasury Reserve (SOL)"
              value={form.treasuryMinSol}
              onChange={(v) => set('treasuryMinSol', v)}
              step="0.0001"
              min="0"
              hint="Minimum treasury kept on hand."
            />
            <div className="space-y-1.5">
              <Label>Distribution Mode</Label>
              <Select
                value={form.distributionMode}
                onValueChange={(v) => void onModeChange(v as GoldenDistributionMode)}
                disabled={modeSaving}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="auto">Auto</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-white/35">
                {modeSaving ? 'Updating…' : 'Applied immediately.'}
              </p>
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <SaveButton saving={saving} onClick={onSave}>
              Save Golden Settings
            </SaveButton>
          </div>
        </CardContent>
      </Card>

      {/* Reward records */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Golden Reward Records</CardTitle>
              <CardDescription>
                Treasury balance: {formatSol(treasury?.treasuryBalanceLamports)}
              </CardDescription>
            </div>
            {treasury ? (
              <Badge variant={treasury.eligible ? 'success' : 'danger'}>
                Treasury {treasury.eligible ? 'Eligible' : 'Ineligible'}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {rewards.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No golden rewards yet"
              description="Golden biome rewards will appear here as golden maps are played."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Map / Match</TableHead>
                  <TableHead>Paid Players</TableHead>
                  <TableHead>Reward</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Signature</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rewards.map((reward) => (
                  <GoldenRewardRow key={reward.id} reward={reward} console={c} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ----------------------------- Skin Shop Tab ------------------------ */

function SkinShopSettingsCard({ console: c }: { console: SectionProps['console'] }) {
  const shop = c.overview?.skinShop?.shop;
  const gameToken = c.overview?.gameToken;
  const [enabled, setEnabled] = React.useState<boolean>(shop?.enabled ?? false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!shop) return;
    setEnabled(shop.enabled);
  }, [shop]);

  if (!shop) return null;

  const rpcReady = gameToken?.rpcConfigured === true;
  const treasuryReady = shop.treasuryWallet != null;
  const mintPresent = gameToken?.mintAddress != null;
  const canEnable = mintPresent && rpcReady && treasuryReady;

  const onSave = async () => {
    setSaving(true);
    try {
      await c.saveSkinShopSettings({ enabled });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Skin Shop Settings</CardTitle>
            <CardDescription>Game-token skin purchasing.</CardDescription>
          </div>
          <Switch
            checked={enabled}
            disabled={!canEnable && !enabled}
            onCheckedChange={setEnabled}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={rpcReady ? 'success' : 'danger'}>
            SOLANA_RPC_URL {rpcReady ? 'Ready' : 'Missing'}
          </Badge>
          <Badge variant={treasuryReady ? 'success' : 'danger'}>
            WAGER_TREASURY_WALLET {treasuryReady ? 'Ready' : 'Missing'}
          </Badge>
        </div>

        {/* Read-only game token context */}
        <div className="rounded-lg border border-strike-border bg-strike-canvas/40 p-4">
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-white/45">
                Mint
              </div>
              <div className="font-mono text-xs text-white/80">
                {truncateAddress(gameToken?.mintAddress)}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-white/45">
                Ticker
              </div>
              <div className="text-sm text-white/80">{gameToken?.symbol || '—'}</div>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-white/45">
                Cluster
              </div>
              <div className="text-sm text-white/80">{gameToken?.cluster || '—'}</div>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-white/35">
            Skin prices are in the game token, configured via server environment. Every
            feature uses this one token.
          </p>
        </div>

        {!canEnable ? (
          <p className="text-[11px] text-ui-warning">
            Enabling requires a configured game token mint, SOLANA_RPC_URL, and
            WAGER_TREASURY_WALLET.
          </p>
        ) : null}

        <div className="flex justify-end pt-1">
          <SaveButton saving={saving} onClick={onSave}>
            Save Shop Settings
          </SaveButton>
        </div>
      </CardContent>
    </Card>
  );
}

interface SkinItemForm {
  saleEnabled: boolean;
  tokenAmountBaseUnits: string;
  maxSupply: string;
}

function buildSkinItemForm(item: SkinShopItem): SkinItemForm {
  return {
    saleEnabled: item.settings.saleEnabled,
    tokenAmountBaseUnits: str(item.settings.tokenAmountBaseUnits),
    maxSupply: item.settings.maxSupply == null ? '' : str(item.settings.maxSupply),
  };
}

function skinRarityClass(rarity: HeroSkinRarity): string {
  return `is-${rarity}`;
}

function SkinItemModelPreview({ item }: { item: SkinShopItem }) {
  const skin = item.skin;
  const previewRef = React.useRef<HTMLDivElement>(null);
  const [shouldMountPreview, setShouldMountPreview] = React.useState(false);

  React.useEffect(() => {
    const node = previewRef.current;
    if (!node) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setShouldMountPreview(true);
      return undefined;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setShouldMountPreview(true);
        observer.disconnect();
      }
    }, { rootMargin: '240px 0px' });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={previewRef} className={cn('admin-skin-preview-frame', skinRarityClass(skin.rarity))} aria-hidden="true">
      <SkinRarityChrome />
      <div className="skins-preview-button">
        {shouldMountPreview ? (
          <React.Suspense fallback={null}>
            <AdminHeroPreviewCanvas
              heroId={skin.heroId}
              skinId={skin.id}
              size="card"
              interactive={false}
              idleAnimation={false}
              showShadow={false}
              initialYaw={Math.PI - 0.28}
              className="skins-card-preview admin-skin-card-preview"
            />
          </React.Suspense>
        ) : (
          <div className="admin-skin-preview-placeholder" />
        )}
      </div>
    </div>
  );
}

function SkinItemCard({
  item,
  console: c,
}: {
  item: SkinShopItem;
  console: SectionProps['console'];
}) {
  const settings = item.settings;
  const [form, setForm] = React.useState<SkinItemForm>(() => buildSkinItemForm(item));
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setForm(buildSkinItemForm(item));
  }, [item]);

  const set = <K extends keyof SkinItemForm>(key: K, value: SkinItemForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const onSave = async () => {
    setSaving(true);
    try {
      const trimmed = form.maxSupply.trim();
      await c.saveSkinShopItem(settings.skinId, {
        saleEnabled: form.saleEnabled,
        tokenAmountBaseUnits: num(form.tokenAmountBaseUnits),
        maxSupply: trimmed === '' ? null : num(trimmed),
        expectedPriceVersion: settings.priceVersion,
      });
    } finally {
      setSaving(false);
    }
  };

  const skin = item.skin;
  const rarityClass = skinRarityClass(skin.rarity);
  const displayName = skin.displayName;
  const tokenSymbol = c.overview?.gameToken?.symbol || 'token';

  return (
    <div className={cn('admin-skin-item-card rounded-xl border border-strike-border bg-strike-canvas/40 p-4', rarityClass)}>
      <div className="relative z-[2] grid gap-4 lg:grid-cols-[9rem_minmax(0,1fr)]">
        <SkinItemModelPreview item={item} />

        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-white">{displayName}</div>
                <span className={cn('skins-rarity-chip admin-skin-rarity-chip', rarityClass)}>
                  {skin.rarity}
                </span>
              </div>
              <div className="font-mono text-[11px] text-white/40">{settings.skinId}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-white/45">For Sale</span>
              <Switch
                checked={form.saleEnabled}
                onCheckedChange={(v) => set('saleEnabled', v)}
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <NumberField
              label={`Price (base units of ${tokenSymbol})`}
              value={form.tokenAmountBaseUnits}
              onChange={(v) => set('tokenAmountBaseUnits', v)}
              hint="Token base units per purchase."
            />
            <NumberField
              label="Max Supply"
              value={form.maxSupply}
              onChange={(v) => set('maxSupply', v)}
              placeholder="Unlimited"
              hint="Leave blank for unlimited."
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <div className="text-white/40">Sold</div>
              <div className="text-white/80">{formatNumber(settings.soldCount)}</div>
            </div>
            <div>
              <div className="text-white/40">Reserved</div>
              <div className="text-white/80">{formatNumber(settings.reservedCount)}</div>
            </div>
            <div>
              <div className="text-white/40">Remaining</div>
              <div className="text-white/80">
                {settings.remainingSupply == null ? '∞' : formatNumber(settings.remainingSupply)}
              </div>
            </div>
            <div>
              <div className="text-white/40">Price Version</div>
              <div className="text-white/80">{formatNumber(settings.priceVersion)}</div>
            </div>
            <div>
              <div className="text-white/40">Last Audit</div>
              <div className="text-white/80">{formatRelativeTime(settings.updatedAt)}</div>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button type="button" size="sm" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkinShopTab({ console: c }: { console: SectionProps['console'] }) {
  const items = c.overview?.skinShop?.items ?? [];
  return (
    <div className="space-y-6">
      <SkinShopSettingsCard console={c} />
      <Card>
        <CardHeader>
          <CardTitle>Skin Items</CardTitle>
          <CardDescription>Per-skin pricing, supply, and availability.</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title="No skin items"
              description="Configured skins will appear here once available."
            />
          ) : (
            <div className="space-y-4">
              {items.map((item) => (
                <SkinItemCard key={item.settings.skinId} item={item} console={c} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ----------------------------- Section ------------------------------ */

export function EconomySection({ console }: SectionProps) {
  if (!console.overview) return null;

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={Coins}
        title="Economy"
        description="Configure ranked reward payouts, golden biome prizes, and the skin shop."
      />

      <Tabs defaultValue="rewards">
        <TabsList>
          <TabsTrigger value="rewards">
            <Gift className="h-3.5 w-3.5" />
            Rewards
          </TabsTrigger>
          <TabsTrigger value="golden">
            <Sparkles className="h-3.5 w-3.5" />
            Golden Biome
          </TabsTrigger>
          <TabsTrigger value="skins">
            <ShoppingBag className="h-3.5 w-3.5" />
            Skin Shop
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rewards">
          <RewardsTab console={console} />
        </TabsContent>
        <TabsContent value="golden">
          <GoldenTab console={console} />
        </TabsContent>
        <TabsContent value="skins">
          <SkinShopTab console={console} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
