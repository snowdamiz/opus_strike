import { AlertTriangle, RefreshCw, Server } from 'lucide-react';
import type { SectionProps } from '../section';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { EmptyState, KeyValue, SectionHeader } from '../common';
import { cn } from '../lib/utils';
import {
  formatBytes,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  titleCase,
  truncateAddress,
} from '../format';

function pressureTone(pressure: number): 'success' | 'warning' | 'danger' {
  if (pressure >= 0.85) return 'danger';
  if (pressure >= 0.6) return 'warning';
  return 'success';
}

const pressureTextClass: Record<'success' | 'warning' | 'danger', string> = {
  success: 'text-ui-success',
  warning: 'text-ui-warning',
  danger: 'text-ui-danger',
};

export function InfrastructureSection({ console }: SectionProps) {
  if (!console.overview) return null;

  const { diagnostics, machines, rooms } = console.overview;
  const gameRooms = rooms?.game ?? [];
  const lobbies = rooms?.lobbies ?? [];
  const warnings = diagnostics.warnings ?? [];
  const refreshing = console.refreshing;

  const fly = diagnostics.flyReplay;
  const flyBadge: { variant: 'success' | 'warning' | 'default'; label: string } =
    fly.enabled && fly.registered
      ? { variant: 'success', label: 'Active' }
      : fly.enabled
        ? { variant: 'warning', label: 'Registered / Idle' }
        : { variant: 'default', label: 'Disabled' };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={Server}
        title="Infrastructure"
        description="Distributed runtime topology, machine telemetry, and active rooms."
        actions={
          <Button size="sm" variant="secondary" onClick={() => void console.refresh()}>
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {/* Diagnostics summary */}
      <Card>
        <CardHeader>
          <CardTitle>Runtime Diagnostics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-8 gap-y-0 sm:grid-cols-2">
            <div className="divide-y divide-strike-border">
              <KeyValue
                label="Runtime Mode"
                value={
                  <Badge variant={diagnostics.distributed ? 'primary' : 'default'}>
                    {diagnostics.distributed ? 'Distributed' : 'Single-node'}
                  </Badge>
                }
              />
              <KeyValue label="Routing Strategy" value={titleCase(diagnostics.routingStrategy)} />
              <KeyValue
                label="Room Create Strategy"
                value={titleCase(diagnostics.roomCreateStrategy)}
              />
              <KeyValue
                label="Local Process ID"
                value={diagnostics.localProcessId ?? '—'}
                mono
              />
            </div>
            <div className="divide-y divide-strike-border">
              <KeyValue
                label="Redis"
                value={
                  <span className="inline-flex items-center gap-2">
                    <Badge variant={diagnostics.redis.ok ? 'success' : 'danger'}>
                      {diagnostics.redis.ok ? 'Healthy' : 'Unhealthy'}
                    </Badge>
                    <span className="text-xs text-white/50">{diagnostics.redis.status}</span>
                  </span>
                }
              />
              {diagnostics.redis.error ? (
                <KeyValue
                  label="Redis Error"
                  value={<span className="text-ui-danger">{diagnostics.redis.error}</span>}
                />
              ) : null}
              <KeyValue
                label="Fly Replay"
                value={<Badge variant={flyBadge.variant}>{flyBadge.label}</Badge>}
              />
              {fly.appName ? <KeyValue label="Fly App" value={fly.appName} mono /> : null}
              {fly.region ? <KeyValue label="Fly Region" value={fly.region} /> : null}
              {fly.machineId ? (
                <KeyValue label="Fly Machine" value={truncateAddress(fly.machineId, 6, 4)} mono />
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Warnings */}
      {warnings.length > 0 ? (
        <Card className="border-ui-warning/30 bg-ui-warning/[0.06]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-ui-warning">
              <AlertTriangle className="h-4 w-4" />
              {warnings.length} Diagnostic {warnings.length === 1 ? 'Warning' : 'Warnings'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {warnings.map((warning, index) => (
                <li
                  key={`${index}-${warning}`}
                  className="flex items-start gap-2.5 text-sm text-white/80"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ui-warning" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Tabs */}
      <Tabs defaultValue="machines">
        <TabsList>
          <TabsTrigger value="machines">Machines</TabsTrigger>
          <TabsTrigger value="game-rooms">Game Rooms</TabsTrigger>
          <TabsTrigger value="lobbies">Lobbies</TabsTrigger>
        </TabsList>

        {/* Machines */}
        <TabsContent value="machines">
          <Card>
            <CardContent className="p-0">
              {machines.length === 0 ? (
                <EmptyState
                  icon={Server}
                  title="No machines reporting"
                  description="No machine telemetry has been sampled in this window."
                  className="m-5"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Machine</TableHead>
                      <TableHead>Procs</TableHead>
                      <TableHead>Players / Bots</TableHead>
                      <TableHead>Rooms</TableHead>
                      <TableHead>Load</TableHead>
                      <TableHead>CPU</TableHead>
                      <TableHead>Event Loop</TableHead>
                      <TableHead>Memory</TableHead>
                      <TableHead>Local CCU</TableHead>
                      <TableHead>Pressure</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {machines.map((machine) => {
                      const tone = pressureTone(machine.capacityPressure);
                      return (
                        <TableRow key={machine.machineId}>
                          <TableCell>
                            <div className="font-mono text-xs text-white/90">
                              {truncateAddress(machine.machineId, 6, 4)}
                            </div>
                            <div className="text-[11px] text-white/40">
                              {machine.region ?? '—'}
                            </div>
                          </TableCell>
                          <TableCell>{formatNumber(machine.processCount)}</TableCell>
                          <TableCell>
                            {formatNumber(machine.playersInGame)} / {formatNumber(machine.botsInGame)}
                          </TableCell>
                          <TableCell>
                            {formatNumber(machine.gameRoomCount)}
                            <span className="text-white/40"> + {formatNumber(machine.lobbyRoomCount)}</span>
                          </TableCell>
                          <TableCell>{formatPercent(machine.loadPct1, 0)}</TableCell>
                          <TableCell>{formatPercent(machine.processCpuUtilization, 0)}</TableCell>
                          <TableCell>{machine.eventLoopDelayP95Ms.toFixed(1)}ms</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatBytes(machine.memoryRssBytes)}
                            <span className="text-white/40">
                              {' '}of {formatBytes(machine.systemTotalMemoryBytes)}
                            </span>
                          </TableCell>
                          <TableCell>{formatNumber(machine.localCcu)}</TableCell>
                          <TableCell>
                            <span className={cn('font-mono text-xs', pressureTextClass[tone])}>
                              {formatPercent(machine.capacityPressure, 0)}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-white/50">
                            {formatRelativeTime(machine.latestUpdatedAtMs)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Game Rooms */}
        <TabsContent value="game-rooms">
          <Card>
            <CardContent className="p-0">
              {gameRooms.length === 0 ? (
                <EmptyState
                  icon={Server}
                  title="No active game rooms"
                  description="There are no game rooms running right now."
                  className="m-5"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Room</TableHead>
                      <TableHead>Machine</TableHead>
                      <TableHead>Phase</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Players</TableHead>
                      <TableHead>Bots</TableHead>
                      <TableHead>Clients</TableHead>
                      <TableHead>Lobby</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {gameRooms.map((room) => (
                      <TableRow key={room.roomId}>
                        <TableCell className="font-mono text-xs text-white/90">
                          {truncateAddress(room.roomId, 6, 4)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-white/70">
                          {truncateAddress(room.machineId, 6, 4)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{titleCase(room.phase)}</Badge>
                        </TableCell>
                        <TableCell>{room.matchMode}</TableCell>
                        <TableCell>{formatNumber(room.players)}</TableCell>
                        <TableCell>{formatNumber(room.bots)}</TableCell>
                        <TableCell>
                          {formatNumber(room.clients)}
                          <span className="text-white/40"> / {formatNumber(room.maxClients)}</span>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-white/70">
                          {room.lobbyId ? truncateAddress(room.lobbyId, 6, 4) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Lobbies */}
        <TabsContent value="lobbies">
          <Card>
            <CardContent className="p-0">
              {lobbies.length === 0 ? (
                <EmptyState
                  icon={Server}
                  title="No active lobbies"
                  description="There are no lobby rooms running right now."
                  className="m-5"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lobby</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Machine</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Humans</TableHead>
                      <TableHead>Bots</TableHead>
                      <TableHead>Participants</TableHead>
                      <TableHead>Visibility</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lobbies.map((lobby) => (
                      <TableRow key={lobby.roomId}>
                        <TableCell className="text-white/90">{lobby.name}</TableCell>
                        <TableCell className="font-mono text-xs text-white/70">
                          {truncateAddress(lobby.roomId, 6, 4)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-white/70">
                          {truncateAddress(lobby.machineId, 6, 4)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{titleCase(lobby.status)}</Badge>
                        </TableCell>
                        <TableCell>{lobby.matchMode}</TableCell>
                        <TableCell>{formatNumber(lobby.humans)}</TableCell>
                        <TableCell>{formatNumber(lobby.bots)}</TableCell>
                        <TableCell>{formatNumber(lobby.participants)}</TableCell>
                        <TableCell>
                          <Badge variant={lobby.isPublic ? 'success' : 'default'}>
                            {lobby.isPublic ? 'Public' : 'Private'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
