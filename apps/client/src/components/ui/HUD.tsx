import { useGameStore } from '../../store/gameStore';

export function HUD() {
  const { localPlayer, redScore, blueScore, roundTimeRemaining } = useGameStore();

  if (!localPlayer) return null;

  const healthPercent = (localPlayer.health / localPlayer.maxHealth) * 100;
  const isLowHealth = healthPercent < 30;
  const ultimatePercent = localPlayer.ultimateCharge;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Crosshair */}
      <Crosshair />

      {/* Top bar - Score and time */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-4">
        {/* Red team score */}
        <div className="flex items-center gap-2 px-4 py-2 bg-team-red/20 border border-team-red/50 rounded">
          <span className="font-display text-2xl text-team-red font-bold">{redScore}</span>
          <span className="font-body text-sm text-team-red/80">RED</span>
        </div>

        {/* Timer */}
        <div className="px-6 py-2 bg-voxel-surface/80 border border-voxel-border rounded">
          <span className="font-mono text-2xl text-white">{formatTime(roundTimeRemaining)}</span>
        </div>

        {/* Blue team score */}
        <div className="flex items-center gap-2 px-4 py-2 bg-team-blue/20 border border-team-blue/50 rounded">
          <span className="font-body text-sm text-team-blue/80">BLUE</span>
          <span className="font-display text-2xl text-team-blue font-bold">{blueScore}</span>
        </div>
      </div>

      {/* Bottom left - Health and abilities */}
      <div className="absolute bottom-4 left-4 flex items-end gap-4">
        {/* Hero portrait */}
        <div className="w-20 h-20 bg-voxel-surface border border-voxel-border rounded-lg overflow-hidden">
          <div className="w-full h-full bg-gradient-to-br from-voxel-primary/20 to-voxel-accent/20 flex items-center justify-center">
            <span className="font-display text-2xl text-white/80">
              {localPlayer.heroId?.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>

        {/* Health bar */}
        <div className="flex flex-col gap-2">
          <div className="w-48 h-6 bg-voxel-dark rounded overflow-hidden relative">
            <div 
              className={`h-full transition-all duration-200 ${isLowHealth ? 'health-bar-low' : 'health-bar'}`}
              style={{ width: `${healthPercent}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-display text-sm text-white drop-shadow-lg">
                {Math.ceil(localPlayer.health)} / {localPlayer.maxHealth}
              </span>
            </div>
          </div>

          {/* Ultimate charge */}
          <div className="w-48 h-3 bg-voxel-dark rounded overflow-hidden relative">
            <div 
              className="h-full bg-gradient-to-r from-voxel-accent to-voxel-secondary transition-all duration-200"
              style={{ width: `${ultimatePercent}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-mono text-[10px] text-white/80">
                {ultimatePercent >= 100 ? 'READY' : `${Math.floor(ultimatePercent)}%`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom center - Abilities */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
        {Object.entries(localPlayer.abilities).map(([id, ability]) => (
          <AbilityIcon 
            key={id} 
            abilityId={id}
            cooldown={ability.cooldownRemaining}
            charges={ability.charges}
            isActive={ability.isActive}
          />
        ))}
      </div>

      {/* Bottom right - Movement state indicators */}
      <div className="absolute bottom-4 right-4 flex flex-col items-end gap-1">
        {localPlayer.movement.isWallRunning && (
          <MovementIndicator label="WALL RUN" color="voxel-primary" />
        )}
        {localPlayer.movement.isSliding && (
          <MovementIndicator label="SLIDE" color="voxel-accent" />
        )}
        {localPlayer.movement.isGrappling && (
          <MovementIndicator label="GRAPPLE" color="voxel-secondary" />
        )}
        {localPlayer.movement.isJetpacking && (
          <MovementIndicator label="JETPACK" color="voxel-secondary" />
        )}
        {localPlayer.movement.isGliding && (
          <MovementIndicator label="GLIDE" color="team-blue" />
        )}
        {localPlayer.hasFlag && (
          <MovementIndicator label="FLAG CARRIER" color="yellow-400" pulse />
        )}
      </div>

      {/* Jetpack fuel bar (if applicable) */}
      {localPlayer.heroId === 'blaze' && (
        <div className="absolute bottom-20 right-4">
          <JetpackFuelBar fuel={localPlayer.movement.jetpackFuel} />
        </div>
      )}

      {/* Kill feed would go here */}
      <div className="absolute top-20 right-4 w-64">
        {/* Kill feed entries */}
      </div>
    </div>
  );
}

function Crosshair() {
  return (
    <div className="crosshair">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        {/* Center dot */}
        <circle cx="12" cy="12" r="2" fill="white" fillOpacity="0.9" />
        {/* Lines */}
        <line x1="12" y1="4" x2="12" y2="9" stroke="white" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.8" />
        <line x1="12" y1="15" x2="12" y2="20" stroke="white" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.8" />
        <line x1="4" y1="12" x2="9" y2="12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.8" />
        <line x1="15" y1="12" x2="20" y2="12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.8" />
      </svg>
    </div>
  );
}

interface AbilityIconProps {
  abilityId: string;
  cooldown: number;
  charges: number;
  isActive: boolean;
}

function AbilityIcon({ abilityId, cooldown, charges, isActive }: AbilityIconProps) {
  const onCooldown = cooldown > 0;
  const cooldownPercent = onCooldown ? Math.min(100, (cooldown / 10) * 100) : 0;

  return (
    <div 
      className={`
        w-14 h-14 relative rounded-lg overflow-hidden border-2 transition-all duration-200
        ${isActive ? 'border-voxel-primary shadow-lg shadow-voxel-primary/50 scale-110' : 'border-voxel-border'}
        ${onCooldown ? 'opacity-60' : ''}
      `}
    >
      <div className="w-full h-full bg-voxel-surface flex items-center justify-center">
        <span className="font-display text-lg text-white/60">
          {abilityId.split('_')[1]?.charAt(0).toUpperCase()}
        </span>
      </div>

      {/* Cooldown overlay */}
      {onCooldown && (
        <div 
          className="absolute inset-0 bg-black/60"
          style={{ 
            clipPath: `inset(${100 - cooldownPercent}% 0 0 0)` 
          }}
        />
      )}

      {/* Cooldown text */}
      {onCooldown && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-sm text-white font-bold">
            {Math.ceil(cooldown)}
          </span>
        </div>
      )}

      {/* Charges */}
      {charges > 1 && (
        <div className="absolute bottom-0.5 right-0.5 px-1 bg-voxel-primary rounded text-[10px] font-bold text-voxel-dark">
          {charges}
        </div>
      )}
    </div>
  );
}

interface MovementIndicatorProps {
  label: string;
  color: string;
  pulse?: boolean;
}

function MovementIndicator({ label, color, pulse }: MovementIndicatorProps) {
  return (
    <div 
      className={`
        px-2 py-1 rounded text-xs font-display tracking-wider
        bg-${color}/20 text-${color} border border-${color}/50
        ${pulse ? 'animate-pulse' : ''}
      `}
    >
      {label}
    </div>
  );
}

interface JetpackFuelBarProps {
  fuel: number;
}

function JetpackFuelBar({ fuel }: JetpackFuelBarProps) {
  const fuelPercent = (fuel / 100) * 100;
  
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="font-mono text-xs text-voxel-secondary">FUEL</span>
      <div className="w-24 h-2 bg-voxel-dark rounded overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-voxel-secondary to-yellow-400 transition-all duration-100"
          style={{ width: `${fuelPercent}%` }}
        />
      </div>
    </div>
  );
}

