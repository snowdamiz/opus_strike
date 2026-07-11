import { lazy, Suspense, useState, type ReactNode } from 'react';
import { FeaturedHeroPreviewFallback } from './FeaturedHeroPreviewFallback';
import { HERO_DEFINITIONS, ALL_HERO_IDS } from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';
import type { BlazePrimarySkill, BlazeSecondarySkill, BlazeUltimateSkill, PhantomPrimarySkill, PhantomSecondarySkill } from '@voxel-strike/shared';
import type { HeroPreviewAnimationMode } from './HeroPreviewCanvas';
import { AbilityIcon, HeroIcon } from './HeroIcons';
import { SkinRarityChrome } from './SkinRarityChrome';
import { SKILL_RARITY_COLORS } from '../../styles/colorTokens';
import { formatKeybind } from '../../utils/keybindings';
import {
  HERO_LOADOUT_POOL,
  BLAZE_PHOSPHOR_FLARE_OPTION_ID,
  BLAZE_SCRAPSHOT_OPTION_ID,
  BLAZE_PHOENIX_DIVE_OPTION_ID,
  PHANTOM_SOULREND_OPTION_ID,
  PHANTOM_RIFT_BOLT_OPTION_ID,
  LOADOUT_GROUPS,
  LOADOUT_SLOTS,
  defaultOptionId,
  findOption,
  getAbilityPool,
  type LoadoutOwnership,
  type LoadoutSkillOption,
  type LoadoutSlotDef,
  type LoadoutSlotKey,
} from './loadoutPool';
import {
  getDefaultHeroAbilityBindings,
  resolveHeroAbilityBindings,
  useLoadoutStore,
} from '../../store/loadoutStore';

type AbilitySlot = 'ability1' | 'ability2';
type LoadoutFilter = 'all' | LoadoutOwnership;

const LOADOUT_FILTERS: { id: LoadoutFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'owned', label: 'Owned' },
  { id: 'available', label: 'Available' },
  { id: 'locked', label: 'Locked' },
];

const FeaturedHeroPreview = lazy(() =>
  import('./FeaturedHeroPreview').then((module) => ({ default: module.FeaturedHeroPreview })),
);
const HERO_IDLE_ANIMATION_MODE: HeroPreviewAnimationMode = 'idle';

interface LoadoutTabProps {
  featuredHero: HeroId;
  onSelectHero: (heroId: HeroId) => void;
}

