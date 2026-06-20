import type { Team } from '@voxel-strike/shared';
import { isRecord, isTeam, sanitizeShortText } from './protocolValidation';

export interface VoiceTokenPlayerSnapshot {
  name: string;
  team: string | null | undefined;
  state: string;
  isBot: boolean;
}

export type PreparedMatchVoiceTokenRequest =
  | {
      ok: true;
      requestId: string;
      identity: string;
      displayName: string;
      team: Team;
      human: true;
      canPublish: boolean;
    }
  | {
      ok: false;
      requestId: string;
      reason: string;
    };

export function normalizeVoiceTeam(team: string | null | undefined): Team | null {
  return isTeam(team) ? team : null;
}

export function prepareMatchVoiceTokenRequest(input: {
  payload: unknown;
  player: VoiceTokenPlayerSnapshot | null | undefined;
  identity: string | null | undefined;
}): PreparedMatchVoiceTokenRequest {
  const requestId = isRecord(input.payload)
    ? sanitizeShortText(input.payload.requestId, 80)
    : null;

  if (!requestId) {
    return { ok: false, requestId: 'invalid', reason: 'invalid voice token request' };
  }

  if (isRecord(input.payload) && input.payload.scope !== undefined && input.payload.scope !== 'match') {
    return { ok: false, requestId, reason: 'unsupported voice scope' };
  }

  const { player } = input;
  if (!player) {
    return { ok: false, requestId, reason: 'not in game room' };
  }

  if (player.isBot) {
    return { ok: false, requestId, reason: 'bots cannot join voice' };
  }

  const team = normalizeVoiceTeam(player.team);
  if (!team) {
    return { ok: false, requestId, reason: 'player has no voice team' };
  }

  if (!input.identity) {
    return { ok: false, requestId, reason: 'Authentication required' };
  }

  return {
    ok: true,
    requestId,
    identity: input.identity,
    displayName: player.name,
    team,
    human: true,
    canPublish: player.state !== 'spectating',
  };
}
