import { useId, type ReactNode } from 'react';

type GameDialogSize = 'sm' | 'md' | 'lg' | 'xl';

interface GameDialogProps {
  title: string;
  description?: string;
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
}

const sizeClasses: Record<GameDialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-xl lg:max-w-2xl xl:max-w-3xl 2xl:max-w-4xl',
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function GameDialog({
  title,
  description,
  icon,
  iconClassName = 'bg-orange-500/20 text-orange-500',
  size = 'md',
  children,
  footer,
  onClose,
  bodyClassName = 'p-6',
  footerClassName = 'flex items-center justify-between px-6 py-4 border-t border-white/5 bg-strike-elevated/50',
  panelClassName,
  closeLabel = 'Close dialog',
  showCloseButton = true,
}: GameDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'relative w-full max-h-[85vh] bg-strike-surface border border-white/10 rounded-2xl overflow-hidden shadow-2xl animate-scale-in flex flex-col',
          sizeClasses[size],
          panelClassName,
        )}
      >
        <header className="flex items-center justify-between gap-4 px-6 py-5 border-b border-white/5">
          <div className="flex min-w-0 items-center gap-3">
            {icon && (
              <div className={cn('w-10 h-10 rounded-lg flex shrink-0 items-center justify-center', iconClassName)}>
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-2xl text-white truncate">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-white/40 font-body">
                  {description}
                </p>
              )}
            </div>
          </div>

          {showCloseButton && (
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-lg bg-white/5 flex shrink-0 items-center justify-center text-white/40 hover:text-white hover:bg-white/10"
              aria-label={closeLabel}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
