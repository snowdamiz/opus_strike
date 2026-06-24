import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './lib/utils';

/* ----------------------------- SectionHeader ------------------------ */

export function SectionHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {Icon ? (
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border border-strike-border bg-strike-canvas text-accent-primary">
            <Icon className="h-5 w-5" />
          </div>
        ) : null}
        <div>
          <h2 className="font-display text-2xl tracking-wide text-white">{title}</h2>
          {description ? (
            <p className="mt-0.5 max-w-2xl text-sm text-white/45">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ----------------------------- Stat tile ---------------------------- */

const toneText: Record<string, string> = {
  default: 'text-white',
  primary: 'text-accent-primary',
  secondary: 'text-accent-secondary',
  success: 'text-ui-success',
  warning: 'text-ui-warning',
  danger: 'text-ui-danger',
};

export function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'default',
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  tone?: keyof typeof toneText | string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-strike-border bg-strike-panel-raised p-4',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">
          {label}
        </span>
        {Icon ? <Icon className="h-4 w-4 text-white/30" /> : null}
      </div>
      <div
        className={cn(
          'mt-2 font-display text-3xl leading-none tracking-wide',
          toneText[tone] ?? 'text-white'
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-1.5 text-xs text-white/40">{sub}</div> : null}
    </div>
  );
}

/* ----------------------------- Field -------------------------------- */

export function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="block text-xs font-medium uppercase tracking-wide text-white/60"
        >
          {label}
        </label>
      ) : null}
      {children}
      {hint ? <p className="text-[11px] text-white/35">{hint}</p> : null}
    </div>
  );
}

/* ----------------------------- KeyValue ----------------------------- */

export function KeyValue({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-white/45">{label}</span>
      <span className={cn('text-right text-white/85', mono && 'font-mono text-xs')}>
        {value}
      </span>
    </div>
  );
}

/* ----------------------------- StatusDot ---------------------------- */

const dotTone: Record<string, string> = {
  success: 'bg-ui-success',
  warning: 'bg-ui-warning',
  danger: 'bg-ui-danger',
  info: 'bg-ui-info',
  muted: 'bg-white/30',
};

export function StatusDot({
  tone = 'muted',
  pulse,
  className,
}: {
  tone?: keyof typeof dotTone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('relative flex h-2 w-2', className)}>
      {pulse ? (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
            dotTone[tone]
          )}
        />
      ) : null}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', dotTone[tone])} />
    </span>
  );
}

/* ----------------------------- EmptyState --------------------------- */

export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-strike-border bg-strike-canvas/40 px-6 py-12 text-center',
        className
      )}
    >
      {Icon ? <Icon className="h-7 w-7 text-white/25" /> : null}
      <p className="text-sm font-medium text-white/70">{title}</p>
      {description ? <p className="max-w-sm text-xs text-white/40">{description}</p> : null}
    </div>
  );
}
