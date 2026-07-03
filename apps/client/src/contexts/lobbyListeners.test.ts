import assert from 'node:assert/strict';
import type { Room } from 'colyseus.js';
import { setupLobbyListeners } from './lobbyListeners';
import { useGameStore } from '../store/gameStore';

type LeaveHandler = (code?: number) => void;

class FakeLobbyRoom {
  readonly id: string;
  readonly sessionId: string;
  private readonly leaveHandlers: LeaveHandler[] = [];

  constructor(id: string, sessionId: string) {
    this.id = id;
    this.sessionId = sessionId;
  }

  onMessage(): void {}
  onError(): void {}

  onLeave(handler: LeaveHandler): void {
    this.leaveHandlers.push(handler);
  }

  emitLeave(code = 1000): void {
    for (const handler of this.leaveHandlers) {
      handler(code);
    }
  }
}

function asRoom(room: FakeLobbyRoom): Room {
  return room as unknown as Room;
}

function primeLobbyState(lobbyId: string): void {
  useGameStore.setState({
    appPhase: 'in_lobby',
    currentLobbyId: lobbyId,
    currentLobbyName: `Lobby ${lobbyId}`,
    lobbyPlayers: new Map(),
  });
}

{
  const staleRoom = new FakeLobbyRoom('old-room', 'old-session');
  const currentRoom = new FakeLobbyRoom('new-room', 'new-session');
  const lobbyRoomRef = { current: asRoom(currentRoom) };
  let leaveLobbyCalls = 0;

  primeLobbyState('new-room');
  setupLobbyListeners(asRoom(staleRoom), {
    playerName: 'Player',
    lobbyRoomRef,
    joinGameRoom: async () => {},
    leaveLobby: () => {
      leaveLobbyCalls += 1;
    },
  });

  staleRoom.emitLeave();

  assert.equal(useGameStore.getState().appPhase, 'in_lobby');
  assert.equal(useGameStore.getState().currentLobbyId, 'new-room');
  assert.equal(lobbyRoomRef.current, asRoom(currentRoom));
  assert.equal(leaveLobbyCalls, 0);
}

{
  const activeRoom = new FakeLobbyRoom('active-room', 'active-session');
  const lobbyRoomRef = { current: asRoom(activeRoom) };

  primeLobbyState('active-room');
  setupLobbyListeners(asRoom(activeRoom), {
    playerName: 'Player',
    lobbyRoomRef,
    joinGameRoom: async () => {},
    leaveLobby: () => {},
  });

  activeRoom.emitLeave();

  assert.equal(lobbyRoomRef.current, null);
  assert.equal(useGameStore.getState().currentLobbyId, null);
  assert.equal(useGameStore.getState().appPhase, 'menu');
}

console.log('lobby listeners tests passed');
