import { useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Copy,
  Loader2,
  Plus,
  Save,
  Target,
  Trash2,
} from 'lucide-react';
import {
  ALL_HERO_IDS,
  DAILY_MISSION_CRITERION_TYPES,
  DEFAULT_DAILY_MISSION_ELIGIBILITY,
  GAMEPLAY_MODES,
  HERO_DEFINITIONS,
  MATCH_MODES,
  getDailyMissionCriterionLabel,
  getGameplayModeLabel,
  type DailyMissionAbilityCriterion,
  type DailyMissionCriteria,
  type DailyMissionCriterion,
  type DailyMissionCriterionType,
  type DailyMissionEligibility,
  type DailyMissionReward,
  type DailyMissionRewardBundle,
  type HeroSkinId,
  type HeroId,
} from '@voxel-strike/shared';
import type { SectionProps } from '../section';
import type { MissionDefinition, MissionDefinitionRequest } from '../types';
import { SectionHeader, Stat, EmptyState, Field, KeyValue, StatusDot } from '../common';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Textarea } from '../ui/textarea';
import { formatDateTime, formatNumber, formatRelativeTime } from '../format';
import { cn } from '../lib/utils';

const HERO_CRITERIA = new Set<DailyMissionCriterionType>([
  'play_hero',
  'eliminations_as_hero',
  'eliminations_against_hero',
]);
const ABILITY_CRITERIA = new Set<DailyMissionCriterionType>(['eliminations_with_ability']);

type RewardDraft =
  | { type: 'sol'; amountLamports: string }
  | { type: 'game_token'; amountBaseUnits: string; symbol: string }
  | { type: 'skin'; skinId: string };

type MissionsTab = 'today' | 'library' | 'editor' | 'audit';

