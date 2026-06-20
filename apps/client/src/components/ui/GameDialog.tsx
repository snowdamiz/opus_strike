import { useId, type CSSProperties, type ReactNode } from 'react';

type GameDialogSize = 'sm' | 'md' | 'lg' | 'xl';

interface GameDialogProps {
  title: string;
  icon?: ReactNode;
  iconClassName?: string;
  size?: GameDialogSize;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  bodyClassName?: string;
  footerClassName?: string;
  panelClassName?: string;
  closeLabel?: string;
  showCloseButton?: boolean;
  style?: CSSProperties;
}

const sizeClasses: Record<GameDialogSize, string> = {
  sm: 'max-w-[min(90vw,24rem)]',
  md: 'max-w-[min(90vw,30rem)]',
  lg: 'max-w-[min(88vw,46rem)]',
  xl: 'max-w-[min(86vw,70rem)]',
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function GameDialog({
  title,
  icon,
  iconClassName = 'bg-orange-500/20 text-orange-500',
  size = 'md',
  children,
  footer,
  onClose,
  bodyClassName = 'p-[clamp(1.125rem,1.45vw,1.5rem)]',
  footerClassName = 'flex items-center justify-between gap-3 px-[clamp(1.125rem,1.45vw,1.5rem)] py-[clamp(0.75rem,1vw,1rem)] border-t border-white/5 bg-strike-elevated/50',
  panelClassName,
  closeLabel = 'Close dialog',
  showCloseButton = true,
  style,
}: GameDialogProps) {
  const titleId = useId();

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-[clamp(1rem,1.8vw,1.75rem)]">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'game-dialog relative w-full max-h-[min(84vh,46rem)] bg-strike-surface border border-white/10 rounded-xl overflow-hidden shadow-2xl animate-scale-in flex flex-col',
          sizeClasses[size],
          panelClassName,
        )}
        style={style}
      >
        <header className="flex items-center justify-between gap-4 px-[clamp(1.125rem,1.45vw,1.5rem)] py-[clamp(0.75rem,1vw,1rem)] border-b border-white/5">
          <div className="flex min-w-0 items-center gap-[clamp(0.75rem,1vw,1rem)]">
            {icon && (
              <div className={cn('w-[clamp(2rem,1.75vw,2.25rem)] h-[clamp(2rem,1.75vw,2.25rem)] rounded-lg flex shrink-0 items-center justify-center [&_svg]:h-[clamp(1rem,0.9vw,1.125rem)] [&_svg]:w-[clamp(1rem,0.9vw,1.125rem)]', iconClassName)}>
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-lg text-white truncate">
                {title}
              </h2>
            </div>
          </div>

          {showCloseButton && (
            <button
              type="button"
              onClick={onClose}
              className="w-[clamp(2rem,1.75vw,2.25rem)] h-[clamp(2rem,1.75vw,2.25rem)] rounded-lg bg-white/5 flex shrink-0 items-center justify-center text-white/40 hover:text-white hover:bg-white/10"
              aria-label={closeLabel}
            >
              <svg className="w-[clamp(1rem,0.9vw,1.125rem)] h-[clamp(1rem,0.9vw,1.125rem)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </header>

        <div className={cn('flex-1 min-h-0', bodyClassName)}>{children}</div>

        {footer && <footer className={footerClassName}>{footer}</footer>}
      </section>
    </div>
  );
}
