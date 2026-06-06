import { useCallback, useRef } from 'react';
import { Client, Room } from 'colyseus.js';
import { useGameStore } from '../store/gameStore';
import type { GameStateSync, ServerMessage, ClientMessage, PlayerInput } from '@voxel-strike/shared';

interface NetworkClient {
  connect: (serverUrl: string, playerName: string) => Promise<void>;
  disconnect: () => void;
  send: (message: ClientMessage) => void;
  sendInput: (input: PlayerInput) => void;
}

export function useNetworkClient(): NetworkClient {
  const clientRef = useRef<Client | null>(null);
  const roomRef = useRef<Room | null>(null);

  const {
    setConnected,
    setLoading,
    setRoomId,
    setPlayerId,
    setGamePhase,
    setPhaseEndTime,
    setMapSeed,
    updateGameState,
    reset,
  } = useGameStore();

  const connect = useCallback(async (serverUrl: string, playerName: string) => {
    setLoading(true);

    try {
      // Create Colyseus client
      clientRef.current = new Client(serverUrl);

      // Join or create a room
      roomRef.current = await clientRef.current.joinOrCreate('game_room', {
        playerName,
      });

      const room = roomRef.current;

      setRoomId(room.id);
      setPlayerId(room.sessionId);

      // Set up message handlers
      room.onMessage('gameState', (state: GameStateSync) => {
        updateGameState(state);
      });

      room.onMessage('phaseChange', (data: { phase: string; endTime: number; mapSeed?: number }) => {
        if (typeof data.mapSeed === 'number') {
          setMapSeed(data.mapSeed);
        }
        setGamePhase(data.phase as any);
        setPhaseEndTime(data.endTime);
      });

      room.onMessage('playerJoined', (data: { playerId: string; playerName: string }) => {
        console.log(`Player joined: ${data.playerName}`);
      });

      room.onMessage('playerLeft', (data: { playerId: string }) => {
        console.log(`Player left: ${data.playerId}`);
      });

      room.onMessage('playerDied', (data: any) => {
        console.log('Player died:', data);
        // TODO: Show kill feed
      });

      room.onMessage('flagPickup', (data: any) => {
        console.log('Flag pickup:', data);
        // TODO: Show notification
      });

      room.onMessage('flagCapture', (data: any) => {
        console.log('Flag captured:', data);
        // TODO: Show celebration
      });

      room.onError((code, message) => {
        console.error('Room error:', code, message);
      });

      room.onLeave((code) => {
        console.log('Left room:', code);
        setConnected(false);
        reset();
      });

      setConnected(true);
      setLoading(false);

    } catch (error) {
      console.error('Failed to connect:', error);
      setLoading(false);
      throw error;
    }
  }, [setConnected, setLoading, setRoomId, setPlayerId, setGamePhase, setPhaseEndTime, setMapSeed, updateGameState, reset]);

  const disconnect = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.leave();
      roomRef.current = null;
    }
    if (clientRef.current) {
      clientRef.current = null;
    }
    reset();
  }, [reset]);

  const send = useCallback((message: ClientMessage) => {
    if (roomRef.current) {
      roomRef.current.send(message.type, message.payload);
    }
  }, []);

  const sendInput = useCallback((input: PlayerInput) => {
    if (roomRef.current) {
      roomRef.current.send('input', input);
    }
  }, []);

  return {
    connect,
    disconnect,
    send,
    sendInput,
  };
}
