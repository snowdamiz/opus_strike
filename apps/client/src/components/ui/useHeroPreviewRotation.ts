import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

interface HeroPreviewRotationOptions {
  enabled?: boolean;
  initialYaw?: number;
  dragSensitivity?: number;
  resetKey?: string | number;
}

interface DragState {
  pointerId: number | null;
  lastX: number;
}

function releasePointerCapture(target: EventTarget & HTMLDivElement, pointerId: number) {
  if (target.hasPointerCapture(pointerId)) {
    target.releasePointerCapture(pointerId);
  }
}

export function useHeroPreviewRotation({
  enabled = true,
  initialYaw = -0.24,
  dragSensitivity = 0.012,
  resetKey,
}: HeroPreviewRotationOptions = {}) {
  const [yaw, setYaw] = useState(initialYaw);
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<DragState>({ pointerId: null, lastX: 0 });

  useEffect(() => {
    setYaw(initialYaw);
    setIsDragging(false);
    dragStateRef.current = { pointerId: null, lastX: 0 };
  }, [initialYaw, resetKey]);

  const endDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const { pointerId } = dragStateRef.current;
    if (pointerId === null || event.pointerId !== pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    releasePointerCapture(event.currentTarget, pointerId);
    dragStateRef.current = { pointerId: null, lastX: 0 };
    setIsDragging(false);
  }, []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = { pointerId: event.pointerId, lastX: event.clientX };
    setIsDragging(true);
  }, [enabled]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!enabled || dragState.pointerId === null || event.pointerId !== dragState.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    const deltaX = event.clientX - dragState.lastX;
    dragState.lastX = event.clientX;
    if (deltaX !== 0) {
      setYaw((currentYaw) => currentYaw + deltaX * dragSensitivity);
    }
  }, [dragSensitivity, enabled]);

  const onDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!enabled) return;

    event.preventDefault();
    event.stopPropagation();
    setYaw(initialYaw);
  }, [enabled, initialYaw]);

  return {
    yaw,
    isDragging,
    interactionProps: enabled
      ? {
          onPointerDown,
          onPointerMove,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          onDoubleClick,
        }
      : {},
  };
}
