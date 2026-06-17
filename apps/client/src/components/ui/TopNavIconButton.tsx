import { type ReactNode } from 'react';

interface TopNavIconButtonProps {
  label: string;
  title?: string;
  badgeCount?: number;
  onClick: () => void;
  children: ReactNode;
}

export function TopNavIconButton({
  label,
  title,
  badgeCount = 0,
  onClick,
  children,
}: TopNavIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex h-10 w-10 shrink-0 items-center justify-center text-white/60 transition-colors duration-150 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
      aria-label={label}
      title={title ?? label}
    >
      {children}
      {badgeCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold leading-none text-white">
          {Math.min(99, badgeCount)}
        </span>
      )}
    </button>
  );
}
