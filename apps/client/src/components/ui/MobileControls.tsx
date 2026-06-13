import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type HeroId, type InputState } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import {
  addMobileLookDelta,
  resetMobileControls,
  useMobileControlsStore,
} from '../../store/mobileControlsStore';
import { HUD_HERO_COLORS } from '../../styles/colorTokens';
import { getHeroSkillItems, HeroSkillIcon, type HeroSkillItem } from './HeroSkillKit';

const TOUCH_CONTROLS_QUERY = '(pointer: coarse), (hover: none)';
const MIN_PRESS_MS = 72;

type InputAction = keyof InputState;

interface MobileControlsProps {
  disabled?: boolean;
  onOpenMenu: () => void;
  onScoreboardChange: (showScoreboard: boolean) => void;
}

function getInitialTouchPreference(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(TOUCH_CONTROLS_QUERY).matches || navigator.maxTouchPoints > 0;
}

function useTouchControlsAvailable(): boolean {
  const [available, setAvailable] = useState(getInitialTouchPreference);

  useEffect(() => {
    const mediaQuery = window.matchMedia(TOUCH_CONTROLS_QUERY);
    const legacyMediaQuery = mediaQuery as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    const updateAvailability = () => {
      setAvailable(mediaQuery.matches || navigator.maxTouchPoints > 0);
    };

    updateAvailability();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateAvailability);
      return () => mediaQuery.removeEventListener('change', updateAvailability);
    }

    legacyMediaQuery.addListener?.(updateAvailability);
    return () => legacyMediaQuery.removeListener?.(updateAvailability);
  }, []);

  return available;
}

function releasePointerCapture(element: Element, pointerId: number): void {
  if (element.hasPointerCapture(pointerId)) {
    element.releasePointerCapture(pointerId);
  }
}

