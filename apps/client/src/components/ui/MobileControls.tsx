import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { type HeroId, type InputState } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { addLookDelta } from '../../store/lookInputStore';
import { resetMobileControls, useMobileControlsStore } from '../../store/mobileControlsStore';
import { useSettingsStore } from '../../store/settingsStore';
import { resolveHeroAbilityBindings, useLoadoutStore } from '../../store/loadoutStore';
import { useTouchControlsAvailable } from '../../hooks/useDeviceCapabilities';
import { HUD_HERO_COLORS } from '../../styles/colorTokens';
import { getHeroSkillItems, HeroSkillIcon, type HeroSkillItem } from './HeroSkillKit';
import { EditableHudItem, MobileHudLayoutEditorToolbar } from './EditableHudItem';

const MIN_PRESS_MS = 72;

type InputAction = keyof InputState;

interface MobileControlsProps {
  disabled?: boolean;
  scoreboardOpen?: boolean;
  onOpenMenu: () => void;
  onScoreboardChange: (showScoreboard: boolean) => void;
}

function releasePointerCapture(element: Element, pointerId: number): void {
  if (element.hasPointerCapture(pointerId)) {
    element.releasePointerCapture(pointerId);
  }
}

function TouchAimZone({ disabled }: { disabled: boolean }) {
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const lastPointRef = useRef({ x: 0, y: 0 });

  const resetAimPointer = useCallback(() => {
    const pointerId = activePointerIdRef.current;
    if (pointerId !== null && zoneRef.current?.hasPointerCapture(pointerId)) {
      releasePointerCapture(zoneRef.current, pointerId);
    }
    activePointerIdRef.current = null;
  }, []);

  useEffect(() => {
    if (disabled) resetAimPointer();
    return resetAimPointer;
  }, [disabled, resetAimPointer]);

  const endAim = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;

    activePointerIdRef.current = null;
    releasePointerCapture(e.currentTarget, e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div
      ref={zoneRef}
      className={`mobile-look-zone ${disabled ? 'is-disabled' : ''}`}
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
        const aimDeltaX = e.clientX - lastPoint.x;
        const aimDeltaY = e.clientY - lastPoint.y;
        lastPointRef.current = { x: e.clientX, y: e.clientY };
        addLookDelta(aimDeltaX, aimDeltaY);
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerUp={endAim}
      onPointerCancel={endAim}
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

  const resetMovement = useCallback(() => {
    const pointerId = activePointerIdRef.current;
    if (pointerId !== null && stickRef.current?.hasPointerCapture(pointerId)) {
      releasePointerCapture(stickRef.current, pointerId);
    }
    activePointerIdRef.current = null;
    setMovementVector(0, 0);
  }, [setMovementVector]);

  useEffect(() => {
    if (disabled) resetMovement();
    return resetMovement;
  }, [disabled, resetMovement]);

  const updateVector = useCallback((clientX: number, clientY: number) => {
    const stick = stickRef.current;
    if (!stick) return;

    const rect = stick.getBoundingClientRect();
    const radius = rect.width / 2;
    const maxDistance = radius * 0.76;
    const rawX = clientX - (rect.left + radius);
    const rawY = clientY - (rect.top + radius);
    const distance = Math.hypot(rawX, rawY);

    // Dead zone: a resting thumb near center must not drift the player.
    const deadZone = maxDistance * 0.12;
    if (distance <= deadZone) {
      setMovementVector(0, 0);
      return;
    }

    // Ramp magnitude from 0 at the dead-zone edge to 1 at max deflection.
    const clampedDistance = Math.min(distance, maxDistance);
    const magnitude = (clampedDistance - deadZone) / (maxDistance - deadZone);

    setMovementVector(
      (rawX / distance) * magnitude,
      (rawY / distance) * magnitude
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
        '--stick-offset-x': `${movementVector.x * 30}%`,
        '--stick-offset-y': `${movementVector.y * 30}%`,
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
  accentColor,
  className = '',
  disabled,
}: {
  action: InputAction;
  fallbackLabel: string;
  ariaLabel: string;
  skill?: HeroSkillItem;
  accentColor: string;
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
          color={accentColor}
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
  active = false,
  onPress,
  children,
}: {
  label: string;
  ariaLabel: string;
  active?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`mobile-system-button ${active ? 'is-active' : ''}`}
      aria-label={ariaLabel}
      aria-pressed={active}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        e.stopPropagation();
      }}
      onPointerUp={(e) => {
        releasePointerCapture(e.currentTarget, e.pointerId);
        e.stopPropagation();
      }}
      onPointerCancel={(e) => {
        releasePointerCapture(e.currentTarget, e.pointerId);
        e.stopPropagation();
      }}
      onClick={(e) => {
        onPress();
        e.preventDefault();
        e.stopPropagation();
      }}
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

export function MobileControls({
  disabled = false,
  scoreboardOpen = false,
  onOpenMenu,
  onScoreboardChange,
}: MobileControlsProps) {
  const controlsAvailable = useTouchControlsAvailable();
  const heroId = useGameStore(state => state.localPlayer?.heroId ?? null) as HeroId | null;
  const bombTargeting = useGameStore(state => state.bombTargeting);
  const setBombTargeting = useGameStore(state => state.setBombTargeting);
  const setActionPressed = useMobileControlsStore(state => state.setActionPressed);
  const layoutEditing = useSettingsStore(state => state.settings.mobileHudLayoutEditing);
  const blazePrimarySkill = useLoadoutStore(state => state.blazePrimarySkill);
  const heroAbilityBindings = useLoadoutStore(state => state.heroAbilityBindings);
  const shouldRender = Boolean(controlsAvailable && !disabled && heroId);
  const gameplayControlsDisabled = disabled || layoutEditing;
  const isTargeting = bombTargeting;
  const heroTone = heroId ? HUD_HERO_COLORS[heroId] : HUD_HERO_COLORS.blaze;

  const skillItems = useMemo(
    () => (heroId
      ? getHeroSkillItems(
        heroId,
        blazePrimarySkill,
        resolveHeroAbilityBindings(heroId, heroAbilityBindings),
      )
      : []),
    [blazePrimarySkill, heroAbilityBindings, heroId]
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
  }, [
    setActionPressed,
    setBombTargeting,
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
      <TouchAimZone disabled={gameplayControlsDisabled} />
      <MobileHudLayoutEditorToolbar />

      <EditableHudItem id="mobile-menu" label="Menu" interactive>
        <MobileSystemButton
          label="MENU"
          ariaLabel="Open menu"
          onPress={onOpenMenu}
        >
          <MenuIcon />
        </MobileSystemButton>
      </EditableHudItem>

      <EditableHudItem id="mobile-scoreboard" label="Board" interactive>
        <MobileSystemButton
          label="BOARD"
          ariaLabel={scoreboardOpen ? 'Hide scoreboard' : 'Show scoreboard'}
          active={scoreboardOpen}
          onPress={() => onScoreboardChange(!scoreboardOpen)}
        >
          <BoardIcon />
        </MobileSystemButton>
      </EditableHudItem>

      <EditableHudItem id="mobile-joystick" label="Move" interactive>
        <MovementStick disabled={gameplayControlsDisabled} />
      </EditableHudItem>

      {isTargeting && (
        <EditableHudItem id="mobile-target-cancel" label="Cancel" interactive>
          <button
            type="button"
            className="mobile-target-cancel"
            onPointerDown={(e) => {
              if (gameplayControlsDisabled) return;
              cancelTargeting();
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            CANCEL
          </button>
        </EditableHudItem>
      )}

      <EditableHudItem id="mobile-reload" label="Reload" interactive>
        <MobileActionButton action="reload" label="REL" ariaLabel="Reload" disabled={gameplayControlsDisabled}>
          <ReloadIcon />
        </MobileActionButton>
      </EditableHudItem>

      <EditableHudItem id="mobile-interact" label="Interact" interactive>
        <MobileActionButton action="interact" label="USE" ariaLabel="Interact" disabled={gameplayControlsDisabled}>
          <InteractIcon />
        </MobileActionButton>
      </EditableHudItem>

      <EditableHudItem id="mobile-ability1" label="Ability 1" interactive>
        <MobileSkillButton
          action="ability1"
          fallbackLabel="E"
          ariaLabel={ability1Skill?.name ?? 'Ability one'}
          skill={ability1Skill}
          accentColor={heroTone.primary}
          disabled={gameplayControlsDisabled}
        />
      </EditableHudItem>

      <EditableHudItem id="mobile-ability2" label="Ability 2" interactive>
        <MobileSkillButton
          action="ability2"
          fallbackLabel="Q"
          ariaLabel={ability2Skill?.name ?? 'Ability two'}
          skill={ability2Skill}
          accentColor={heroTone.primary}
          disabled={gameplayControlsDisabled}
        />
      </EditableHudItem>

      <EditableHudItem id="mobile-ultimate" label="Ultimate" interactive>
        <MobileSkillButton
          action="ultimate"
          fallbackLabel="F"
          ariaLabel={ultimateSkill?.name ?? 'Ultimate ability'}
          skill={ultimateSkill}
          accentColor={heroTone.primary}
          className="mobile-ultimate-button"
          disabled={gameplayControlsDisabled}
        />
      </EditableHudItem>

      <EditableHudItem id="mobile-jump" label="Jump" interactive>
        <MobileActionButton
          action="jump"
          label="JUMP"
          ariaLabel="Jump"
          className="mobile-jump-button"
          disabled={gameplayControlsDisabled}
        >
          <JumpIcon />
        </MobileActionButton>
      </EditableHudItem>

      <EditableHudItem id="mobile-crouch" label="Slide" interactive>
        <MobileActionButton
          action="crouch"
          label="SLIDE"
          ariaLabel="Crouch or slide"
          className="mobile-crouch-button"
          disabled={gameplayControlsDisabled}
        >
          <CrouchIcon />
        </MobileActionButton>
      </EditableHudItem>

      <EditableHudItem id="mobile-secondary-fire" label="Alt fire" interactive>
        <MobileSkillButton
          action="secondaryFire"
          fallbackLabel="ALT"
          ariaLabel={secondarySkill?.name ?? 'Secondary fire'}
          skill={secondarySkill}
          accentColor={heroTone.primary}
          className="mobile-secondary-button"
          disabled={gameplayControlsDisabled}
        />
      </EditableHudItem>

      <EditableHudItem id="mobile-primary-fire" label="Fire" interactive>
        <MobileSkillButton
          action="primaryFire"
          fallbackLabel="FIRE"
          ariaLabel={primarySkill?.name ?? 'Primary fire'}
          skill={primarySkill}
          accentColor={heroTone.primary}
          className="mobile-primary-button"
          disabled={gameplayControlsDisabled}
        />
      </EditableHudItem>
    </div>
  );
}
