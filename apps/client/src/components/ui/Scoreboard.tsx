import { useGameStore } from '../../store/gameStore';
import type { Team, Player } from '@voxel-strike/shared';

// Faction definitions
const FACTIONS = {
  red: {
    name: 'SOLAR',
    fullName: 'SOLAR VANGUARD',
    primaryColor: '#f97316',
    secondaryColor: '#fbbf24',
    glowColor: 'rgba(249, 115, 22, 0.4)',
    bgColor: 'rgba(249, 115, 22, 0.1)',
    borderColor: 'rgba(249, 115, 22, 0.3)',
  },
  blue: {
    name: 'VOID',
    fullName: 'VOID LEGION',
    primaryColor: '#06b6d4',
    secondaryColor: '#8b5cf6',
    glowColor: 'rgba(6, 182, 212, 0.4)',
    bgColor: 'rgba(6, 182, 212, 0.1)',
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
} as const;

// Solar Icon
function SolarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path d="M12 3V6M12 18V21M3 12H6M18 12H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5.64 5.64L7.76 7.76M16.24 16.24L18.36 18.36M5.64 18.36L7.76 16.24M16.24 7.76L18.36 5.64" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Void Icon
function VoidIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <path d="M12 3C7.03 3 3 7.03 3 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2" />
      <path d="M21 12C21 16.97 16.97 21 12 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2" />
    </svg>
  );
}

