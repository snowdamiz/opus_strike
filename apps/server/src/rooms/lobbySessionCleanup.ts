interface SessionCollection {
  delete(sessionId: string): unknown;
  has?(sessionId: string): boolean;
}

interface IdentityMap {
  get(sessionId: string): string | undefined;
  delete(sessionId: string): unknown;
}

interface ReverseIdentityMap {
  get(identity: string): string | undefined;
  delete(identity: string): unknown;
}

export interface LobbyMapVoteCleanupState {
  votes: SessionCollection;
  previewReadyPlayerIds: SessionCollection;
}

export interface CleanupLobbySessionInput {
  sessionId: string;
  players: SessionCollection;
  playerAuthContexts: SessionCollection;
  playerMatchmakingTickets: SessionCollection;
  playerCompetitiveRatings: SessionCollection;
  sessionIdToIdentity: IdentityMap;
  identityToSessionId: ReverseIdentityMap;
  mapVoteSession?: LobbyMapVoteCleanupState | null;
  clearRateLimitScope(sessionId: string): void;
}

export interface CleanupLobbySessionResult {
  removedPlayer: boolean;
  removedVote: boolean;
  removedPreviewReady: boolean;
  identity: string | undefined;
  removedIdentityMapping: boolean;
}

function deleteFrom(collection: SessionCollection, sessionId: string): boolean {
  const existed = collection.has?.(sessionId) ?? false;
  collection.delete(sessionId);
  return existed;
}

export function cleanupLobbySession(
  input: CleanupLobbySessionInput
): CleanupLobbySessionResult {
  const removedPlayer = deleteFrom(input.players, input.sessionId);
  const removedVote = input.mapVoteSession
    ? deleteFrom(input.mapVoteSession.votes, input.sessionId)
    : false;
  const removedPreviewReady = input.mapVoteSession
    ? deleteFrom(input.mapVoteSession.previewReadyPlayerIds, input.sessionId)
    : false;

  input.playerAuthContexts.delete(input.sessionId);
  input.playerMatchmakingTickets.delete(input.sessionId);
  input.playerCompetitiveRatings.delete(input.sessionId);
  input.clearRateLimitScope(input.sessionId);

  const identity = input.sessionIdToIdentity.get(input.sessionId);
  let removedIdentityMapping = false;
  if (identity && input.identityToSessionId.get(identity) === input.sessionId) {
    input.identityToSessionId.delete(identity);
    removedIdentityMapping = true;
  }
  input.sessionIdToIdentity.delete(input.sessionId);

  return {
    removedPlayer,
    removedVote,
    removedPreviewReady,
    identity,
    removedIdentityMapping,
  };
}
