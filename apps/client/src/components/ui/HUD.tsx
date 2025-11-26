import { useGameStore } from '../../store/gameStore';
import { HERO_DEFINITIONS, ABILITY_DEFINITIONS } from '@voxel-strike/shared';

export function HUD() {
  const { localPlayer, redScore, blueScore, roundTimeRemaining } = useGameStore();

  if (!localPlayer) return null;

  const healthPercent = (localPlayer.health / localPlayer.maxHealth) * 100;
  const isLowHealth = healthPercent < 30;
  const ultimatePercent = localPlayer.ultimateCharge;
  const isUltReady = ultimatePercent >= 100;
  const heroInfo = localPlayer.heroId ? HERO_DEFINITIONS[localPlayer.heroId] : null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="absolute inset-0 pointer-events-none select-none">
      {/* Low health vignette */}
      {isLowHealth && (
        <div 
          className="absolute inset-0 pointer-events-none animate-pulse-soft"
          style={{
            background: 'radial-gradient(ellipse at center, transparent 40%, rgba(239, 68, 68, 0.2) 100%)',
          }}
        />
      )}

      {/* Crosshair */}
      <div className="crosshair">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="1.5" fill="white" fillOpacity="0.9" />
          <line x1="10" y1="3" x2="10" y2="7" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
          <line x1="10" y1="13" x2="10" y2="17" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
          <line x1="3" y1="10" x2="7" y2="10" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
          <line x1="13" y1="10" x2="17" y2="10" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
        </svg>
      </div>

      {/* Top - Score Panel */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2">
        <div className="flex items-stretch">
          {/* Red Score */}
          <div className="flex items-center gap-2 px-5 py-2 bg-red-500/20 border-b-2 border-red-500 clip-corner-sm">
            <span className="font-display text-2xl text-white tabular-nums">{redScore}</span>
            <span className="text-[10px] font-body text-red-300 uppercase">Red</span>
          </div>

          {/* Timer */}
          <div className="px-6 py-2 bg-black/50 backdrop-blur-sm">
            <span className={`font-mono text-xl tabular-nums ${roundTimeRemaining < 30 ? 'text-amber-400' : 'text-white'}`}>
              {formatTime(roundTimeRemaining)}
            </span>
          </div>

          {/* Blue Score */}
          <div className="flex items-center gap-2 px-5 py-2 bg-blue-500/20 border-b-2 border-blue-500 clip-corner-sm" style={{ clipPath: 'polygon(12px 0, 100% 0, 100% 100%, 0 100%, 0 calc(100% - 12px))' }}>
            <span className="text-[10px] font-body text-blue-300 uppercase">Blue</span>
            <span className="font-display text-2xl text-white tabular-nums">{blueScore}</span>
          </div>
        </div>
      </div>

      {/* Bottom Left - Health & Hero */}
      <div className="absolute bottom-5 left-5">
        <div className="flex items-end gap-3">
          {/* Hero Icon */}
          <div className="w-12 h-12 rounded bg-strike-surface/90 border border-strike-border flex items-center justify-center backdrop-blur-sm">
            <span className="font-display text-lg text-white/70">
              {localPlayer.heroId?.charAt(0).toUpperCase()}
            </span>
          </div>

          {/* Bars */}
          <div className="space-y-1">
            {/* Hero Name + Flag */}
            <div className="flex items-center gap-2 mb-1">
              <span className="font-body text-[10px] text-white/50 uppercase tracking-wider">
                {heroInfo?.name}
              </span>
              {localPlayer.hasFlag && (
                <span className="px-1.5 py-0.5 bg-amber-500/30 text-amber-300 text-[9px] font-display rounded">
                  FLAG
                </span>
              )}
            </div>

            {/* Health Bar */}
            <div className="w-40 h-4 bg-black/60 rounded overflow-hidden relative backdrop-blur-sm">
              <div 
                className={`h-full transition-all duration-100 ${isLowHealth ? 'health-bar-low' : 'health-bar'}`}
                style={{ width: `${healthPercent}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-center font-mono text-[11px] text-white text-shadow-sm">
                {Math.ceil(localPlayer.health)}
              </span>
            </div>

            {/* Ultimate Bar */}
            <div className={`w-40 h-2 rounded overflow-hidden relative ${isUltReady ? 'bg-amber-500/30' : 'bg-black/60'}`}>
              <div 
                className={`h-full transition-all duration-150 ${isUltReady ? 'bg-amber-400' : 'bg-violet-500'}`}
                style={{ width: `${Math.min(100, ultimatePercent)}%` }}
              />
              {isUltReady && (
                <span className="absolute inset-0 flex items-center justify-center text-[8px] font-display text-amber-200 tracking-wider animate-pulse-soft">
                  ULTIMATE READY
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Center - Abilities */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-1">
        {Object.entries(localPlayer.abilities).map(([id, ability]) => (
          <AbilityIcon 
            key={id} 
            abilityId={id}
            cooldown={ability.cooldownRemaining}
            charges={ability.charges}
            isActive={ability.isActive}
            heroId={localPlayer.heroId}
          />
        ))}
      </div>

      {/* Bottom Right - Movement Status */}
      <div className="absolute bottom-5 right-5 flex flex-col items-end gap-1">
        {localPlayer.movement.isWallRunning && <MovementTag label="WALL RUN" />}
        {localPlayer.movement.isSliding && <MovementTag label="SLIDE" />}
        {localPlayer.movement.isGrappling && <MovementTag label="GRAPPLE" />}
        {localPlayer.movement.isJetpacking && <MovementTag label="JETPACK" />}
        {localPlayer.movement.isGliding && <MovementTag label="GLIDE" />}
        
        {/* Jetpack Fuel */}
        {localPlayer.heroId === 'blaze' && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[9px] font-body text-white/30 uppercase">Fuel</span>
            <div className="w-14 h-1 bg-white/10 rounded-full overflow-hidden">
              <div 
                className="h-full bg-orange-400 transition-all duration-100"
                style={{ width: `${localPlayer.movement.jetpackFuel}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Flag Carrier Alert */}
      {localPlayer.hasFlag && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 animate-fade-in">
          <div className="px-4 py-2 bg-amber-500/20 border border-amber-500/30 rounded backdrop-blur-sm">
            <span className="font-display text-sm text-amber-300 tracking-wider">
              RETURN TO BASE →
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function AbilityIcon({ abilityId, cooldown, charges, isActive, heroId }: {
  abilityId: string;
  cooldown: number;
  charges: number;
  isActive: boolean;
  heroId: string | null;
}) {
  const onCooldown = cooldown > 0;
  const abilityInfo = ABILITY_DEFINITIONS[abilityId];
  
  const heroInfo = heroId ? HERO_DEFINITIONS[heroId as keyof typeof HERO_DEFINITIONS] : null;
  let keybind = '';
  if (heroInfo) {
    if (heroInfo.ability1.abilityId === abilityId) keybind = 'E';
    else if (heroInfo.ability2.abilityId === abilityId) keybind = 'Q';
    else if (heroInfo.ultimate.abilityId === abilityId) keybind = 'F';
  }
  const isUltimate = keybind === 'F';

  return (
    <div className={`
      relative w-11 h-11 rounded transition-all duration-100
      ${isActive 
        ? 'bg-cyan-500/30 border border-cyan-400' 
        : isUltimate 
          ? 'bg-amber-500/20 border border-amber-500/40'
          : 'bg-strike-surface/90 border border-strike-border'
      }
      backdrop-blur-sm
    `}>
      {/* Keybind */}
      <span className={`absolute top-0.5 left-1 text-[9px] font-mono ${
        isUltimate ? 'text-amber-400' : 'text-white/40'
      }`}>
        {keybind}
      </span>

      {/* Icon */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-display text-sm text-white/50">
          {abilityInfo?.name?.charAt(0)}
        </span>
      </div>

      {/* Cooldown Overlay */}
      {onCooldown && (
        <>
          <div className="absolute inset-0 bg-black/70 rounded" />
          <span className="absolute inset-0 flex items-center justify-center font-mono text-sm text-white font-bold">
            {Math.ceil(cooldown)}
          </span>
        </>
      )}

      {/* Charges */}
      {charges > 1 && !onCooldown && (
        <div className="absolute bottom-0.5 right-0.5 flex gap-0.5">
          {[...Array(charges)].map((_, i) => (
            <div key={i} className="w-1 h-1 bg-cyan-400 rounded-full" />
          ))}
        </div>
      )}
    </div>
  );
}

function MovementTag({ label }: { label: string }) {
  return (
    <div className="px-2 py-1 bg-cyan-500/20 border border-cyan-500/30 rounded backdrop-blur-sm">
      <span className="text-[9px] font-display text-cyan-300 tracking-wider">{label}</span>
    </div>
  );
}
