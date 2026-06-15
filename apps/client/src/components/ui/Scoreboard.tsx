import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useShallow } from 'zustand/shallow';
import type { Team, Player } from '@voxel-strike/shared';
import { FACTIONS } from '../../styles/colorTokens';
import { useVoiceStore, type VoiceParticipant } from '../../store/voiceStore';
import { RankBadge } from './RankBadge';
import { useNetwork } from '../../contexts/NetworkContext';

// Solar Icon
function SolarIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path d="M12 3V6M12 18V21M3 12H6M18 12H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5.64 5.64L7.76 7.76M16.24 16.24L18.36 18.36M5.64 18.36L7.76 16.24M16.24 7.76L18.36 5.64" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Void Icon
function VoidIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <path d="M12 3C7.03 3 3 7.03 3 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2" />
      <path d="M21 12C21 16.97 16.97 21 12 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2" />
    </svg>
  );
}

export function Scoreboard() {
  const { reportPlayer } = useNetwork();
  const [reportingPlayerId, setReportingPlayerId] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const { players, localPlayer, playerPings, redScore, blueScore } = useGameStore(
    useShallow(state => ({
      players: state.players,
      localPlayer: state.localPlayer,
      playerPings: state.playerPings,
      redScore: state.redScore,
      blueScore: state.blueScore,
    }))
  );
  const { participants, mutedPlayerIds, togglePlayerMute } = useVoiceStore(
    useShallow(state => ({
      participants: state.participants,
      mutedPlayerIds: state.mutedPlayerIds,
      togglePlayerMute: state.togglePlayerMute,
    }))
  );

  const voiceByPlayerId = useMemo(() => new Map(
    Array.from(participants.values())
      .filter(participant => participant.playerId)
      .map(participant => [participant.playerId, participant])
  ), [participants]);

  const solarPlayers: Player[] = [];
  const voidPlayers: Player[] = [];
  for (const player of players.values()) {
    if (player.team === 'red') {
      solarPlayers.push(player);
    } else if (player.team === 'blue') {
      voidPlayers.push(player);
    }
  }

  const handleReportPlayer = async (player: Player) => {
    if (reportingPlayerId) return;
    const details = window.prompt(`Report ${player.name} for cheating`, '');
    if (details === null) return;

    setReportingPlayerId(player.id);
    setReportNotice(null);
    try {
      await reportPlayer(player.id, 'cheating', details);
      setReportNotice(`Report submitted for ${player.name}.`);
    } catch (error) {
      setReportNotice(error instanceof Error ? error.message : 'Report failed.');
    } finally {
      setReportingPlayerId(null);
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md z-40 pointer-events-auto">
      <div
        className="w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl mx-4 lg:mx-6 xl:mx-8 rounded-2xl overflow-hidden animate-scale-in"
        style={{
          background: 'linear-gradient(180deg, rgb(var(--color-strike-elevated) / 0.98) 0%, rgb(var(--color-strike-bg) / 0.98) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 25px 80px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* Header with scores */}
        <div 
          className="flex items-center justify-between px-6 py-4"
          style={{
            background: 'linear-gradient(90deg, rgb(var(--color-accent-primary) / 0.15) 0%, rgb(var(--color-strike-elevated) / 0.9) 50%, rgb(var(--color-accent-secondary) / 0.15) 100%)',
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
                  canMuteVoice={player.team === localPlayer?.team && player.id !== localPlayer?.id && !player.isBot}
                  voiceParticipant={voiceByPlayerId.get(player.id) ?? null}
                  voiceMuted={mutedPlayerIds.has(player.id)}
                  onToggleVoiceMute={() => togglePlayerMute(player.id)}
                  canReport={player.id !== localPlayer?.id && !player.isBot}
                  isReporting={reportingPlayerId === player.id}
                  onReport={() => void handleReportPlayer(player)}
                  pingMs={playerPings.get(player.id) ?? null}
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
                  canMuteVoice={player.team === localPlayer?.team && player.id !== localPlayer?.id && !player.isBot}
                  voiceParticipant={voiceByPlayerId.get(player.id) ?? null}
                  voiceMuted={mutedPlayerIds.has(player.id)}
                  onToggleVoiceMute={() => togglePlayerMute(player.id)}
                  canReport={player.id !== localPlayer?.id && !player.isBot}
                  isReporting={reportingPlayerId === player.id}
                  onReport={() => void handleReportPlayer(player)}
                  pingMs={playerPings.get(player.id) ?? null}
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
            {reportNotice || <>Press <span className="text-white/50 font-mono">TAB</span> to close</>}
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
      className="grid grid-cols-9 gap-2 px-4 py-2.5 text-[10px] font-body uppercase tracking-wider"
      style={{ background: faction.bgColor }}
    >
      <span className="col-span-2" style={{ color: faction.primaryColor }}>Warrior</span>
      <span className="text-white/40 text-center">K</span>
      <span className="text-white/40 text-center">D</span>
      <span className="text-white/40 text-center">A</span>
      <span className="text-white/40 text-center">Flags</span>
      <span className="text-white/40 text-center">Ping</span>
      <span className="text-white/40 text-center">Voice</span>
      <span className="text-white/40 text-center">Report</span>
    </div>
  );
}

interface PlayerRowProps {
  player: Player;
  isLocal: boolean;
  faction: typeof FACTIONS.red | typeof FACTIONS.blue;
  canMuteVoice: boolean;
  voiceParticipant: VoiceParticipant | null;
  voiceMuted: boolean;
  onToggleVoiceMute: () => void;
  canReport: boolean;
  isReporting: boolean;
  onReport: () => void;
  pingMs: number | null;
}

function PlayerRow({
  player,
  isLocal,
  faction,
  canMuteVoice,
  voiceParticipant,
  voiceMuted,
  onToggleVoiceMute,
  canReport,
  isReporting,
  onReport,
  pingMs,
}: PlayerRowProps) {
  const stats = player.stats ?? { kills: 0, deaths: 0, assists: 0, flagCaptures: 0, flagReturns: 0 };
  
  return (
    <div 
      className={`grid grid-cols-9 gap-2 px-4 py-3 items-center transition-colors ${
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
            {player.isBot && (
              <span className="px-1.5 py-0.5 text-[8px] font-display rounded shrink-0 bg-cyan-500/15 text-cyan-300 border border-cyan-500/25">
                AI
              </span>
            )}
          </div>
          {!player.isBot && player.rank && (
            <RankBadge rank={player.rank} compact className="mt-1 max-w-[8rem] py-0.5 text-[10px]" />
          )}
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
        style={{ color: stats.flagCaptures > 0 ? FACTIONS.red.secondaryColor : 'rgba(255,255,255,0.3)' }}
      >
        {stats.flagCaptures}
      </span>
      <span className={`font-mono text-xs text-center ${getPingClassName(player, pingMs)}`}>
        {formatPing(player, pingMs)}
      </span>
      <div className="flex justify-center">
        {canMuteVoice ? (
          <button
            type="button"
            title={voiceMuted ? 'Unmute voice' : 'Mute voice'}
            onClick={(event) => {
              event.stopPropagation();
              onToggleVoiceMute();
            }}
            className={`h-7 w-7 rounded-md border flex items-center justify-center transition-colors ${
              voiceMuted
                ? 'border-red-300/35 bg-red-500/15 text-red-200'
                : voiceParticipant?.isSpeaking
                  ? 'border-emerald-300/45 bg-emerald-400/15 text-emerald-200'
                  : 'border-white/10 bg-white/5 text-white/45 hover:text-white/80 hover:bg-white/10'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3a3 3 0 00-3 3v5a3 3 0 006 0V6a3 3 0 00-3-3z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 10v1a7 7 0 0014 0v-1M12 18v3M8 21h8" />
              {voiceMuted && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 4l16 16" />}
            </svg>
          </button>
        ) : (
          <span className="text-white/18">-</span>
        )}
      </div>
      <div className="flex justify-center">
        {canReport ? (
          <button
            type="button"
            title="Report cheating"
            disabled={isReporting}
            onClick={(event) => {
              event.stopPropagation();
              onReport();
            }}
            className="h-7 rounded-md border border-amber-300/20 bg-amber-400/10 px-2 font-display text-[9px] uppercase tracking-wider text-amber-100/75 transition hover:border-amber-200/45 hover:bg-amber-300/18 hover:text-white disabled:cursor-wait disabled:opacity-55"
          >
            {isReporting ? '...' : 'Report'}
          </button>
        ) : (
          <span className="text-white/18">-</span>
        )}
      </div>
    </div>
  );
}

function formatPing(player: Player, pingMs: number | null): string {
  if (player.isBot) return '-';
  return pingMs === null ? '--' : `${pingMs}`;
}

function getPingClassName(player: Player, pingMs: number | null): string {
  if (player.isBot || pingMs === null) return 'text-white/25';
  if (pingMs < 80) return 'text-emerald-300/85';
  if (pingMs < 140) return 'text-amber-300/85';
  return 'text-red-300/85';
}
