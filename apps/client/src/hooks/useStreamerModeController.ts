import { useEffect } from 'react';
import { useNetwork } from '../contexts/NetworkContext';
import {
  requestNextStreamerTarget,
  requestStopStreamer,
  requestStreamerStatus,
} from '../contexts/networkApi';
import { useWallet } from '../contexts/WalletContext';
import { useGameStore } from '../store/gameStore';
import { useSettingsStore } from '../store/settingsStore';
import { useStreamerStore, type StreamerLoadingReason } from '../store/streamerStore';
import { loggers } from '../utils/logger';

const STREAMER_POLL_INTERVAL_MS = 4_000;
const STREAMER_RETRY_INTERVAL_MS = 3_000;
const STREAMER_HEARTBEAT_INTERVAL_MS = 10_000;

function formatStreamerError(error: unknown): string {
  return error instanceof Error ? error.message : 'Streamer mode request failed';
}

function disablePersistedStreamerMode(): void {
  const settingsStore = useSettingsStore.getState();
  if (!settingsStore.settings.streamerModeEnabled) return;

  settingsStore.applySettings({
    ...settingsStore.settings,
    streamerModeEnabled: false,
  });
}

function loadingReasonForTarget(source: 'real_player' | 'fallback_bot', currentRoomId: string | null): StreamerLoadingReason {
  if (currentRoomId) return 'switching_feed';
  return source === 'fallback_bot' ? 'spinning_up_bot_match' : 'finding_live_game';
}

export function useStreamerModeController(): void {
  const enabled = useSettingsStore((state) => state.settings.streamerModeEnabled);
  const gamePhase = useGameStore((state) => state.gamePhase);
  const { isAuthenticated, isSessionLoading, user } = useWallet();
  const isGameAdmin = user?.isGameAdmin === true;
  const { joinStreamerRoom, leaveGame, sendStreamerHeartbeat } = useNetwork();

  useEffect(() => {
    if (isSessionLoading || !enabled) return;
    if (isAuthenticated && isGameAdmin) return;

    disablePersistedStreamerMode();
    useStreamerStore.getState().reset();
  }, [enabled, isAuthenticated, isGameAdmin, isSessionLoading]);

  useEffect(() => {
    if (!enabled || !isAuthenticated || !isGameAdmin) return;

    if (gamePhase !== 'game_end') return;

    const store = useStreamerStore.getState();
    if (!store.isActive) return;

    store.setLoading('switching_feed');
    useGameStore.getState().clearMatchSummary();
    useGameStore.getState().setAppPhase('streamer_loading');
  }, [enabled, gamePhase, isAuthenticated, isGameAdmin]);

  useEffect(() => {
    if (!enabled || !isAuthenticated || !isGameAdmin) return;

    let cancelled = false;
    let pollTimeout: number | null = null;
    const streamerStore = useStreamerStore.getState();
    streamerStore.setLoading('finding_live_game');
    useGameStore.getState().setAppPhase('streamer_loading');

    const clearPollTimeout = () => {
      if (pollTimeout !== null) {
        window.clearTimeout(pollTimeout);
        pollTimeout = null;
      }
    };

    const schedulePoll = (delayMs: number) => {
      clearPollTimeout();
      if (cancelled) return;
      pollTimeout = window.setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const poll = async () => {
      if (cancelled) return;

      try {
        let { csrfToken, currentRoomId } = useStreamerStore.getState();
        if (!csrfToken) {
          const status = await requestStreamerStatus();
          if (cancelled) return;
          csrfToken = status.csrfToken;
          currentRoomId = status.currentRoomId ?? currentRoomId;
          useStreamerStore.getState().setCsrfToken(csrfToken);
        }

        const response = await requestNextStreamerTarget({
          currentRoomId,
          csrfToken,
        });
        if (cancelled) return;

        useStreamerStore.getState().setCsrfToken(response.csrfToken);
        const target = response.target;
        const activeRoomId = useGameStore.getState().roomId;
        const shouldJoinTarget = target.roomId !== currentRoomId || activeRoomId !== target.roomId;

        if (shouldJoinTarget) {
          const reason = loadingReasonForTarget(target.source, currentRoomId);
          useStreamerStore.getState().setLoading(reason);
          useGameStore.getState().setAppPhase('streamer_loading');
          await joinStreamerRoom(target);
          if (cancelled) return;
        }

        useStreamerStore.getState().setTarget(target);
        schedulePoll(STREAMER_POLL_INTERVAL_MS);
      } catch (error) {
        loggers.network.warn('streamer mode poll failed', error);
        useStreamerStore.getState().setCsrfToken(null);
        useStreamerStore.getState().setError(formatStreamerError(error));
        schedulePoll(STREAMER_RETRY_INTERVAL_MS);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      clearPollTimeout();

      const { csrfToken, isActive } = useStreamerStore.getState();
      if (isActive && csrfToken) {
        void requestStopStreamer(csrfToken).catch((error) => {
          loggers.network.warn('failed to stop streamer session', error);
        });
      }
      if (isActive) {
        leaveGame();
      }
      useStreamerStore.getState().reset();
    };
  }, [enabled, isAuthenticated, isGameAdmin, joinStreamerRoom, leaveGame]);

  useEffect(() => {
    if (!enabled || !isAuthenticated || !isGameAdmin) return;

    const intervalId = window.setInterval(() => {
      if (!useStreamerStore.getState().isActive) return;
      sendStreamerHeartbeat();
    }, STREAMER_HEARTBEAT_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [enabled, isAuthenticated, isGameAdmin, sendStreamerHeartbeat]);
}
