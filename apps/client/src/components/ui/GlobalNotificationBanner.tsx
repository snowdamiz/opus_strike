import { useCallback, useEffect, useRef, useState } from 'react';
import { config } from '../../config/environment';
import { useGameStore } from '../../store/gameStore';

interface GlobalNotification {
  id: string;
  message: string;
  updatedAt: string;
}

interface GlobalNotificationBannerProps {
  onVisibilityChange?: (visible: boolean) => void;
}

const DISMISSED_NOTIFICATION_STORAGE_KEY = 'slop-heroes-dismissed-global-notification';

function readDismissedNotificationToken(): string {
  try {
    return window.localStorage.getItem(DISMISSED_NOTIFICATION_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeDismissedNotificationToken(token: string): void {
  try {
    window.localStorage.setItem(DISMISSED_NOTIFICATION_STORAGE_KEY, token);
  } catch {
    // Dismissal is optional; private browsing/storage failures should not block the UI.
  }
}

function notificationToken(notification: GlobalNotification): string {
  return `${notification.id}:${notification.updatedAt}`;
}

function readGlobalNotificationPayload(value: unknown): GlobalNotification | null {
  const notification = (value as { notification?: unknown } | null)?.notification;
  if (!notification || typeof notification !== 'object') return null;

  const data = notification as Partial<GlobalNotification>;
  if (
    typeof data.id !== 'string' ||
    typeof data.message !== 'string' ||
    typeof data.updatedAt !== 'string' ||
    !data.id ||
    !data.message ||
    !data.updatedAt
  ) {
    return null;
  }

  return {
    id: data.id,
    message: data.message,
    updatedAt: data.updatedAt,
  };
}

export function GlobalNotificationBanner({ onVisibilityChange }: GlobalNotificationBannerProps) {
  const appPhase = useGameStore((state) => state.appPhase);
  const [notification, setNotification] = useState<GlobalNotification | null>(null);
  const [dismissedToken, setDismissedToken] = useState(readDismissedNotificationToken);
  const activeLoadRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(false);

  const loadNotification = useCallback(async (signal?: AbortSignal) => {
    if (activeLoadRef.current) return activeLoadRef.current;

    const loadPromise = (async () => {
      try {
        const response = await fetch(`${config.serverHttpUrl}/notifications/global`, {
          credentials: 'include',
          signal,
        });
        if (response.status === 304 || !response.ok) return;
        const nextNotification = readGlobalNotificationPayload(await response.json());
        if (mountedRef.current) {
          setNotification(nextNotification);
        }
      } catch {
        // Keep the last known banner visible during transient network failures.
      }
    })();

    activeLoadRef.current = loadPromise;
    void loadPromise.finally(() => {
      if (activeLoadRef.current === loadPromise) {
        activeLoadRef.current = null;
      }
    });
    return loadPromise;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (appPhase === 'in_game') return;

    const controller = new AbortController();
    void loadNotification(controller.signal);

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadNotification(controller.signal);
    };
    const refreshOnFocus = () => void loadNotification(controller.signal);

    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshOnFocus);

    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [appPhase, loadNotification]);

  const token = notification ? notificationToken(notification) : '';
  const isVisible = Boolean(notification && token !== dismissedToken);

  useEffect(() => {
    onVisibilityChange?.(isVisible);

    return () => onVisibilityChange?.(false);
  }, [isVisible, onVisibilityChange]);

  if (!notification || !isVisible) return null;

  const dismiss = () => {
    writeDismissedNotificationToken(token);
    setDismissedToken(token);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-x-0 top-0 z-[300] flex min-h-8 items-center justify-center bg-strike-bg/20 px-9 py-1 text-center"
    >
      <p className="max-w-[88rem] break-words font-body text-xs font-semibold leading-snug text-orange-50 sm:text-sm">
        {notification.message}
      </p>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={dismiss}
        className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm bg-white/[0.04] font-mono text-xs font-bold text-white/70 transition hover:bg-white/[0.1] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
      >
        x
      </button>
    </div>
  );
}
