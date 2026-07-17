import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface GameSelectOption<T extends string> {
  value: T;
  label: string;
  /** Rendered right-aligned in the option row (e.g. a rarity chip). */
  trailing?: ReactNode;
  disabled?: boolean;
}

interface GameSelectMenuPosition {
  left: number;
  top: number | null;
  bottom: number | null;
  width: number;
}

const MENU_MAX_HEIGHT = 240; // matches max-h-60
const ESTIMATED_OPTION_HEIGHT = 34;

/**
 * Styled replacement for native <select> in lobby forms. Renders the listbox
 * in a portal with fixed positioning (flipping upward near the viewport edge)
 * so ancestor overflow containers cannot clip it.
 */
export function GameSelect<T extends string>({
  label,
  value,
  options,
  placeholder = 'Select…',
  emptyLabel = 'No options',
  disabled = false,
  className = '',
  onChange,
}: {
  label: string;
  value: T | '';
  options: readonly GameSelectOption<T>[];
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: T) => void;
}) {
  const menuId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<GameSelectMenuPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? null;

  const openMenu = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const estimatedMenuHeight = Math.min(
      Math.max(options.length, 1) * ESTIMATED_OPTION_HEIGHT + 8,
      MENU_MAX_HEIGHT
    );
    const opensUpward = rect.bottom + 6 + estimatedMenuHeight > viewportHeight - 8;

    setMenuPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
      width: rect.width,
      top: opensUpward ? null : rect.bottom + 6,
      bottom: opensUpward ? Math.max(8, window.innerHeight - rect.top + 6) : null,
    });
    setActiveIndex(options.findIndex((option) => option.value === value && !option.disabled));
    setIsOpen(true);
  };

  const closeMenu = () => {
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const moveActive = (direction: 1 | -1) => {
    if (options.length === 0) return;
    setActiveIndex((current) => {
      let next = current;
      for (let step = 0; step < options.length; step += 1) {
        next = (next + direction + options.length) % options.length;
        if (!options[next]?.disabled) return next;
      }
      return current;
    });
  };

  const commitActive = () => {
    const option = activeIndex >= 0 ? options[activeIndex] : null;
    if (option && !option.disabled) {
      onChange(option.value);
      closeMenu();
    }
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(options.findIndex((option) => !option.disabled));
        break;
      case 'End': {
        event.preventDefault();
        const lastEnabled = [...options].reverse().findIndex((option) => !option.disabled);
        if (lastEnabled >= 0) setActiveIndex(options.length - 1 - lastEnabled);
        break;
      }
      case 'Enter':
      case ' ':
        event.preventDefault();
        commitActive();
        break;
      case 'Tab':
        closeMenu();
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    const handleScroll = (event: Event) => {
      // Scrolling inside the listbox is fine; ancestor scrolls invalidate the
      // fixed position, so close instead of chasing the trigger.
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      closeMenu();
    };
    const handleResize = () => closeMenu();

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    document.getElementById(`${menuId}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen, menuId]);

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-activedescendant={isOpen && activeIndex >= 0 ? `${menuId}-option-${activeIndex}` : undefined}
        onKeyDown={handleTriggerKeyDown}
        onClick={() => {
          if (isOpen) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
        className={`game-select-trigger flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-orange-400/60 disabled:cursor-not-allowed disabled:opacity-50 ${
          isOpen
            ? 'border-orange-400/60 bg-black/55 text-white'
            : 'border-white/15 bg-black/40 text-white hover:border-white/30'
        }`}
      >
        <span className={`min-w-0 truncate ${selected ? '' : 'text-white/40'}`}>
          {selected?.label ?? placeholder}
        </span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-white/45 transition-transform ${isOpen ? 'rotate-180 text-orange-300' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen && menuPosition && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="listbox"
          aria-label={label}
          className="game-select-menu fixed z-[400] max-h-60 overflow-y-auto overscroll-contain rounded-lg border border-white/15 bg-strike-chrome/95 p-1 shadow-2xl backdrop-blur-xl"
          style={{
            left: menuPosition.left,
            top: menuPosition.top ?? 'auto',
            bottom: menuPosition.bottom ?? 'auto',
            width: menuPosition.width,
            maxWidth: 'calc(100vw - 1rem)',
          }}
        >
          {options.length === 0 && (
            <p className="px-2.5 py-2 text-sm text-white/35">{emptyLabel}</p>
          )}
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <button
                key={option.value}
                id={`${menuId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={option.disabled}
                tabIndex={-1}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => {
                  if (option.disabled) return;
                  onChange(option.value);
                  closeMenu();
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                  option.disabled
                    ? 'cursor-not-allowed text-white/25'
                    : isSelected
                      ? 'bg-orange-500/15 text-orange-200'
                      : isActive
                        ? 'bg-white/[0.08] text-white'
                        : 'text-white/70'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-orange-300' : 'text-transparent'}`}
                    aria-hidden="true"
                  >
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" className="h-full w-full">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span className="min-w-0 truncate">{option.label}</span>
                </span>
                {option.trailing && <span className="shrink-0">{option.trailing}</span>}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
