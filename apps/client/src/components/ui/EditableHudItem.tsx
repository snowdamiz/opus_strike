import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useShallow } from 'zustand/shallow';
import { useTouchControlsAvailable } from '../../hooks/useDeviceCapabilities';
import {
  MOBILE_HUD_LAYOUT_DEFINITIONS,
  type MobileHudLayoutElementId,
  type MobileHudLayoutRect,
  useMobileHudLayoutStore,
} from '../../store/mobileHudLayoutStore';
import { useSettingsStore } from '../../store/settingsStore';

interface EditableHudItemProps {
  id: MobileHudLayoutElementId;
  label?: string;
  children: ReactNode;
  desktopClassName?: string;
  desktopStyle?: CSSProperties;
  mobileClassName?: string;
  mobileStyle?: CSSProperties;
  contentClassName?: string;
  interactive?: boolean;
}

interface DragState {
  mode: 'move' | 'resize';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startRect: MobileHudLayoutRect;
  viewportWidth: number;
  viewportHeight: number;
}

function classNames(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function releasePointerCapture(element: Element, pointerId: number): void {
  if (element.hasPointerCapture(pointerId)) {
    element.releasePointerCapture(pointerId);
  }
}

function readViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1, height: 1 };
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
}

function getResizedRect(
  id: MobileHudLayoutElementId,
  startRect: MobileHudLayoutRect,
  deltaXPercent: number,
  deltaYPercent: number
): MobileHudLayoutRect {
  const definition = MOBILE_HUD_LAYOUT_DEFINITIONS[id];
  if (!definition.lockAspectRatio) {
    return {
      ...startRect,
      width: startRect.width + deltaXPercent,
      height: startRect.height + deltaYPercent,
    };
  }

  const widthRatio = (startRect.width + deltaXPercent) / Math.max(1, startRect.width);
  const heightRatio = (startRect.height + deltaYPercent) / Math.max(1, startRect.height);
  const scale = Math.max(0.1, Math.max(widthRatio, heightRatio));

  return {
    ...startRect,
    width: startRect.width * scale,
    height: startRect.height * scale,
  };
}

export function EditableHudItem({
  id,
  label,
  children,
  desktopClassName,
  desktopStyle,
  mobileClassName,
  mobileStyle,
  contentClassName,
  interactive = false,
}: EditableHudItemProps) {
  const isTouchControlsAvailable = useTouchControlsAvailable();
  const layoutEditing = useSettingsStore(state => state.settings.mobileHudLayoutEditing);
  const { rect, updateItem } = useMobileHudLayoutStore(
    useShallow(state => ({
      rect: state.items[id],
      updateItem: state.updateItem,
    }))
  );
  const dragStateRef = useRef<DragState | null>(null);
  const definition = MOBILE_HUD_LAYOUT_DEFINITIONS[id];
  const itemLabel = label ?? definition.label;
  const defaultRect = definition.defaultRect;
  const contentScale = Math.min(
    rect.width / Math.max(1, defaultRect.width),
    rect.height / Math.max(1, defaultRect.height)
  );
  const boundedContentScale = Math.max(0.45, Math.min(2.25, contentScale));

  const mobileLayoutStyle = useMemo(() => ({
    ...mobileStyle,
    left: `${rect.x}vw`,
    top: `${rect.y}vh`,
    width: `${rect.width}vw`,
    height: `${rect.height}vh`,
    transform: 'none',
    '--mobile-hud-layout-scale': boundedContentScale,
    '--mobile-hud-layout-content-width': `${100 / boundedContentScale}%`,
    '--mobile-hud-layout-content-height': `${100 / boundedContentScale}%`,
  } as CSSProperties), [boundedContentScale, mobileStyle, rect.height, rect.width, rect.x, rect.y]);

  const endDrag = useCallback((element?: Element, pointerId?: number) => {
    const dragState = dragStateRef.current;
    if (element && pointerId !== undefined) {
      releasePointerCapture(element, pointerId);
    } else if (dragState && element) {
      releasePointerCapture(element, dragState.pointerId);
    }
    dragStateRef.current = null;
  }, []);

  const startDrag = useCallback((
    mode: DragState['mode'],
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (!layoutEditing) return;

    const viewport = readViewportSize();
    const captureTarget = event.currentTarget.closest('[data-hud-layout-id]') as HTMLDivElement | null
      ?? event.currentTarget;
    dragStateRef.current = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: rect,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    };
    captureTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, [layoutEditing, rect]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const deltaXPercent = ((event.clientX - dragState.startClientX) / dragState.viewportWidth) * 100;
    const deltaYPercent = ((event.clientY - dragState.startClientY) / dragState.viewportHeight) * 100;
    const nextRect = dragState.mode === 'move'
      ? {
          ...dragState.startRect,
          x: dragState.startRect.x + deltaXPercent,
          y: dragState.startRect.y + deltaYPercent,
        }
      : getResizedRect(id, dragState.startRect, deltaXPercent, deltaYPercent);

    updateItem(id, nextRect);
    event.preventDefault();
    event.stopPropagation();
  }, [id, updateItem]);

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    endDrag(event.currentTarget, event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, [endDrag]);

  if (!isTouchControlsAvailable) {
    if (!desktopClassName && !desktopStyle) return <>{children}</>;
    return (
      <div className={desktopClassName} style={desktopStyle}>
        {children}
      </div>
    );
  }

  return (
    <div
      className={classNames(
        'mobile-hud-layout-item',
        mobileClassName,
        interactive && 'mobile-hud-layout-item-interactive',
        layoutEditing && 'is-editing'
      )}
      data-hud-layout-id={id}
      data-hud-layout-label={itemLabel}
      style={mobileLayoutStyle}
      aria-label={layoutEditing ? `${itemLabel} HUD layout item` : undefined}
      onPointerDown={(event) => {
        if (layoutEditing) startDrag('move', event);
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={() => {
        dragStateRef.current = null;
      }}
      onContextMenu={(event) => {
        if (!layoutEditing) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className={classNames('mobile-hud-layout-content', contentClassName)}>
        {children}
      </div>
      {layoutEditing && (
        <>
          <div className="mobile-hud-layout-label">{itemLabel}</div>
          <div className="mobile-hud-layout-move-grip" aria-hidden="true" />
          <div
            className="mobile-hud-layout-resize-grip"
            aria-hidden="true"
            onPointerDown={(event) => startDrag('resize', event)}
          />
        </>
      )}
    </div>
  );
}

export function MobileHudLayoutEditorToolbar() {
  const isTouchControlsAvailable = useTouchControlsAvailable();
  const settings = useSettingsStore(state => state.settings);
  const applySettings = useSettingsStore(state => state.applySettings);
  const resetLayout = useMobileHudLayoutStore(state => state.resetLayout);

  if (!isTouchControlsAvailable || !settings.mobileHudLayoutEditing) return null;

  return (
    <div className="mobile-hud-layout-toolbar" role="group" aria-label="HUD layout editor">
      <button
        type="button"
        onClick={(event) => {
          resetLayout();
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        RESET
      </button>
      <button
        type="button"
        onClick={(event) => {
          applySettings({ ...settings, mobileHudLayoutEditing: false });
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        DONE
      </button>
    </div>
  );
}
