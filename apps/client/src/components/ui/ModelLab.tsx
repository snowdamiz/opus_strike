import { useMemo, useState } from 'react';
import {
  ALL_HERO_IDS,
  HERO_DEFINITIONS,
  getHeroSkinsForHero,
  type HeroId,
  type HeroSkinDefinition,
  type Team,
} from '@voxel-strike/shared';
import { SKILL_RARITY_COLORS } from '../../styles/colorTokens';
import { HeroPreviewCanvas, type HeroPreviewAnimationMode } from './HeroPreviewCanvas';

/**
 * Dev-only model review gallery, reached at the `/model-lab` pathname.
 *
 * Renders every hero x every skin through {@link HeroPreviewCanvas} with no
 * network/auth/backend dependency so the full-body models and skin variance can
 * be reviewed side by side while iterating on the manifests.
 */

const TEAM_OPTIONS: { id: Team; label: string }[] = [
  { id: 'blue', label: 'Blue' },
  { id: 'red', label: 'Red' },
];

const ANIMATION_OPTIONS: { id: HeroPreviewAnimationMode; label: string }[] = [
  { id: 'idle', label: 'Idle' },
  { id: 'walk', label: 'Walk' },
  { id: 'run', label: 'Run' },
  { id: 'jump', label: 'Jump' },
  { id: 'crouch', label: 'Crouch' },
  { id: 'attack', label: 'Attack' },
];

export function ModelLab() {
  const [team, setTeam] = useState<Team>('blue');
  const [animationMode, setAnimationMode] = useState<HeroPreviewAnimationMode>('idle');
  const [heroFilter, setHeroFilter] = useState<HeroId | 'all'>('all');

  const heroes = useMemo(
    () => (heroFilter === 'all' ? ALL_HERO_IDS : [heroFilter]),
    [heroFilter]
  );

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Model Lab</h1>
          <p style={styles.subtitle}>
            Every hero × skin, rendered from the live manifests. Drag a model to rotate.
          </p>
        </div>
        <div style={styles.controls}>
          <ControlGroup label="Hero">
            <Segmented
              value={heroFilter}
              options={[
                { id: 'all' as const, label: 'All' },
                ...ALL_HERO_IDS.map((heroId) => ({ id: heroId, label: HERO_DEFINITIONS[heroId].name })),
              ]}
              onChange={setHeroFilter}
            />
          </ControlGroup>
          <ControlGroup label="Team">
            <Segmented value={team} options={TEAM_OPTIONS} onChange={setTeam} />
          </ControlGroup>
          <ControlGroup label="Pose">
            <Segmented value={animationMode} options={ANIMATION_OPTIONS} onChange={setAnimationMode} />
          </ControlGroup>
        </div>
      </header>

      <main style={styles.main}>
        {heroes.map((heroId) => {
          const skins = getHeroSkinsForHero(heroId);
          return (
            <section key={heroId} style={styles.heroSection}>
              <h2 style={styles.heroHeading}>
                {HERO_DEFINITIONS[heroId].name}
                <span style={styles.heroSkinCount}>{skins.length} skins</span>
              </h2>
              <div style={styles.grid}>
                {skins.map((skin) => (
                  <article key={skin.id} style={styles.card}>
                    <div style={styles.canvasShell}>
                      <HeroPreviewCanvas
                        heroId={heroId}
                        skinId={skin.id}
                        team={team}
                        size="detail"
                        animationMode={animationMode}
                        interactive
                        idleRotation={animationMode === 'idle'}
                        aria-label={`${skin.displayName} preview`}
                      />
                    </div>
                    <div style={styles.cardMeta}>
                      <span style={styles.skinName}>{skin.displayName}</span>
                      <span style={{ ...styles.rarityTag, color: SKILL_RARITY_COLORS[skin.rarity].hex }}>
                        {skin.rarity}
                      </span>
                    </div>
                    <code style={styles.skinId}>{skin.id}</code>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.controlGroup}>
      <span style={styles.controlLabel}>{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div style={styles.segmented}>
      {options.map((option) => {
        const isActive = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            style={{
              ...styles.segmentedButton,
              ...(isActive ? styles.segmentedButtonActive : null),
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100%',
    background: 'radial-gradient(circle at 50% 0%, rgb(var(--color-strike-elevated)) 0%, rgb(var(--color-strike-bg)) 55%, rgb(var(--color-strike-page-bottom)) 100%)',
    color: 'rgb(var(--color-strike-border) / 0.9)',
    fontFamily: 'system-ui, sans-serif',
    paddingBottom: '4rem',
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1rem',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    padding: '1.25rem 1.75rem',
    background: 'rgb(var(--color-strike-chrome) / 0.86)',
    backdropFilter: 'blur(10px)',
    borderBottom: '1px solid rgb(var(--color-strike-border) / 0.08)',
  },
  title: { margin: 0, fontSize: '1.5rem', fontWeight: 700, letterSpacing: '0.04em' },
  subtitle: { margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'rgb(var(--color-strike-border) / 0.6)' },
  controls: { display: 'flex', flexWrap: 'wrap', gap: '0.85rem', alignItems: 'flex-end' },
  controlGroup: { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  controlLabel: {
    fontSize: '0.65rem',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'rgb(var(--color-strike-border) / 0.45)',
  },
  segmented: {
    display: 'inline-flex',
    background: 'rgb(var(--color-strike-border) / 0.05)',
    borderRadius: '999px',
    padding: '0.2rem',
    gap: '0.15rem',
  },
  segmentedButton: {
    border: 'none',
    background: 'transparent',
    color: 'rgb(var(--color-strike-border) / 0.7)',
    padding: '0.32rem 0.7rem',
    borderRadius: '999px',
    fontSize: '0.78rem',
    cursor: 'pointer',
    transition: 'background 120ms ease, color 120ms ease',
  },
  segmentedButtonActive: { background: 'rgb(var(--color-accent-tertiary))', color: 'rgb(var(--color-strike-border))' },
  main: { padding: '1.5rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '2.5rem' },
  heroSection: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  heroHeading: {
    margin: 0,
    fontSize: '1.1rem',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  heroSkinCount: { fontSize: '0.7rem', fontWeight: 500, color: 'rgb(var(--color-strike-border) / 0.45)' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '1rem',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    background: 'rgb(var(--color-strike-border) / 0.035)',
    border: '1px solid rgb(var(--color-strike-border) / 0.07)',
    borderRadius: '14px',
    overflow: 'hidden',
  },
  canvasShell: {
    position: 'relative',
    height: '300px',
    background: 'radial-gradient(circle at 50% 35%, rgb(var(--color-accent-tertiary) / 0.12) 0%, transparent 70%)',
  },
  cardMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.6rem 0.85rem 0.2rem',
  },
  skinName: { fontSize: '0.92rem', fontWeight: 600 },
  rarityTag: {
    fontSize: '0.66rem',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontWeight: 700,
  },
  skinId: {
    fontSize: '0.66rem',
    color: 'rgb(var(--color-strike-border) / 0.4)',
    padding: '0 0.85rem 0.7rem',
    fontFamily: 'ui-monospace, monospace',
  },
};
