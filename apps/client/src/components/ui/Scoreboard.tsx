import { useGameStore } from '../../store/gameStore';
import type { Team, Player } from '@voxel-strike/shared';

export function Scoreboard() {
  const { players, localPlayer, redScore, blueScore } = useGameStore();

  const redPlayers = Array.from(players.values()).filter(p => p.team === 'red');
  const bluePlayers = Array.from(players.values()).filter(p => p.team === 'blue');

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm z-40 pointer-events-none">
      <div className="w-full max-w-4xl mx-8 bg-voxel-surface/95 border border-voxel-border rounded-lg overflow-hidden">
        {/* Header with scores */}
        <div className="flex items-center justify-between p-4 bg-voxel-dark border-b border-voxel-border">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-team-red/20 border-2 border-team-red rounded flex items-center justify-center">
              <span className="font-display text-2xl text-team-red font-bold">{redScore}</span>
            </div>
            <span className="font-display text-xl text-team-red">RED TEAM</span>
          </div>

          <span className="font-display text-2xl text-gray-500">VS</span>

          <div className="flex items-center gap-4">
            <span className="font-display text-xl text-team-blue">BLUE TEAM</span>
            <div className="w-12 h-12 bg-team-blue/20 border-2 border-team-blue rounded flex items-center justify-center">
              <span className="font-display text-2xl text-team-blue font-bold">{blueScore}</span>
            </div>
          </div>
        </div>

        {/* Player lists */}
        <div className="flex">
          {/* Red team */}
          <div className="flex-1 border-r border-voxel-border">
            <TeamHeader team="red" />
            <div className="divide-y divide-voxel-border/50">
              {redPlayers.map(player => (
                <PlayerRow 
                  key={player.id} 
                  player={player} 
                  isLocal={player.id === localPlayer?.id}
                />
              ))}
              {redPlayers.length === 0 && (
                <div className="p-4 text-center text-gray-500 font-body">No players</div>
              )}
            </div>
          </div>

          {/* Blue team */}
          <div className="flex-1">
            <TeamHeader team="blue" />
            <div className="divide-y divide-voxel-border/50">
              {bluePlayers.map(player => (
                <PlayerRow 
                  key={player.id} 
                  player={player}
                  isLocal={player.id === localPlayer?.id}
                />
              ))}
              {bluePlayers.length === 0 && (
                <div className="p-4 text-center text-gray-500 font-body">No players</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-voxel-dark border-t border-voxel-border text-center">
          <span className="font-body text-sm text-gray-500">
            Press <span className="text-voxel-primary">TAB</span> to close
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
    <div className={`grid grid-cols-6 gap-2 px-4 py-2 text-xs font-display tracking-wider ${isRed ? 'bg-team-red/10' : 'bg-team-blue/10'}`}>
      <span className={`col-span-2 ${isRed ? 'text-team-red' : 'text-team-blue'}`}>PLAYER</span>
      <span className="text-gray-500 text-center">K</span>
      <span className="text-gray-500 text-center">D</span>
      <span className="text-gray-500 text-center">A</span>
      <span className="text-gray-500 text-center">FLAGS</span>
    </div>
  );
}

interface PlayerRowProps {
  player: Player;
  isLocal: boolean;
}

function PlayerRow({ player, isLocal }: PlayerRowProps) {
  const stats = player.stats ?? { kills: 0, deaths: 0, assists: 0, flagCaptures: 0, flagReturns: 0 };
  
  return (
    <div className={`grid grid-cols-6 gap-2 px-4 py-3 items-center ${isLocal ? 'bg-voxel-primary/10' : ''}`}>
      <div className="col-span-2 flex items-center gap-2">
        {/* Hero icon placeholder */}
        <div className="w-8 h-8 bg-voxel-dark rounded flex items-center justify-center">
          <span className="font-display text-sm text-gray-500">
            {player.heroId?.charAt(0).toUpperCase() ?? '?'}
          </span>
        </div>
        <div>
          <span className={`font-body ${isLocal ? 'text-voxel-primary' : 'text-white'}`}>
            {player.name}
            {isLocal && <span className="text-voxel-primary/60 ml-1">(you)</span>}
          </span>
          {player.hasFlag && (
            <span className="ml-2 px-1 py-0.5 bg-yellow-500/20 text-yellow-400 text-[10px] font-display rounded">
              FLAG
            </span>
          )}
        </div>
      </div>
      <span className="font-mono text-center text-gray-300">{stats.kills}</span>
      <span className="font-mono text-center text-gray-300">{stats.deaths}</span>
      <span className="font-mono text-center text-gray-300">{stats.assists}</span>
      <span className="font-mono text-center text-voxel-primary">{stats.flagCaptures}</span>
    </div>
  );
}

