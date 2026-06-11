import type { MatchMode } from '@voxel-strike/shared';
import { getAntiCheatConfig } from './config';
import { normalizeAntiCheatSignal } from './signal';
import {
  applySignalToRisk,
  buildIntegrityGate,
  createCleanMatchRisk,
  updateMatchRisk,
  type MatchRiskState,
  type PlayerRiskState,
} from './scoring';
import type {
  AntiCheatIntegrityGate,
  AntiCheatRoomAuthorityEvent,
  AntiCheatSignal,
  AntiCheatSignalInput,
} from './types';
import type { AntiCheatEvidenceStore } from './service';

interface AntiCheatRoomRuntimeOptions {
  roomId: string;
  lobbyId: string | null;
  matchMode: MatchMode;
  getMatchId: () => string | null;
  getServerTick: () => number;
  getServerTime: () => number;
  evidenceStore: AntiCheatEvidenceStore;
}

const MAX_ROOM_SIGNALS = 512;

export class AntiCheatRoomRuntime {
  private readonly playerRisk = new Map<string, PlayerRiskState>();
  private matchRisk: MatchRiskState = createCleanMatchRisk();
  private readonly recentSignals: AntiCheatSignal[] = [];

  constructor(private readonly options: AntiCheatRoomRuntimeOptions) {}

  getRecentSignals(): AntiCheatSignal[] {
    return [...this.recentSignals];
  }

  resetMatch(): void {
    this.matchRisk = createCleanMatchRisk();
    this.recentSignals.length = 0;
  }

  setCaseId(caseId: string | null): void {
    if (caseId) this.matchRisk.caseId = caseId;
  }

  record(input: Omit<AntiCheatSignalInput, 'roomId' | 'matchId' | 'lobbyId' | 'matchMode' | 'serverTick' | 'serverTime'>): AntiCheatSignal | null {
    const config = getAntiCheatConfig();
    if (!config.enabled) return null;

    if (input.category === 'client_hint' && !config.clientHintsEnabled) return null;

    const signal = normalizeAntiCheatSignal({
      ...input,
      roomId: this.options.roomId,
      matchId: this.options.getMatchId(),
      lobbyId: this.options.lobbyId,
      matchMode: this.options.matchMode,
      serverTick: this.options.getServerTick(),
      serverTime: this.options.getServerTime(),
    });
    this.recentSignals.push(signal);
    if (this.recentSignals.length > MAX_ROOM_SIGNALS) {
      this.recentSignals.splice(0, this.recentSignals.length - MAX_ROOM_SIGNALS);
    }

    const riskKey = signal.userId ?? signal.playerSessionId ?? '';
    const currentRisk = riskKey ? this.playerRisk.get(riskKey) ?? null : null;
    const { nextRisk, change } = applySignalToRisk(signal, currentRisk, config);
    if (riskKey && nextRisk) this.playerRisk.set(riskKey, nextRisk);
    updateMatchRisk(this.matchRisk, signal, change);

    void this.options.evidenceStore.recordSignal(signal, change)
      .then((result) => {
        if (result.caseId) this.setCaseId(result.caseId);
      });

    return signal;
  }

  recordAuthorityEvent(event: AntiCheatRoomAuthorityEvent & {
    team?: string | null;
    heroId?: string | null;
  }): AntiCheatSignal | null {
    const mapped = mapAuthorityEvent(event);
    return this.record({
      ...mapped,
      source: 'game_room',
      userId: event.userId,
      playerSessionId: event.playerId,
      team: event.team ?? null,
      heroId: event.heroId ?? null,
      movementEpoch: event.movementEpoch,
      movementSequence: event.movementSequence,
      reason: event.reason,
      details: {
        ...event.detail,
        position: event.position,
        authorityEventType: event.type,
      },
    });
  }

  buildIntegrityGate(options: { rankedEligible: boolean; wagered: boolean }): AntiCheatIntegrityGate {
    return buildIntegrityGate(this.matchRisk, getAntiCheatConfig(), {
      matchMode: this.options.matchMode,
      rankedEligible: options.rankedEligible,
      wagered: options.wagered,
    });
  }
}

function mapAuthorityEvent(event: AntiCheatRoomAuthorityEvent): Pick<AntiCheatSignalInput, 'eventType' | 'category' | 'severity' | 'confidence' | 'retentionClass'> {
  if (event.type === 'rate_limit_drop') {
    return { eventType: 'network.rate_limit_drop', category: 'network', severity: 'low', confidence: 0.85, retentionClass: 'short' };
  }
  if (event.type === 'malformed_message') {
    return { eventType: 'network.malformed_message', category: 'network', severity: 'medium', confidence: 0.9 };
  }
  if (event.type === 'movement_correction') {
    const high = event.reason === 'bounds' || event.reason === 'blocked_path' || event.reason === 'invalid_transform';
    return { eventType: 'movement.correction', category: 'movement', severity: high ? 'high' : 'medium', confidence: 0.95 };
  }
  if (event.type === 'movement_command_reject' || event.type === 'movement_command_drop') {
    return { eventType: `movement.${event.type}`, category: 'movement', severity: 'medium', confidence: 0.8 };
  }
  if (event.type === 'movement_authority_barrier') {
    return { eventType: 'movement.authority_barrier', category: 'movement', severity: 'low', confidence: 0.75, retentionClass: 'short' };
  }
  if (event.type === 'objective_suppression') {
    return { eventType: 'objective.suppression', category: 'objective', severity: 'medium', confidence: 0.95 };
  }
  if (event.type === 'objective_carrier_mismatch') {
    return { eventType: 'objective.carrier_mismatch', category: 'objective', severity: 'high', confidence: 0.98 };
  }
  if (event.type.startsWith('objective_')) {
    return { eventType: event.type.replace('_', '.'), category: 'objective', severity: 'low', confidence: 0.7, retentionClass: 'short' };
  }
  if (event.type === 'ability_reject') {
    return { eventType: 'ability.reject', category: 'ability', severity: event.reason?.includes('disabled') ? 'high' : 'medium', confidence: 0.9 };
  }
  if (event.type === 'ignored_projectile_impact') {
    return { eventType: 'combat.ignored_projectile_impact', category: 'combat', severity: 'medium', confidence: 0.9 };
  }
  if (event.type.startsWith('auth_') || event.type.includes('ticket')) {
    return { eventType: `auth.${event.type}`, category: 'auth', severity: 'high', confidence: 0.95 };
  }
  return { eventType: event.type, category: 'client_hint', severity: 'low', confidence: 0.5, retentionClass: 'short' };
}
