import type { AntiCheatSignalInput } from '../anticheat';

export type RoomAntiCheatRecordInput = Omit<
  AntiCheatSignalInput,
  'roomId' | 'matchId' | 'lobbyId' | 'matchMode' | 'serverTick' | 'serverTime'
>;