export function Scoreboard() {
  const { players, localPlayer, redScore, blueScore } = useGameStore();

  const solarPlayers = Array.from(players.values()).filter(p => p.team === 'red');
  const voidPlayers = Array.from(players.values()).filter(p => p.team === 'blue');

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md z-40 pointer-events-none">
      <div 
        className="w-full max-w-4xl mx-8 rounded-2xl overflow-hidden animate-scale-in"
        style={{
          background: 'linear-gradient(180deg, rgba(15, 15, 25, 0.98) 0%, rgba(10, 10, 18, 0.98) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 25px 80px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* Header with scores */}
        <div 
          className="flex items-center justify-between px-6 py-4"
          style={{
            background: 'linear-gradient(90deg, rgba(249, 115, 22, 0.15) 0%, rgba(15,15,25,0.9) 50%, rgba(6, 182, 212, 0.15) 100%)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          }}
        >
          {/* Solar Vanguard */}
          <div className="flex items-center gap-4">
            <div 
              className="w-14 h-14 rounded-xl flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${FACTIONS.red.primaryColor}, ${FACTIONS.red.secondaryColor})`,
                boxShadow: `0 0 25px ${FACTIONS.red.glowColor}`,
              }}
            >
              <span className="font-display text-2xl text-white">{redScore}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <SolarIcon className="w-5 h-5" style={{ color: FACTIONS.red.primaryColor }} />
                <span className="font-display text-xl" style={{ color: FACTIONS.red.primaryColor }}>
                  {FACTIONS.red.name}
                </span>
              </div>
              <span className="text-[10px] text-white/30 font-body tracking-wider">
                {FACTIONS.red.fullName}
              </span>
            </div>
          </div>

          {/* VS Badge */}
          <div 
            className="w-16 h-16 rounded-xl rotate-45 flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <span className="font-display text-xl text-white/60 -rotate-45">VS</span>
          </div>

          {/* Void Legion */}
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="flex items-center justify-end gap-2">
                <span className="font-display text-xl" style={{ color: FACTIONS.blue.primaryColor }}>
                  {FACTIONS.blue.name}
                </span>
                <VoidIcon className="w-5 h-5" style={{ color: FACTIONS.blue.primaryColor }} />
              </div>
              <span className="text-[10px] text-white/30 font-body tracking-wider">
                {FACTIONS.blue.fullName}
              </span>
            </div>
            <div 
              className="w-14 h-14 rounded-xl flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${FACTIONS.blue.primaryColor}, ${FACTIONS.blue.secondaryColor})`,
                boxShadow: `0 0 25px ${FACTIONS.blue.glowColor}`,
              }}
            >
              <span className="font-display text-2xl text-white">{blueScore}</span>
            </div>
          </div>
        </div>

        {/* Player lists */}
        <div className="flex">
          {/* Solar team */}
          <div className="flex-1 border-r border-white/5">
            <FactionHeader faction={FACTIONS.red} />
            <div className="divide-y divide-white/5">
              {solarPlayers.map(player => (
                <PlayerRow 
                  key={player.id} 
                  player={player} 
                  isLocal={player.id === localPlayer?.id}
                  faction={FACTIONS.red}
                />
              ))}
              {solarPlayers.length === 0 && (
                <div className="p-6 text-center">
                  <SolarIcon className="w-8 h-8 mx-auto mb-2" style={{ color: `${FACTIONS.red.primaryColor}30` }} />
                  <p className="text-white/20 font-body text-sm">No warriors</p>
                </div>
              )}
            </div>
          </div>

          {/* Void team */}
          <div className="flex-1">
            <FactionHeader faction={FACTIONS.blue} />
            <div className="divide-y divide-white/5">
              {voidPlayers.map(player => (
                <PlayerRow 
                  key={player.id} 
                  player={player}
                  isLocal={player.id === localPlayer?.id}
                  faction={FACTIONS.blue}
                />
              ))}
              {voidPlayers.length === 0 && (
                <div className="p-6 text-center">
                  <VoidIcon className="w-8 h-8 mx-auto mb-2" style={{ color: `${FACTIONS.blue.primaryColor}30` }} />
                  <p className="text-white/20 font-body text-sm">No warriors</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div 
          className="px-4 py-3 text-center"
          style={{
            background: 'rgba(0, 0, 0, 0.3)',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          }}
        >
          <span className="font-body text-xs text-white/30">
            Press <span className="text-white/50 font-mono">TAB</span> to close
          </span>
        </div>
      </div>
    </div>
  );
}

interface FactionHeaderProps {
  faction: typeof FACTIONS.red | typeof FACTIONS.blue;
}

function FactionHeader({ faction }: FactionHeaderProps) {
  return (
    <div 
      className="grid grid-cols-6 gap-2 px-4 py-2.5 text-[10px] font-body uppercase tracking-wider"
      style={{ background: faction.bgColor }}
    >
      <span className="col-span-2" style={{ color: faction.primaryColor }}>Warrior</span>
      <span className="text-white/40 text-center">K</span>
      <span className="text-white/40 text-center">D</span>
      <span className="text-white/40 text-center">A</span>
      <span className="text-white/40 text-center">Flags</span>
    </div>
  );
}

interface PlayerRowProps {
  player: Player;
  isLocal: boolean;
  faction: typeof FACTIONS.red | typeof FACTIONS.blue;
}

function PlayerRow({ player, isLocal, faction }: PlayerRowProps) {
  const stats = player.stats ?? { kills: 0, deaths: 0, assists: 0, flagCaptures: 0, flagReturns: 0 };
  
  return (
    <div 
      className={`grid grid-cols-6 gap-2 px-4 py-3 items-center transition-colors ${
        isLocal ? 'bg-white/[0.06]' : 'hover:bg-white/[0.02]'
      }`}
    >
      <div className="col-span-2 flex items-center gap-3">
        {/* Hero avatar */}
        <div 
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${faction.primaryColor}, ${faction.secondaryColor})`,
            boxShadow: isLocal ? `0 0 15px ${faction.glowColor}` : undefined,
          }}
        >
          <span className="font-display text-sm text-white">
            {player.heroId?.charAt(0).toUpperCase() ?? '?'}
          </span>
        </div>
        
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`font-display text-sm truncate ${isLocal ? 'text-white' : 'text-white/80'}`}>
              {player.name}
            </span>
            {isLocal && (
              <span 
                className="px-1.5 py-0.5 text-[8px] font-display rounded shrink-0"
                style={{
                  background: `${faction.primaryColor}30`,
                  color: faction.primaryColor,
                  border: `1px solid ${faction.primaryColor}50`,
                }}
              >
                YOU
              </span>
            )}
          </div>
          {player.hasFlag && (
            <span className="text-[9px] text-amber-400 font-display flex items-center gap-1">
              <span>🏴</span> Carrying Flag
            </span>
          )}
        </div>
      </div>
      
      <span className="font-mono text-sm text-center text-white/70">{stats.kills}</span>
      <span className="font-mono text-sm text-center text-white/50">{stats.deaths}</span>
      <span className="font-mono text-sm text-center text-white/50">{stats.assists}</span>
      <span 
        className="font-mono text-sm text-center font-medium"
        style={{ color: stats.flagCaptures > 0 ? '#fbbf24' : 'rgba(255,255,255,0.3)' }}
      >
        {stats.flagCaptures}
      </span>
    </div>
  );
}