export function LoadoutTab({ featuredHero, onSelectHero }: LoadoutTabProps) {
  const [filter, setFilter] = useState<LoadoutFilter>('all');
  const blazePrimarySkill = useLoadoutStore((state) => state.blazePrimarySkill);
  const phantomPrimarySkill = useLoadoutStore((state) => state.phantomPrimarySkill);
  const phantomSecondarySkill = useLoadoutStore((state) => state.phantomSecondarySkill);
  const blazeSecondarySkill = useLoadoutStore((state) => state.blazeSecondarySkill);
  const blazeUltimateSkill = useLoadoutStore((state) => state.blazeUltimateSkill);
  const heroAbilityBindings = useLoadoutStore((state) => state.heroAbilityBindings);
  const setBlazePrimarySkill = useLoadoutStore((state) => state.setBlazePrimarySkill);
  const setPhantomPrimarySkill = useLoadoutStore((state) => state.setPhantomPrimarySkill);
  const setPhantomSecondarySkill = useLoadoutStore((state) => state.setPhantomSecondarySkill);
  const setBlazeSecondarySkill = useLoadoutStore((state) => state.setBlazeSecondarySkill);
  const setBlazeUltimateSkill = useLoadoutStore((state) => state.setBlazeUltimateSkill);
  const assignHeroAbility = useLoadoutStore((state) => state.assignHeroAbility);

  const heroDef = HERO_DEFINITIONS[featuredHero];
  const pool = HERO_LOADOUT_POOL[featuredHero];
  const equippedAbilities = resolveHeroAbilityBindings(featuredHero, heroAbilityBindings);
  const equippedId = (slot: LoadoutSlotKey) => {
    if (featuredHero === 'phantom' && slot === 'primaryFire') {
      return phantomPrimarySkill === 'soulrend_daggers'
        ? PHANTOM_SOULREND_OPTION_ID
        : defaultOptionId('phantom', 'primaryFire');
    }
    if (featuredHero === 'phantom' && slot === 'secondaryFire') {
      return phantomSecondarySkill === 'rift_bolt'
        ? PHANTOM_RIFT_BOLT_OPTION_ID
        : defaultOptionId('phantom', 'secondaryFire');
    }
    if (featuredHero === 'blaze' && slot === 'primaryFire') {
      return blazePrimarySkill === 'scrapshot'
        ? BLAZE_SCRAPSHOT_OPTION_ID
        : defaultOptionId('blaze', 'primaryFire');
    }
    if (featuredHero === 'blaze' && slot === 'secondaryFire') {
      return blazeSecondarySkill === 'phosphor_flare'
        ? BLAZE_PHOSPHOR_FLARE_OPTION_ID
        : defaultOptionId('blaze', 'secondaryFire');
    }
    if (featuredHero === 'blaze' && slot === 'ultimate') {
      return blazeUltimateSkill === 'phoenix_dive'
        ? BLAZE_PHOENIX_DIVE_OPTION_ID
        : defaultOptionId('blaze', 'ultimate');
    }
    if (slot === 'ability1' || slot === 'ability2') {
      const option = getAbilityPool(featuredHero).find((candidate) => (
        candidate.abilityId === equippedAbilities[slot]
      ));
      return option?.id ?? defaultOptionId(featuredHero, slot);
    }
    return defaultOptionId(featuredHero, slot);
  };

  const handleEquip = (slot: LoadoutSlotKey, optionId: string) => {
    if (featuredHero === 'phantom' && slot === 'primaryFire') {
      const skill: PhantomPrimarySkill = optionId === PHANTOM_SOULREND_OPTION_ID
        ? 'soulrend_daggers'
        : 'dire_ball';
      setPhantomPrimarySkill(skill);
      return;
    }
    if (featuredHero === 'phantom' && slot === 'secondaryFire') {
      const skill: PhantomSecondarySkill = optionId === PHANTOM_RIFT_BOLT_OPTION_ID
        ? 'rift_bolt'
        : 'void_ray';
      setPhantomSecondarySkill(skill);
      return;
    }
    if (featuredHero === 'blaze' && slot === 'primaryFire') {
      const skill: BlazePrimarySkill = optionId === BLAZE_SCRAPSHOT_OPTION_ID
        ? 'scrapshot'
        : 'fireball_rockets';
      setBlazePrimarySkill(skill);
      return;
    }
    if (featuredHero === 'blaze' && slot === 'secondaryFire') {
      const skill: BlazeSecondarySkill = optionId === BLAZE_PHOSPHOR_FLARE_OPTION_ID
        ? 'phosphor_flare'
        : 'meteor_strike';
      setBlazeSecondarySkill(skill);
      return;
    }
    if (featuredHero === 'blaze' && slot === 'ultimate') {
      const skill: BlazeUltimateSkill = optionId === BLAZE_PHOENIX_DIVE_OPTION_ID
        ? 'phoenix_dive'
        : 'infernal_gearstorm';
      setBlazeUltimateSkill(skill);
    }
  };

  // Assign an ability option to the E or Q slot. If the option already sits in
  // the other slot, the two swap so both slots stay filled and distinct.
  const handleAssignAbility = (slot: AbilitySlot, option: LoadoutSkillOption) => {
    if (!option.abilityId) return;
    assignHeroAbility(featuredHero, slot, option.abilityId);
  };

  const tunedCount = (heroId: HeroId) => {
    const phantomTuned = heroId === 'phantom' && phantomPrimarySkill === 'soulrend_daggers' ? 1 : 0;
    const phantomSecondaryTuned = heroId === 'phantom' && phantomSecondarySkill === 'rift_bolt' ? 1 : 0;
    const blazeTuned = heroId === 'blaze' && blazePrimarySkill === 'scrapshot' ? 1 : 0;
    const blazeSecondaryTuned = heroId === 'blaze' && blazeSecondarySkill === 'phosphor_flare' ? 1 : 0;
    const blazeUltimateTuned = heroId === 'blaze' && blazeUltimateSkill === 'phoenix_dive' ? 1 : 0;
    const defaults = getDefaultHeroAbilityBindings(heroId);
    const abilities = resolveHeroAbilityBindings(heroId, heroAbilityBindings);
    return phantomTuned + phantomSecondaryTuned + blazeTuned + blazeSecondaryTuned + blazeUltimateTuned
      + (abilities.ability1 === defaults.ability1 ? 0 : 1)
      + (abilities.ability2 === defaults.ability2 ? 0 : 1);
  };

  const allOptions = LOADOUT_SLOTS.flatMap((slot) => pool[slot.key]);
  const filterCounts: Record<LoadoutFilter, number> = {
    all: allOptions.length,
    owned: allOptions.filter((option) => option.ownership === 'owned').length,
    available: allOptions.filter((option) => option.ownership === 'available').length,
    locked: allOptions.filter((option) => option.ownership === 'locked').length,
  };
  const matchesFilter = (option: LoadoutSkillOption) => filter === 'all' || option.ownership === filter;

  const equippedAbilityE = equippedId('ability1');
  const equippedAbilityQ = equippedId('ability2');
  const catalogGroups = LOADOUT_GROUPS.map((group) => {
    if (group.id === 'abilities') {
      const abilityOptions = getAbilityPool(featuredHero).filter(matchesFilter);
      if (abilityOptions.length === 0) return null;
      return (
        <div className="loadout-group" key={group.id}>
          <p className="loadout-group-label">
            {group.label}
            <span className="loadout-group-hint">E / Q interchangeable</span>
          </p>
          {abilityOptions.map((option) => {
            const equippedSlot: AbilitySlot | null =
              option.id === equippedAbilityE
                ? 'ability1'
                : option.id === equippedAbilityQ
                  ? 'ability2'
                  : null;
            return (
              <AbilityPoolRow
                key={option.id}
                option={option}
                equippedSlot={equippedSlot}
                onAssign={(slot) => handleAssignAbility(slot, option)}
              />
            );
          })}
        </div>
      );
    }
    const rows = LOADOUT_SLOTS.filter((slot) => slot.group === group.id).flatMap((slot) =>
      pool[slot.key].filter(matchesFilter).map((option) => (
        <PoolRow
          key={option.id}
          slot={slot}
          option={option}
          equipped={equippedId(slot.key) === option.id}
          onEquip={() => handleEquip(slot.key, option.id)}
        />
      )),
    );
    if (rows.length === 0) return null;
    return (
      <div className="loadout-group" key={group.id}>
        <p className="loadout-group-label">{group.label}</p>
        {rows}
      </div>
    );
  });
  const visibleGroups = catalogGroups.filter(Boolean);

  return (
    <div className="loadout-screen menu-content-wide">
      <div className="loadout-workbench">
        <aside className="loadout-roster" aria-label="Choose hero">
          <div className="loadout-roster-list">
            {ALL_HERO_IDS.map((heroId) => {
              const def = HERO_DEFINITIONS[heroId];
              const active = heroId === featuredHero;
              const tuned = tunedCount(heroId);
              return (
                <button
                  type="button"
                  key={heroId}
                  onClick={() => onSelectHero(heroId)}
                  className={`loadout-hero-tab${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  title={def.name}
                >
                  <HeroIcon heroId={heroId} className="loadout-hero-tab-icon" />
                  <span className="loadout-hero-tab-copy">
                    <span className="loadout-hero-tab-name">{def.name}</span>
                    <span className="loadout-hero-tab-sub">
                      {tuned > 0 ? `${tuned} tuned` : 'Stock loadout'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="loadout-stage" aria-label={`${heroDef.name} loadout preview`}>
          <div className="loadout-stage-copy">
            <div>
              <p className="loadout-kicker">Loadout Bench</p>
              <div className="loadout-stage-title-line">
                <h2 className="loadout-stage-title">{heroDef.name}</h2>
                <span className="loadout-stage-chip">
                  {heroDef.role} / {heroDef.movementFocus}
                </span>
              </div>
            </div>
          </div>

          <div className="loadout-stage-preview">
            <Suspense fallback={<FeaturedHeroPreviewFallback className="loadout-featured-preview" />}>
              <FeaturedHeroPreview
                heroId={featuredHero}
                initialYaw={Math.PI - 0.18}
                animationMode={HERO_IDLE_ANIMATION_MODE}
                className="loadout-featured-preview"
              />
            </Suspense>
          </div>

          <div className="loadout-equipped-strip" aria-label="Equipped loadout">
            {LOADOUT_SLOTS.map((slot) => {
              const option = findOption(featuredHero, slot.key, equippedId(slot.key));
              const tint = SKILL_RARITY_COLORS[option.rarity].hex;
              return (
                <span className="loadout-equipped-chip" key={slot.key} title={`${slot.category}: ${option.name}`}>
                  <span
                    className="loadout-equipped-key"
                    style={{ background: `${tint}26`, border: `1px solid ${tint}70` }}
                  >
                    {formatKeybind(slot.code)}
                  </span>
                  <span className="loadout-equipped-name">{option.name}</span>
                </span>
              );
            })}
          </div>
        </section>

        <section className="loadout-bay" aria-label={`${heroDef.name} skill catalog`}>
          <div className="loadout-filter" role="group" aria-label="Filter skills">
            {LOADOUT_FILTERS.map((option) => (
              <button
                type="button"
                key={option.id}
                className={`loadout-filter-chip${filter === option.id ? ' is-active' : ''}`}
                onClick={() => setFilter(option.id)}
                aria-pressed={filter === option.id}
              >
                <span className="loadout-filter-label">{option.label}</span>
                <span className="loadout-filter-count">{filterCounts[option.id]}</span>
              </button>
            ))}
          </div>
          <div className="loadout-list">
            {visibleGroups.length > 0 ? (
              visibleGroups
            ) : (
              <div className="loadout-empty">No {filter} skills for {heroDef.name}.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function PoolRow({
  slot,
  option,
  equipped,
  onEquip,
}: {
  slot: LoadoutSlotDef;
  option: LoadoutSkillOption;
  equipped: boolean;
  onEquip: () => void;
}) {
  const rarityColor = SKILL_RARITY_COLORS[option.rarity].hex;

  return (
    <article
      className={`skins-row loadout-row is-${option.rarity}${equipped ? ' is-equipped' : ''}${option.ownership === 'locked' ? ' is-locked' : ''}`}
    >
      <SkinRarityChrome />

      <div className="loadout-row-icon">
        <AbilityIcon type={option.iconType} size={28} color={rarityColor} />
        {equipped && <span className="loadout-equipped-mark" aria-hidden="true">✓</span>}
      </div>

      <div className="loadout-copy">
        <div className="loadout-title-line">
          <span
            className="loadout-slot-badge"
            style={{ background: `${rarityColor}26`, border: `1px solid ${rarityColor}70` }}
          >
            {formatKeybind(slot.code)}
          </span>
          <h2>{option.name}</h2>
          <span className={`loadout-rarity-chip is-${option.rarity}`}>{option.rarity}</span>
          {option.isPlaceholder && <span className="loadout-demo-chip">demo</span>}
        </div>
        <p>{option.tagline}</p>
        {option.meta && option.meta.length > 0 && (
          <div className="loadout-tags">
            {option.meta.map((pill) => (
              <span key={pill}>{pill}</span>
            ))}
          </div>
        )}
      </div>

      <div className="loadout-actions">
        <OwnershipAction
          ownership={option.ownership}
          ownedButton={
            <button
              type="button"
              disabled={equipped}
              onClick={onEquip}
              className={`loadout-action-button is-equip${equipped ? ' is-equipped' : ''}`}
            >
              {equipped ? 'EQUIPPED' : 'EQUIP'}
            </button>
          }
        />
      </div>
    </article>
  );
}

// Shows the owned action (equip / slot buttons) or a disabled Unlock/Locked
// state, mirroring the skins armory buttons.
function OwnershipAction({
  ownership,
  ownedButton,
}: {
  ownership: LoadoutOwnership;
  ownedButton: ReactNode;
}) {
  if (ownership === 'owned') return <>{ownedButton}</>;
  return (
    <button
      type="button"
      disabled
      className={`loadout-action-button ${ownership === 'available' ? 'is-available' : 'is-locked-btn'}`}
    >
      {ownership === 'available' ? 'UNLOCK' : 'LOCKED'}
    </button>
  );
}

// Ability rows are slottable into either E or Q (interchangeable), so they show
// both slot buttons instead of a single Equip.
function AbilityPoolRow({
  option,
  equippedSlot,
  onAssign,
}: {
  option: LoadoutSkillOption;
  equippedSlot: AbilitySlot | null;
  onAssign: (slot: AbilitySlot) => void;
}) {
  const rarityColor = SKILL_RARITY_COLORS[option.rarity].hex;
  const equipped = equippedSlot !== null;
  const slotBadge = equippedSlot === 'ability1' ? 'E' : equippedSlot === 'ability2' ? 'Q' : 'E / Q';

  return (
    <article
      className={`skins-row loadout-row is-${option.rarity}${equipped ? ' is-equipped' : ''}${option.ownership === 'locked' ? ' is-locked' : ''}`}
    >
      <SkinRarityChrome />

      <div className="loadout-row-icon">
        <AbilityIcon type={option.iconType} size={28} color={rarityColor} />
        {equipped && <span className="loadout-equipped-mark" aria-hidden="true">✓</span>}
      </div>

      <div className="loadout-copy">
        <div className="loadout-title-line">
          <span
            className="loadout-slot-badge"
            style={{ background: `${rarityColor}26`, border: `1px solid ${rarityColor}70` }}
          >
            {slotBadge}
          </span>
          <h2>{option.name}</h2>
          <span className={`loadout-rarity-chip is-${option.rarity}`}>{option.rarity}</span>
          {option.isPlaceholder && <span className="loadout-demo-chip">demo</span>}
        </div>
        <p>{option.tagline}</p>
        {option.meta && option.meta.length > 0 && (
          <div className="loadout-tags">
            {option.meta.map((pill) => (
              <span key={pill}>{pill}</span>
            ))}
          </div>
        )}
      </div>

      {option.ownership === 'owned' ? (
        <div className="loadout-actions loadout-actions-dual">
          <button
            type="button"
            disabled={equippedSlot === 'ability1'}
            onClick={() => onAssign('ability1')}
            className={`loadout-slot-button${equippedSlot === 'ability1' ? ' is-on' : ''}`}
            title="Slot to E"
          >
            {equippedSlot === 'ability1' ? '✓ E' : 'E'}
          </button>
          <button
            type="button"
            disabled={equippedSlot === 'ability2'}
            onClick={() => onAssign('ability2')}
            className={`loadout-slot-button${equippedSlot === 'ability2' ? ' is-on' : ''}`}
            title="Slot to Q"
          >
            {equippedSlot === 'ability2' ? '✓ Q' : 'Q'}
          </button>
        </div>
      ) : (
        <div className="loadout-actions">
          <button
            type="button"
            disabled
            className={`loadout-action-button ${option.ownership === 'available' ? 'is-available' : 'is-locked-btn'}`}
          >
            {option.ownership === 'available' ? 'UNLOCK' : 'LOCKED'}
          </button>
        </div>
      )}
    </article>
  );
}

export type { LoadoutTabProps };