interface MissionDraft {
  id: string | null;
  displayName: string;
  description: string;
  enabled: boolean;
  sortOrder: string;
  activeStartsAt: string;
  activeEndsAt: string;
  criteria: DailyMissionCriterion[];
  rewards: RewardDraft[];
  eligibility: DailyMissionEligibility;
}

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const date = new Date(ms);
  return new Date(ms - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function defaultCriterion(index: number): DailyMissionCriterion {
  return {
    id: `crit_${index + 1}`,
    type: 'matches_completed',
    target: 1,
  };
}

function defaultDraft(): MissionDraft {
  return {
    id: null,
    displayName: '',
    description: '',
    enabled: true,
    sortOrder: '0',
    activeStartsAt: '',
    activeEndsAt: '',
    criteria: [defaultCriterion(0)],
    rewards: [{ type: 'sol', amountLamports: '50000' }],
    eligibility: { ...DEFAULT_DAILY_MISSION_ELIGIBILITY },
  };
}

function draftFromMission(mission: MissionDefinition): MissionDraft {
  return {
    id: mission.id,
    displayName: mission.displayName,
    description: mission.description,
    enabled: mission.enabled,
    sortOrder: String(mission.sortOrder),
    activeStartsAt: isoToLocalInput(mission.activeStartsAt),
    activeEndsAt: isoToLocalInput(mission.activeEndsAt),
    criteria: mission.criteria.items.map((criterion) => ({ ...criterion })),
    rewards: mission.rewards.items.map((reward) => {
      if (reward.type === 'sol') return { type: 'sol', amountLamports: reward.amountLamports };
      if (reward.type === 'game_token') return { type: 'game_token', amountBaseUnits: reward.amountBaseUnits, symbol: reward.symbol ?? '' };
      return { type: 'skin', skinId: reward.skinId };
    }),
    eligibility: {
      ...DEFAULT_DAILY_MISSION_ELIGIBILITY,
      ...mission.eligibility,
    },
  };
}

function criterionSummary(criteria: DailyMissionCriteria): string {
  return criteria.items.map((criterion) => {
    const label = getDailyMissionCriterionLabel(criterion.type);
    if ('heroId' in criterion) return `${label}: ${HERO_DEFINITIONS[criterion.heroId].name} x${criterion.target}`;
    if ('abilityId' in criterion) return `${label}: ${criterion.abilityId} x${criterion.target}`;
    return `${label} x${criterion.target}`;
  }).join(', ');
}

function rewardSummary(rewards: DailyMissionRewardBundle): string {
  return rewards.items.map((reward) => {
    if (reward.type === 'sol') return `${reward.amountLamports} lamports`;
    if (reward.type === 'game_token') return `${reward.amountBaseUnits} ${reward.symbol ? `$${reward.symbol}` : 'token units'}`;
    return reward.skinId;
  }).join(', ');
}

function toRequest(draft: MissionDraft): MissionDefinitionRequest {
  const criteria: DailyMissionCriteria = {
    mode: 'all',
    items: draft.criteria.map((criterion, index) => {
      const base = {
        id: criterion.id.trim() || `crit_${index + 1}`,
        type: criterion.type,
        target: Math.max(1, Math.floor(Number(criterion.target) || 1)),
      };
      if (HERO_CRITERIA.has(criterion.type)) {
        return {
          ...base,
          heroId: ('heroId' in criterion ? criterion.heroId : 'blaze') as HeroId,
        } as DailyMissionCriterion;
      }
      if (ABILITY_CRITERIA.has(criterion.type)) {
        return {
          ...base,
          abilityId: ('abilityId' in criterion ? criterion.abilityId : 'blaze_rocket') || 'blaze_rocket',
        } as DailyMissionAbilityCriterion;
      }
      return base as DailyMissionCriterion;
    }),
  };
  const rewards: DailyMissionRewardBundle = {
    items: draft.rewards.map((reward): DailyMissionReward => {
      if (reward.type === 'sol') return { type: 'sol', amountLamports: reward.amountLamports || '1' };
      if (reward.type === 'game_token') {
        return {
          type: 'game_token',
          amountBaseUnits: reward.amountBaseUnits || '1',
          ...(reward.symbol.trim() ? { symbol: reward.symbol.trim().replace(/^\$/, '').toUpperCase() } : {}),
        };
      }
      return { type: 'skin', skinId: reward.skinId as HeroSkinId };
    }),
  };

  return {
    displayName: draft.displayName.trim(),
    description: draft.description.trim(),
    enabled: draft.enabled,
    sortOrder: Math.round(Number(draft.sortOrder) || 0),
    activeStartsAt: localInputToIso(draft.activeStartsAt),
    activeEndsAt: localInputToIso(draft.activeEndsAt),
    resetPolicy: 'utc',
    criteria,
    rewards,
    eligibility: draft.eligibility,
  };
}

function isDraftValid(draft: MissionDraft): boolean {
  return draft.displayName.trim().length > 0
    && draft.criteria.length > 0
    && draft.rewards.length > 0
    && draft.criteria.every((criterion) => criterion.id.trim() && Number(criterion.target) > 0)
    && draft.rewards.every((reward) => (
      reward.type === 'skin'
        ? Boolean(reward.skinId)
        : Number(reward.type === 'sol' ? reward.amountLamports : reward.amountBaseUnits) > 0
    ));
}

function updateCriterion(
  criterion: DailyMissionCriterion,
  patch: Partial<DailyMissionCriterion> & { type?: DailyMissionCriterionType }
): DailyMissionCriterion {
  const nextType = patch.type ?? criterion.type;
  const base = {
    id: patch.id ?? criterion.id,
    type: nextType,
    target: patch.target ?? criterion.target,
  };
  if (HERO_CRITERIA.has(nextType)) {
    return {
      ...base,
      heroId: ('heroId' in patch ? patch.heroId : 'heroId' in criterion ? criterion.heroId : 'blaze') as HeroId,
    } as DailyMissionCriterion;
  }
  if (ABILITY_CRITERIA.has(nextType)) {
    return {
      ...base,
      abilityId: ('abilityId' in patch ? patch.abilityId : 'abilityId' in criterion ? criterion.abilityId : 'blaze_rocket') ?? 'blaze_rocket',
    } as DailyMissionAbilityCriterion;
  }
  return base as DailyMissionCriterion;
}

export function MissionsSection({ console }: SectionProps) {
  const overview = console.overview?.missions;
  const skinOptions = console.overview?.skinShop.items.map((item) => item.skin.id) ?? [];
  const [draft, setDraft] = useState<MissionDraft>(defaultDraft);
  const [activeTab, setActiveTab] = useState<MissionsTab>('today');
  const [saving, setSaving] = useState(false);

  if (!overview) return null;

  const activeMissionIds = new Set(overview.today.map((row) => row.mission.id));
  const activeLibrary = overview.library.filter((mission) => !mission.archivedAt);
  const archivedLibrary = overview.library.filter((mission) => mission.archivedAt);
  const canSave = isDraftValid(draft) && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const body = toRequest(draft);
      const result = draft.id
        ? await console.saveMission(draft.id, body)
        : await console.createMission(body);
      if (result.ok) {
        setDraft(defaultDraft());
      }
    } finally {
      setSaving(false);
    }
  }

  function selectMission(mission: MissionDefinition) {
    setDraft(draftFromMission(mission));
    setActiveTab('editor');
  }

  function startNewMission() {
    setDraft(defaultDraft());
    setActiveTab('editor');
  }

  async function reorder(mission: MissionDefinition, direction: -1 | 1) {
    const ordered = activeLibrary.slice().sort((left, right) => left.sortOrder - right.sortOrder);
    const index = ordered.findIndex((item) => item.id === mission.id);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    await console.reorderMissions({
      items: next.map((item, sortOrder) => ({ id: item.id, sortOrder })),
    });
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={Target}
        title="Missions"
        description="Schedule daily objectives and reward completion."
        actions={
          <Button variant="secondary" onClick={startNewMission}>
            <Plus className="h-4 w-4" /> New
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-5">
        <Stat label="Active Today" value={overview.summary.activeToday} tone="primary" />
        <Stat label="Enabled" value={overview.summary.enabled} />
        <Stat label="Completed" value={formatNumber(overview.summary.completedToday)} tone="success" />
        <Stat label="Failed Grants" value={overview.summary.failedGrants} tone={overview.summary.failedGrants ? 'danger' : 'default'} />
        <Stat label="Token Queue" value={overview.summary.pendingTokenPayouts} tone={overview.summary.pendingTokenPayouts ? 'warning' : 'default'} />
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as MissionsTab)}>
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="today">
          {overview.today.length === 0 ? (
            <EmptyState icon={Target} title="No active missions" />
          ) : (
            <div className="space-y-3">
              {overview.today.map((row) => (
                <Card key={row.mission.id}>
                  <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-lg text-white">{row.mission.displayName}</h3>
                        <Badge variant={row.mission.enabled ? 'success' : 'secondary'}>
                          {row.mission.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-white/45">{criterionSummary(row.mission.criteria)}</p>
                      <p className="mt-1 truncate text-xs text-white/35">{rewardSummary(row.mission.rewards)}</p>
                    </div>
                    <div className="grid min-w-52 grid-cols-3 gap-2 text-center">
                      <KeyValue label="Done" value={row.completedCount} />
                      <KeyValue label="Grants" value={row.grantCount} />
                      <KeyValue label="Failed" value={row.failedGrantCount} />
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => selectMission(row.mission)}>
                      Edit
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="library">
          <div className="space-y-3">
            {activeLibrary.map((mission) => (
              <Card key={mission.id} className={cn(activeMissionIds.has(mission.id) && 'border-accent-primary/30')}>
                <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusDot tone={mission.enabled ? 'success' : 'muted'} />
                      <h3 className="font-display text-lg text-white">{mission.displayName}</h3>
                      {activeMissionIds.has(mission.id) ? <Badge variant="warning">Today</Badge> : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-white/45">{criterionSummary(mission.criteria)}</p>
                    <p className="mt-1 truncate text-xs text-white/35">{rewardSummary(mission.rewards)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="icon" variant="ghost" title="Move up" onClick={() => void reorder(mission, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="Move down" onClick={() => void reorder(mission, 1)}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => selectMission(mission)}>
                      Edit
                    </Button>
                    <Button size="icon" variant="ghost" title="Duplicate" onClick={() => void console.duplicateMission(mission.id)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="Archive" onClick={() => void console.archiveMission(mission.id)}>
                      <Archive className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {activeLibrary.length === 0 ? <EmptyState icon={Target} title="Mission library is empty" /> : null}
            {archivedLibrary.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Archived</CardTitle>
                </CardHeader>
                <CardContent className="divide-y divide-strike-border">
                  {archivedLibrary.map((mission) => (
                    <div key={mission.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="text-white/55">{mission.displayName}</span>
                      <span className="text-xs text-white/35">{formatRelativeTime(mission.archivedAt)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="editor">
          <MissionEditor
            draft={draft}
            skinOptions={skinOptions}
            saving={saving}
            canSave={canSave}
            onDraftChange={setDraft}
            onSave={() => void handleSave()}
            onReset={() => setDraft(defaultDraft())}
          />
        </TabsContent>

        <TabsContent value="audit">
          {overview.audit.length === 0 ? (
            <EmptyState icon={Target} title="No mission grant issues" />
          ) : (
            <Card>
              <CardContent className="divide-y divide-strike-border p-0">
                {overview.audit.map((grant) => (
                  <div key={grant.id} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[1fr_auto_auto] md:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-white/70">{grant.idempotencyKey}</p>
                      <p className="mt-1 text-xs text-white/35">{grant.lastError ?? grant.rewardType}</p>
                    </div>
                    <Badge variant={grant.status === 'failed' ? 'danger' : 'warning'}>{grant.status}</Badge>
                    <span className="text-xs text-white/35">{formatDateTime(grant.updatedAt)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MissionEditor({
  draft,
  skinOptions,
  saving,
  canSave,
  onDraftChange,
  onSave,
  onReset,
}: {
  draft: MissionDraft;
  skinOptions: string[];
  saving: boolean;
  canSave: boolean;
  onDraftChange: (draft: MissionDraft) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const setEligibility = (patch: Partial<DailyMissionEligibility>) => {
    onDraftChange({ ...draft, eligibility: { ...draft.eligibility, ...patch } });
  };
  const toggleMatchMode = (mode: DailyMissionEligibility['matchModes'][number]) => {
    const modes = new Set(draft.eligibility.matchModes);
    if (modes.has(mode)) modes.delete(mode);
    else modes.add(mode);
    if (modes.size === 0) modes.add(mode);
    setEligibility({ matchModes: Array.from(modes) });
  };
  const toggleGameplayMode = (mode: DailyMissionEligibility['gameplayModes'][number]) => {
    const modes = new Set(draft.eligibility.gameplayModes);
    if (modes.has(mode)) modes.delete(mode);
    else modes.add(mode);
    if (modes.size === 0) modes.add(mode);
    setEligibility({ gameplayModes: Array.from(modes) });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{draft.id ? 'Edit Mission' : 'New Mission'}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="Name">
              <Input value={draft.displayName} onChange={(event) => onDraftChange({ ...draft, displayName: event.target.value })} />
            </Field>
            <Field label="Sort Order">
              <Input type="number" value={draft.sortOrder} onChange={(event) => onDraftChange({ ...draft, sortOrder: event.target.value })} />
            </Field>
            <Field label="Description" className="md:col-span-2">
              <Textarea value={draft.description} onChange={(event) => onDraftChange({ ...draft, description: event.target.value })} />
            </Field>
            <Field label="Active Start">
              <Input type="datetime-local" value={draft.activeStartsAt} onChange={(event) => onDraftChange({ ...draft, activeStartsAt: event.target.value })} />
            </Field>
            <Field label="Active End">
              <Input type="datetime-local" value={draft.activeEndsAt} onChange={(event) => onDraftChange({ ...draft, activeEndsAt: event.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => onDraftChange({ ...draft, enabled: event.target.checked })}
              />
              Enabled
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Criteria
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onDraftChange({ ...draft, criteria: [...draft.criteria, defaultCriterion(draft.criteria.length)] })}
              >
                <Plus className="h-4 w-4" /> Add
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {draft.criteria.map((criterion, index) => (
              <div key={`${criterion.id}-${index}`} className="grid gap-2 rounded-lg border border-strike-border bg-strike-canvas/35 p-3 md:grid-cols-[1fr_11rem_7rem_auto]">
                <Input
                  value={criterion.id}
                  onChange={(event) => {
                    const criteria = draft.criteria.slice();
                    criteria[index] = updateCriterion(criterion, { id: event.target.value });
                    onDraftChange({ ...draft, criteria });
                  }}
                />
                <select
                  className="h-10 rounded-md border border-strike-border bg-strike-canvas px-3 text-sm text-white"
                  value={criterion.type}
                  onChange={(event) => {
                    const criteria = draft.criteria.slice();
                    criteria[index] = updateCriterion(criterion, { type: event.target.value as DailyMissionCriterionType });
                    onDraftChange({ ...draft, criteria });
                  }}
                >
                  {DAILY_MISSION_CRITERION_TYPES.map((type) => (
                    <option key={type} value={type}>{getDailyMissionCriterionLabel(type)}</option>
                  ))}
                </select>
                <Input
                  type="number"
                  min={1}
                  value={criterion.target}
                  onChange={(event) => {
                    const criteria = draft.criteria.slice();
                    criteria[index] = updateCriterion(criterion, { target: Math.max(1, Math.floor(Number(event.target.value) || 1)) });
                    onDraftChange({ ...draft, criteria });
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={draft.criteria.length === 1}
                  onClick={() => onDraftChange({ ...draft, criteria: draft.criteria.filter((_, itemIndex) => itemIndex !== index) })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                {HERO_CRITERIA.has(criterion.type) ? (
                  <select
                    className="h-10 rounded-md border border-strike-border bg-strike-canvas px-3 text-sm text-white md:col-span-2"
                    value={'heroId' in criterion ? criterion.heroId : 'blaze'}
                    onChange={(event) => {
                      const criteria = draft.criteria.slice();
                      criteria[index] = updateCriterion(criterion, { heroId: event.target.value as HeroId });
                      onDraftChange({ ...draft, criteria });
                    }}
                  >
                    {ALL_HERO_IDS.map((heroId) => (
                      <option key={heroId} value={heroId}>{HERO_DEFINITIONS[heroId].name}</option>
                    ))}
                  </select>
                ) : null}
                {ABILITY_CRITERIA.has(criterion.type) ? (
                  <Input
                    className="md:col-span-2"
                    value={'abilityId' in criterion ? criterion.abilityId : 'blaze_rocket'}
                    onChange={(event) => {
                      const criteria = draft.criteria.slice();
                      criteria[index] = updateCriterion(criterion, { abilityId: event.target.value });
                      onDraftChange({ ...draft, criteria });
                    }}
                  />
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Rewards
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => onDraftChange({ ...draft, rewards: [...draft.rewards, { type: 'sol', amountLamports: '50000' }] })}>
                  SOL
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onDraftChange({ ...draft, rewards: [...draft.rewards, { type: 'game_token', amountBaseUnits: '100000', symbol: '' }] })}>
                  Token
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onDraftChange({ ...draft, rewards: [...draft.rewards, { type: 'skin', skinId: skinOptions[0] ?? '' }] })}>
                  Skin
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {draft.rewards.map((reward, index) => (
              <div key={`${reward.type}-${index}`} className="grid gap-2 rounded-lg border border-strike-border bg-strike-canvas/35 p-3 md:grid-cols-[9rem_1fr_auto]">
                <select
                  className="h-10 rounded-md border border-strike-border bg-strike-canvas px-3 text-sm text-white"
                  value={reward.type}
                  onChange={(event) => {
                    const nextType = event.target.value;
                    const rewards = draft.rewards.slice();
                    rewards[index] = nextType === 'sol'
                      ? { type: 'sol', amountLamports: '50000' }
                      : nextType === 'game_token'
                        ? { type: 'game_token', amountBaseUnits: '100000', symbol: '' }
                        : { type: 'skin', skinId: skinOptions[0] ?? '' };
                    onDraftChange({ ...draft, rewards });
                  }}
                >
                  <option value="sol">SOL</option>
                  <option value="game_token">Game Token</option>
                  <option value="skin">Skin</option>
                </select>
                {reward.type === 'sol' ? (
                  <Input value={reward.amountLamports} onChange={(event) => {
                    const rewards = draft.rewards.slice();
                    rewards[index] = { ...reward, amountLamports: event.target.value };
                    onDraftChange({ ...draft, rewards });
                  }} />
                ) : reward.type === 'game_token' ? (
                  <div className="grid gap-2 md:grid-cols-[1fr_8rem]">
                    <Input value={reward.amountBaseUnits} onChange={(event) => {
                      const rewards = draft.rewards.slice();
                      rewards[index] = { ...reward, amountBaseUnits: event.target.value };
                      onDraftChange({ ...draft, rewards });
                    }} />
                    <Input value={reward.symbol} placeholder="SLOP" onChange={(event) => {
                      const rewards = draft.rewards.slice();
                      rewards[index] = { ...reward, symbol: event.target.value };
                      onDraftChange({ ...draft, rewards });
                    }} />
                  </div>
                ) : (
                  <select
                    className="h-10 rounded-md border border-strike-border bg-strike-canvas px-3 text-sm text-white"
                    value={reward.skinId}
                    onChange={(event) => {
                      const rewards = draft.rewards.slice();
                      rewards[index] = { ...reward, skinId: event.target.value };
                      onDraftChange({ ...draft, rewards });
                    }}
                  >
                    {skinOptions.map((skinId) => <option key={skinId} value={skinId}>{skinId}</option>)}
                  </select>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={draft.rewards.length === 1}
                  onClick={() => onDraftChange({ ...draft, rewards: draft.rewards.filter((_, itemIndex) => itemIndex !== index) })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Eligibility</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Match Modes">
              <div className="flex flex-wrap gap-2">
                {MATCH_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => toggleMatchMode(mode)}
                    className={cn(
                      'rounded-md border px-2.5 py-1.5 text-xs uppercase transition',
                      draft.eligibility.matchModes.includes(mode)
                        ? 'border-accent-primary/40 bg-accent-primary/12 text-accent-primary'
                        : 'border-strike-border text-white/45'
                    )}
                  >
                    {mode.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Gameplay Modes">
              <div className="flex flex-wrap gap-2">
                {GAMEPLAY_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => toggleGameplayMode(mode)}
                    className={cn(
                      'rounded-md border px-2.5 py-1.5 text-xs uppercase transition',
                      draft.eligibility.gameplayModes.includes(mode)
                        ? 'border-accent-secondary/40 bg-accent-secondary/12 text-accent-secondary'
                        : 'border-strike-border text-white/45'
                    )}
                  >
                    {getGameplayModeLabel(mode)}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Minimum Duration">
              <Input
                type="number"
                value={draft.eligibility.minDurationMs}
                onChange={(event) => setEligibility({ minDurationMs: Math.max(0, Math.floor(Number(event.target.value) || 0)) })}
              />
            </Field>
            <div className="space-y-2 text-sm text-white/65">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.eligibility.rankedOnly} onChange={(event) => setEligibility({ rankedOnly: event.target.checked })} />
                Ranked only
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.eligibility.cleanIntegrityOnly} onChange={(event) => setEligibility({ cleanIntegrityOnly: event.target.checked })} />
                Clean integrity only
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.eligibility.leaverPolicy === 'allow_partial'}
                  onChange={(event) => setEligibility({ leaverPolicy: event.target.checked ? 'allow_partial' : 'finish_required' })}
                />
                Allow partial leaver progress
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <KeyValue label="Criteria" value={criterionSummary({ mode: 'all', items: draft.criteria })} />
            <KeyValue label="Rewards" value={rewardSummary(toRequest(draft).rewards)} />
            <KeyValue label="Reset" value="UTC daily" />
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button onClick={onSave} disabled={!canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
          <Button variant="secondary" onClick={onReset}>Reset</Button>
        </div>
      </div>
    </div>
  );
}
