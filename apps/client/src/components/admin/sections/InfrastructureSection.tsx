import { useState } from 'react';
import {
  formatAge,
  formatBytes,
  formatCount,
  formatNumber,
  toneForPressure,
} from '../format';
import { EmptyState, Kpi, Meter, Panel, Pill, TableScroll, Td, Th } from '../primitives';
import type { AdminOverview, MachineOverview } from '../types';

export function InfrastructureSection({ overview }: { overview: AdminOverview }) {
  const capacityTone = overview.capacity.full ? 'danger' : toneForPressure(overview.capacity.capacityPressure);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Machines" value={formatNumber(overview.totals.runningMachines)} sub={formatCount(overview.totals.serverProcesses, 'process', 'processes')} tone="info" />
        <Kpi label="Capacity" value={`${formatNumber(overview.capacity.reservedPlayers)} / ${formatNumber(overview.capacity.maxPlayers)}`} sub={`${formatNumber(overview.capacity.availablePlayers)} open · ${overview.capacity.source}`} tone={capacityTone} meter={overview.capacity.capacityPressure} />
        <Kpi label="Rooms" value={formatNumber(overview.totals.gameRooms + overview.totals.lobbyRooms)} sub={`${formatCount(overview.totals.gameRooms, 'game')} · ${formatCount(overview.totals.lobbyRooms, 'lobby', 'lobbies')}`} tone="neutral" />
        <Kpi label="Clients" value={formatNumber(overview.totals.totalConnectedClients)} sub={overview.diagnostics.redis.ok ? 'redis ok' : `redis ${overview.diagnostics.redis.status}`} tone={overview.diagnostics.redis.ok ? 'success' : 'danger'} />
      </div>

      {overview.capacity.full && (
        <div className="ac-alert ac-alert--warning">
          Max in-game players hit: {formatNumber(overview.capacity.reservedPlayers)} / {formatNumber(overview.capacity.maxPlayers)} reserved across {formatNumber(overview.capacity.maxMachines)} machines. Queued players will wait until a match frees space.
        </div>
      )}

      <Diagnostics overview={overview} />

      <Panel title="Machines" meta={`${formatNumber(overview.machines.length)} running`} bleed>
        {overview.machines.length === 0 ? (
          <EmptyState label="No running machines reported." />
        ) : (
          <TableScroll minWidth={920}>
            <thead>
              <tr>
                <Th>Machine</Th>
                <Th>Region</Th>
                <Th right>Players</Th>
                <Th right>Load</Th>
                <Th>Pressure</Th>
                <Th>Updated</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {overview.machines.map((machine) => <MachineRow key={machine.machineId} machine={machine} />)}
            </tbody>
          </TableScroll>
        )}
      </Panel>

      <Panel title="Game rooms" meta={`${formatNumber(overview.rooms.game.length)} active`} bleed>
        {overview.rooms.game.length === 0 ? (
          <EmptyState label="No active game rooms." />
        ) : (
          <TableScroll minWidth={760}>
            <thead>
              <tr>
                <Th>Room</Th>
                <Th>Machine</Th>
                <Th>Phase</Th>
                <Th>Mode</Th>
                <Th right>Players</Th>
                <Th right>Bots</Th>
                <Th right>Clients</Th>
              </tr>
            </thead>
            <tbody>
              {overview.rooms.game.map((room) => (
                <tr key={room.roomId}>
                  <Td mono>{room.roomId}</Td>
                  <Td mono>{room.machineId}</Td>
                  <Td><Pill tone={room.phase === 'playing' ? 'success' : 'neutral'}>{room.phase}</Pill></Td>
                  <Td>{room.matchMode}</Td>
                  <Td right>{formatNumber(room.players)}</Td>
                  <Td right>{formatNumber(room.bots)}</Td>
                  <Td right>{formatNumber(room.clients)} / {formatNumber(room.maxClients)}</Td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </Panel>

      <Panel title="Lobbies" meta={`${formatNumber(overview.rooms.lobbies.length)} active`} bleed>
        {overview.rooms.lobbies.length === 0 ? (
          <EmptyState label="No active lobbies." />
        ) : (
          <TableScroll minWidth={800}>
            <thead>
              <tr>
                <Th>Lobby</Th>
                <Th>Machine</Th>
                <Th>Status</Th>
                <Th>Mode</Th>
                <Th right>Humans</Th>
                <Th right>Bots</Th>
                <Th right>Participants</Th>
              </tr>
            </thead>
            <tbody>
              {overview.rooms.lobbies.map((lobby) => (
                <tr key={lobby.roomId}>
                  <Td>
                    <div>{lobby.name}</div>
                    <div className="ac-mono ac-text-faint mt-1 break-all text-[11px]">{lobby.roomId}</div>
                  </Td>
                  <Td mono>{lobby.machineId}</Td>
                  <Td><Pill tone={lobby.status === 'open' ? 'success' : 'neutral'}>{lobby.status}</Pill></Td>
                  <Td>{lobby.matchMode}</Td>
                  <Td right>{formatNumber(lobby.humans)}</Td>
                  <Td right>{formatNumber(lobby.bots)}</Td>
                  <Td right>{formatNumber(lobby.participants)}</Td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </Panel>
    </div>
  );
}

function MachineRow({ machine }: { machine: MachineOverview }) {
  const [expanded, setExpanded] = useState(false);
  const loadRatio = machine.loadPct1 / 100;
  const loadTone = toneForPressure(loadRatio);
  const pressureTone = toneForPressure(machine.capacityPressure);
  const hasMeasuredCapacity = machine.dynamicCapacitySource === 'live' && machine.gameRoomCount > 0;

  return (
    <>
      <tr>
        <Td mono>
          <div className="break-all">{machine.machineId}</div>
          <div className="ac-text-faint mt-1 text-[11px]">{formatCount(machine.processCount, 'process', 'processes')}</div>
        </Td>
        <Td>{machine.region || 'unknown'}</Td>
        <Td right>
          {formatNumber(machine.playersInGame)}
          <div className="ac-text-faint text-[11px]">
            {hasMeasuredCapacity ? `${formatNumber(Math.max(0, machine.dynamicCapacityPlayers - machine.playersInGame))} open` : 'learning'}
          </div>
        </Td>
        <Td right>
          <Pill tone={loadTone}>{machine.loadPct1.toFixed(0)}%</Pill>
        </Td>
        <Td>
          <div className="flex items-center gap-2">
            <span className="ac-text-muted w-9 text-[11px] tabular-nums">{Math.round(machine.capacityPressure * 100)}%</span>
            <div className="min-w-[80px] flex-1"><Meter value={machine.capacityPressure} tone={pressureTone} /></div>
          </div>
        </Td>
        <Td>{formatAge(machine.latestUpdatedAtMs)}</Td>
        <Td>
          <button type="button" className="ac-btn ac-btn--sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Hide' : 'Detail'}
          </button>
        </Td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{ background: 'var(--ac-surface-3)' }}>
            <div className="grid gap-x-8 gap-y-2 px-4 py-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
              <Detail label="CPU" value={`${(machine.processCpuUtilization * 100).toFixed(0)}% · ${formatNumber(machine.cpuCount)} CPUs`} />
              <Detail label="Load 1m" value={`${machine.loadAvg1.toFixed(2)}`} />
              <Detail label="Event loop p95" value={`${machine.eventLoopDelayP95Ms.toFixed(1)} ms`} />
              <Detail label="Local CCU" value={formatNumber(machine.localCcu)} />
              <Detail label="Memory RSS" value={formatBytes(machine.memoryRssBytes)} />
              <Detail label="System free" value={formatBytes(machine.systemFreeMemoryBytes)} />
              <Detail label="Game rooms" value={formatCount(machine.gameRoomCount, 'game')} />
              <Detail label="Lobbies" value={formatCount(machine.lobbyRoomCount, 'lobby', 'lobbies')} />
            </div>
            {machine.processes.length > 0 && (
              <div className="ac-text-faint px-4 pb-3 text-[11px]">
                Processes: {machine.processes.map((process) => `${process.processId.slice(0, 8)} (${process.localCcu} ccu)`).join(' · ')}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="ac-text-faint uppercase tracking-wide">{label}</span>
      <span className="ac-text-muted ac-mono">{value}</span>
    </div>
  );
}

function Diagnostics({ overview }: { overview: AdminOverview }) {
  const diag = overview.diagnostics;
  const flyActive = diag.flyReplay.enabled || diag.flyReplay.registered;

  return (
    <Panel title="Diagnostics" meta={diag.redis.ok ? 'healthy' : 'attention'} bleed>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3">
        <DiagFact label="Redis" value={diag.redis.status} detail={diag.redis.error || 'Shared runtime state'} tone={diag.redis.ok ? 'success' : 'danger'} />
        <DiagFact label="Runtime" value={diag.distributed ? 'Distributed' : 'Single'} detail={`${diag.routingStrategy} routing · ${diag.roomCreateStrategy} create`} tone={diag.distributed ? 'info' : 'neutral'} />
        <DiagFact
          label="Fly replay"
          value={diag.flyReplay.enabled ? 'Enabled' : 'Off'}
          detail={flyActive ? `${diag.flyReplay.appName ?? 'app'} · ${diag.flyReplay.region ?? 'region unknown'}` : 'Not registered'}
          tone={diag.flyReplay.enabled ? 'success' : 'neutral'}
        />
      </div>
    </Panel>
  );
}

function DiagFact({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'success' | 'danger' | 'info' | 'neutral' }) {
  return (
    <div className="border-b border-[color:var(--ac-border)] p-4 sm:border-r last:border-r-0">
      <div className="flex items-center justify-between gap-2">
        <span className="ac-subhead">{label}</span>
        <Pill tone={tone}>{value}</Pill>
      </div>
      <div className="ac-text-faint mt-2 break-words text-[11px]">{detail}</div>
    </div>
  );
}