function TouchLookZone({ disabled }: { disabled: boolean }) {
  const activePointerIdRef = useRef<number | null>(null);
  const lastPointRef = useRef({ x: 0, y: 0 });

  const endLook = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;

    activePointerIdRef.current = null;
    releasePointerCapture(e.currentTarget, e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div
      className="mobile-look-zone"
      aria-hidden="true"
      onPointerDown={(e) => {
        if (disabled || activePointerIdRef.current !== null) return;

        activePointerIdRef.current = e.pointerId;
        lastPointRef.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerMove={(e) => {
        if (disabled || activePointerIdRef.current !== e.pointerId) return;

        const lastPoint = lastPointRef.current;
        const deltaX = e.clientX - lastPoint.x;
        const deltaY = e.clientY - lastPoint.y;
        lastPointRef.current = { x: e.clientX, y: e.clientY };
        addMobileLookDelta(deltaX, deltaY);
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerUp={endLook}
      onPointerCancel={endLook}
      onLostPointerCapture={(e) => {
        if (activePointerIdRef.current === e.pointerId) {
          activePointerIdRef.current = null;
        }
      }}
    />
  );
}

function MovementStick({ disabled }: { disabled: boolean }) {
  const stickRef = useRef<HTMLDivElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const movementVector = useMobileControlsStore(state => state.movementVector);
  const setMovementVector = useMobileControlsStore(state => state.setMovementVector);

  const updateVector = useCallback((clientX: number, clientY: number) => {
    const stick = stickRef.current;
    if (!stick) return;

    const rect = stick.getBoundingClientRect();
    const radius = rect.width / 2;
    const maxDistance = radius * 0.76;
    const rawX = clientX - (rect.left + radius);
    const rawY = clientY - (rect.top + radius);
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > maxDistance ? maxDistance / distance : 1;

    setMovementVector(
      (rawX * scale) / maxDistance,
      (rawY * scale) / maxDistance
    );
  }, [setMovementVector]);

  const endMovement = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;

    activePointerIdRef.current = null;
    setMovementVector(0, 0);
    releasePointerCapture(e.currentTarget, e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }, [setMovementVector]);

  return (
    <div
      ref={stickRef}
      className="mobile-joystick"
      role="application"
      aria-label="Move"
      style={{
        '--stick-x': movementVector.x,
        '--stick-y': movementVector.y,
      } as CSSProperties}
      onPointerDown={(e) => {
        if (disabled || activePointerIdRef.current !== null) return;

        activePointerIdRef.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        updateVector(e.clientX, e.clientY);
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerMove={(e) => {
        if (disabled || activePointerIdRef.current !== e.pointerId) return;

        updateVector(e.clientX, e.clientY);
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerUp={endMovement}
      onPointerCancel={endMovement}
      onLostPointerCapture={(e) => {
        if (activePointerIdRef.current === e.pointerId) {
          activePointerIdRef.current = null;
          setMovementVector(0, 0);
        }
      }}
    >
      <div className="mobile-joystick-rim" />
      <div className="mobile-joystick-cardinal mobile-joystick-cardinal-up" />
      <div className="mobile-joystick-cardinal mobile-joystick-cardinal-right" />
      <div className="mobile-joystick-cardinal mobile-joystick-cardinal-down" />
      <div className="mobile-joystick-cardinal mobile-joystick-cardinal-left" />
      <div className="mobile-joystick-knob" />
    </div>
  );
}

function MobileActionButton({
  action,
  label,
  ariaLabel,
  className = '',
  children,
  disabled = false,
}: {
  action: InputAction;
  label: string;
  ariaLabel: string;
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const setActionPressed = useMobileControlsStore(state => state.setActionPressed);
  const pressed = useMobileControlsStore(state => state.inputState[action]);
  const pressStartedAtRef = useRef(0);
  const releaseTimerRef = useRef<number | null>(null);

  const clearReleaseTimer = useCallback(() => {
    if (releaseTimerRef.current === null) return;
    window.clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = null;
  }, []);

  const release = useCallback(() => {
    clearReleaseTimer();
    setActionPressed(action, false);
  }, [action, clearReleaseTimer, setActionPressed]);

  useEffect(() => release, [release]);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;

    clearReleaseTimer();
    pressStartedAtRef.current = performance.now();
    setActionPressed(action, true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }, [action, clearReleaseTimer, disabled, setActionPressed]);

  const handlePointerEnd = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;

    releasePointerCapture(e.currentTarget, e.pointerId);
    const elapsed = performance.now() - pressStartedAtRef.current;
    const remaining = Math.max(0, MIN_PRESS_MS - elapsed);
    clearReleaseTimer();

    if (remaining > 0) {
      releaseTimerRef.current = window.setTimeout(release, remaining);
    } else {
      release();
    }

    e.preventDefault();
    e.stopPropagation();
  }, [clearReleaseTimer, disabled, release]);

  return (
    <button
      type="button"
      className={`mobile-action-button ${pressed ? 'is-pressed' : ''} ${className}`}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      <span className="mobile-action-label">{label}</span>
    </button>
  );
}

function MobileSkillButton({
  action,
  fallbackLabel,
  ariaLabel,
  skill,
  heroColor,
  className = '',
  disabled,
}: {
  action: InputAction;
  fallbackLabel: string;
  ariaLabel: string;
  skill?: HeroSkillItem;
  heroColor: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <MobileActionButton
      action={action}
      label={skill?.input ?? fallbackLabel}
      ariaLabel={ariaLabel}
      className={`mobile-skill-button ${className}`}
      disabled={disabled}
    >
      {skill ? (
        <HeroSkillIcon
          item={skill}
          color={heroColor}
          size="hud"
          className="mobile-skill-icon"
        />
      ) : (
        <span className="mobile-action-glyph">{fallbackLabel}</span>
      )}
    </MobileActionButton>
  );
}

function MobileSystemButton({
  label,
  ariaLabel,
  onPointerDown,
  onPointerUp,
  children,
}: {
  label: string;
  ariaLabel: string;
  onPointerDown: () => void;
  onPointerUp?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="mobile-system-button"
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onPointerDown();
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerUp={(e) => {
        releasePointerCapture(e.currentTarget, e.pointerId);
        onPointerUp?.();
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerCancel={(e) => {
        releasePointerCapture(e.currentTarget, e.pointerId);
        onPointerUp?.();
        e.preventDefault();
        e.stopPropagation();
      }}
      onLostPointerCapture={() => onPointerUp?.()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function MenuIcon() {
  return (
    <svg className="mobile-system-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeWidth={2} d="M5 7h14M5 12h14M5 17h14" />
    </svg>
  );
}

function BoardIcon() {
  return (
    <svg className="mobile-system-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 5h10M7 12h10M7 19h6" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 5h.01M4 12h.01M4 19h.01" />
    </svg>
  );
}

function JumpIcon() {
  return (
    <svg className="mobile-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M12 20V5m0 0L6.5 10.5M12 5l5.5 5.5" />
    </svg>
  );
}

function CrouchIcon() {
  return (
    <svg className="mobile-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 16h14M8 8h8m-5 0v8m2-8v8" />
    </svg>
  );
}

function ReloadIcon() {
  return (
    <svg className="mobile-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M18.5 9a7 7 0 10.8 6M18.5 9V4m0 5h-5" />
    </svg>
  );
}

function InteractIcon() {
  return (
    <svg className="mobile-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 5v14m-7-7h14" />
    </svg>
  );
}

function getSkillByInput(skillItems: HeroSkillItem[], input: string): HeroSkillItem | undefined {
  return skillItems.find(skill => skill.input === input);
}

export function MobileControls({ disabled = false, onOpenMenu, onScoreboardChange }: MobileControlsProps) {
  const controlsAvailable = useTouchControlsAvailable();
  const heroId = useGameStore(state => state.localPlayer?.heroId ?? null) as HeroId | null;
  const bombTargeting = useGameStore(state => state.bombTargeting);
  const airStrikeTargeting = useGameStore(state => state.airStrikeTargeting);
  const grappleTrapTargeting = useGameStore(state => state.grappleTrapTargeting);
  const setBombTargeting = useGameStore(state => state.setBombTargeting);
  const setAirStrikeTargeting = useGameStore(state => state.setAirStrikeTargeting);
  const setGrappleTrapTargeting = useGameStore(state => state.setGrappleTrapTargeting);
  const setActionPressed = useMobileControlsStore(state => state.setActionPressed);
  const shouldRender = Boolean(controlsAvailable && !disabled && heroId);
  const isTargeting = bombTargeting || airStrikeTargeting || grappleTrapTargeting;
  const heroTone = heroId ? HUD_HERO_COLORS[heroId] : HUD_HERO_COLORS.phantom;

  const skillItems = useMemo(
    () => (heroId ? getHeroSkillItems(heroId) : []),
    [heroId]
  );
  const primarySkill = getSkillByInput(skillItems, 'LMB');
  const secondarySkill = getSkillByInput(skillItems, 'RMB');
  const ability1Skill = getSkillByInput(skillItems, 'E');
  const ability2Skill = getSkillByInput(skillItems, 'Q');
  const ultimateSkill = getSkillByInput(skillItems, 'F');

  useEffect(() => {
    if (shouldRender) return;

    resetMobileControls();
    onScoreboardChange(false);
  }, [onScoreboardChange, shouldRender]);

  useEffect(() => {
    if (!shouldRender) return;

    const resetOnPagePause = () => {
      resetMobileControls();
      onScoreboardChange(false);
    };
    const resetOnVisibilityChange = () => {
      if (document.hidden) resetOnPagePause();
    };

    window.addEventListener('blur', resetOnPagePause);
    document.addEventListener('visibilitychange', resetOnVisibilityChange);

    return () => {
      window.removeEventListener('blur', resetOnPagePause);
      document.removeEventListener('visibilitychange', resetOnVisibilityChange);
      resetOnPagePause();
    };
  }, [onScoreboardChange, shouldRender]);

  const cancelTargeting = useCallback(() => {
    setActionPressed('primaryFire', false);
    setActionPressed('secondaryFire', false);
    setActionPressed('ability1', false);
    setActionPressed('ability2', false);
    setActionPressed('ultimate', false);
    setBombTargeting(false, false);
    setAirStrikeTargeting(false, false);
    setGrappleTrapTargeting(false, false);
  }, [
    setActionPressed,
    setAirStrikeTargeting,
    setBombTargeting,
    setGrappleTrapTargeting,
  ]);

  if (!shouldRender) return null;

  return (
    <div
      className="mobile-controls"
      style={{
        '--mobile-hero-color': heroTone.primary,
        '--mobile-hero-glow': heroTone.glow,
      } as CSSProperties}
      onContextMenu={(e) => e.preventDefault()}
    >
      <TouchLookZone disabled={disabled} />

      <div className="mobile-system-controls">
        <MobileSystemButton
          label="MENU"
          ariaLabel="Open menu"
          onPointerDown={onOpenMenu}
        >
          <MenuIcon />
        </MobileSystemButton>
        <MobileSystemButton
          label="BOARD"
          ariaLabel="Show scoreboard"
          onPointerDown={() => onScoreboardChange(true)}
          onPointerUp={() => onScoreboardChange(false)}
        >
          <BoardIcon />
        </MobileSystemButton>
      </div>

      <MovementStick disabled={disabled} />

      {isTargeting && (
        <button
          type="button"
          className="mobile-target-cancel"
          onPointerDown={(e) => {
            cancelTargeting();
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          CANCEL
        </button>
      )}

      <div className="mobile-utility-cluster">
        <MobileActionButton action="reload" label="REL" ariaLabel="Reload">
          <ReloadIcon />
        </MobileActionButton>
        <MobileActionButton action="interact" label="USE" ariaLabel="Interact">
          <InteractIcon />
        </MobileActionButton>
      </div>

      <div className="mobile-right-dock">
        <div className="mobile-ability-cluster">
          <MobileSkillButton
            action="ability1"
            fallbackLabel="E"
            ariaLabel={ability1Skill?.name ?? 'Ability one'}
            skill={ability1Skill}
            heroColor={heroTone.primary}
          />
          <MobileSkillButton
            action="ability2"
            fallbackLabel="Q"
            ariaLabel={ability2Skill?.name ?? 'Ability two'}
            skill={ability2Skill}
            heroColor={heroTone.primary}
          />
          <MobileSkillButton
            action="ultimate"
            fallbackLabel="F"
            ariaLabel={ultimateSkill?.name ?? 'Ultimate ability'}
            skill={ultimateSkill}
            heroColor={heroTone.primary}
            className="mobile-ultimate-button"
          />
        </div>

        <div className="mobile-thumb-row">
          <div className="mobile-movement-actions">
            <MobileActionButton action="jump" label="JUMP" ariaLabel="Jump" className="mobile-jump-button">
              <JumpIcon />
            </MobileActionButton>
            <MobileActionButton action="crouch" label="SLIDE" ariaLabel="Crouch or slide" className="mobile-crouch-button">
              <CrouchIcon />
            </MobileActionButton>
          </div>

          <div className="mobile-fire-cluster">
            <MobileSkillButton
              action="secondaryFire"
              fallbackLabel="ALT"
              ariaLabel={secondarySkill?.name ?? 'Secondary fire'}
              skill={secondarySkill}
              heroColor={heroTone.primary}
              className="mobile-secondary-button"
            />
            <MobileSkillButton
              action="primaryFire"
              fallbackLabel="FIRE"
              ariaLabel={primarySkill?.name ?? 'Primary fire'}
              skill={primarySkill}
              heroColor={heroTone.primary}
              className="mobile-primary-button"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
