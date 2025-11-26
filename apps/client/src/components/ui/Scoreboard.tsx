import { useGameStore } from '../../store/gameStore';
import type { Team, Player } from '@voxel-strike/shared';

export function Scoreboard() {
  const { players, localPlayer, redScore, blueScore } = useGameStore();

  const redPlayers = Array.from(players.values()).filter(p => p.team === 'red');
  const bluePlayers = Array.from(players.values()).filter(p => p.team === 'blue');

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-40 pointer-events-none">
      <div className="w-full max-w-3xl mx-8 card overflow-hidden animate-scale-in">
        {/* Header with scores */}
        <div className="flex items-center justify-between p-4 bg-strike-elevated/50 border-b border-strike-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-500/20 border border-red-500/50 rounded flex items-center justify-center">
              <span className="font-display text-xl text-red-400">{redScore}</span>
            </div>
            <span className="font-display text-lg text-red-400">RED</span>
          </div>

          <span className="font-display text-xl text-white/30">VS</span>

          <div className="flex items-center gap-3">
            <span className="font-display text-lg text-blue-400">BLUE</span>
            <div className="w-10 h-10 bg-blue-500/20 border border-blue-500/50 rounded flex items-center justify-center">
              <span className="font-display text-xl text-blue-400">{blueScore}</span>
            </div>
          </div>
        </div>

        {/* Player lists */}
        <div className="flex">
          {/* Red team */}
          <div className="flex-1 border-r border-strike-border">
            <TeamHeader team="red" />
            <div className="divide-y divide-white/5">
              {redPlayers.map(player => (
                <PlayerRow 
                  key={player.id} 
                  player={player} 
                  isLocal={player.id === localPlayer?.id}
                  team="red"
                />
              ))}
              {redPlayers.length === 0 && (
                <div className="p-4 text-center text-white/30 font-body text-sm">No players</div>
              )}
            </div>
          </div>

          {/* Blue team */}
          <div className="flex-1">
            <TeamHeader team="blue" />
            <div className="divide-y divide-white/5">
              {bluePlayers.map(player => (
                <PlayerRow 
                  key={player.id} 
                  player={player}
                  isLocal={player.id === localPlayer?.id}
                  team="blue"
                />
              ))}
              {bluePlayers.length === 0 && (
                <div className="p-4 text-center text-white/30 font-body text-sm">No players</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-strike-elevated/30 border-t border-strike-border text-center">
          <span className="font-body text-xs text-white/30">
            Press <span className="text-white/50">TAB</span> to close
          </span>
        </div>
      </div>
    </div>
  );
}

interface TeamHeaderProps {
  team: Team;
}

function TeamHeader({ team }: TeamHeaderProps) {
  const isRed = team === 'red';

  return (
    <div className={`grid grid-cols-6 gap-2 px-4 py-2 text-[10px] font-body uppercase tracking-wider ${isRed ? 'bg-red-500/10' : 'bg-blue-500/10'}`}>
      <span className={`col-span-2 ${isRed ? 'text-red-400' : 'text-blue-400'}`}>Player</span>
      <span className="text-white/30 text-center">K</span>
      <span className="text-white/30 text-center">D</span>
      <span className="text-white/30 text-center">A</span>
      <span className="text-white/30 text-center">Flags</span>
    </div>
  );
}

interface PlayerRowProps {
  player: Player;
  isLocal: boolean;
  team: Team;
}

function PlayerRow({ player, isLocal, team }: PlayerRowProps) {
  const stats = player.stats ?? { kills: 0, deaths: 0, assists: 0, flagCaptures: 0, flagReturns: 0 };
  const isRed = team === 'red';
  
  return (
    <div className={`grid grid-cols-6 gap-2 px-4 py-2.5 items-center ${isLocal ? 'bg-white/5' : ''}`}>
      <div className="col-span-2 flex items-center gap-2">
        {/* Hero icon */}
        <div className={`w-7 h-7 rounded flex items-center justify-center ${isRed ? 'bg-red-500/20' : 'bg-blue-500/20'}`}>
          <span className={`font-display text-sm ${isRed ? 'text-red-300' : 'text-blue-300'}`}>
            {player.heroId?.charAt(0).toUpperCase() ?? '?'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`font-body text-sm truncate ${isLocal ? 'text-white' : 'text-white/70'}`}>
            {player.name}
          </span>
          {isLocal && (
            <span className="px-1 py-0.5 bg-orange-500/20 text-orange-400 text-[9px] font-display rounded shrink-0">YOU</span>
          )}
          {player.hasFlag && (
            <span className="px-1 py-0.5 bg-amber-500/20 text-amber-300 text-[9px] font-display rounded shrink-0">FLAG</span>
          )}
        </div>
      </div>
      <span className="font-mono text-xs text-center text-white/60">{stats.kills}</span>
      <span className="font-mono text-xs text-center text-white/60">{stats.deaths}</span>
      <span className="font-mono text-xs text-center text-white/60">{stats.assists}</span>
      <span className="font-mono text-xs text-center text-orange-400">{stats.flagCaptures}</span>
    </div>
  );
}
