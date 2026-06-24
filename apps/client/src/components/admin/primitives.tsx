import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { clampPercent, cx, toneForSystemStatus } from './format';
import type { Tone } from './types';

export function Panel({
  title,
  meta,
  bleed = false,
  children,
}: {
  title: string;
  meta?: ReactNode;
  /** Remove body padding (for full-bleed tables). */
  bleed?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="ac-panel">
      <div className="ac-panel__header">
        <h2 className="ac-panel__title">{title}</h2>
        {meta != null && (typeof meta === 'string'
          ? <span className="ac-panel__meta">{meta}</span>
          : meta)}
      </div>
      <div className={bleed ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

export function Pill({
  children,
  tone = 'neutral',
  withDot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  withDot?: boolean;
}) {
  return (
    <span className="ac-pill" data-tone={tone}>
      {withDot && <span className="ac-pill__dot" />}
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={toneForSystemStatus(status)} withDot>{status}</Pill>;
}

export function Meter({ value, tone = 'info' }: { value: number; tone?: Tone }) {
  return (
    <div className="ac-meter">
      <div className="ac-meter__fill" data-tone={tone} style={{ width: `${clampPercent(value)}%` }} />
    </div>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone = 'neutral',
  meter,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: Tone;
  meter?: number;
}) {
  return (
    <div className="ac-kpi">
      <div className="ac-kpi__label">{label}</div>
      <div className="ac-kpi__value">{value}</div>
      {sub && <div className="ac-kpi__sub">{sub}</div>}
      {typeof meter === 'number' && <Meter value={meter} tone={tone} />}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger';
  size?: 'md' | 'sm';
};

export function Button({ variant = 'default', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'ac-btn',
        variant === 'primary' && 'ac-btn--primary',
        variant === 'danger' && 'ac-btn--danger',
        size === 'sm' && 'ac-btn--sm',
        className,
      )}
      {...rest}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="ac-label">{label}</span>
      <div className="mt-2">{children}</div>
      {hint != null && <div className="ac-hint mt-1.5">{hint}</div>}
    </label>
  );
}

export function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('ac-toggle', checked && 'is-on')}
    >
      <span className="ac-toggle__track"><span className="ac-toggle__knob" /></span>
      <span>{label}</span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  disabled,
  tone,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  tone?: 'accent' | 'amber';
  onChange: (value: T) => void;
}) {
  return (
    <div className="ac-segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          data-tone={tone}
          onClick={() => onChange(option.value)}
          className={cx('ac-segmented__btn', value === option.value && 'is-active')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <div className="ac-empty">{label}</div>;
}

export function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return <th className={right ? 'ac-th-right' : undefined}>{children}</th>;
}

export function Td({ children, right = false, mono = false }: { children: ReactNode; right?: boolean; mono?: boolean }) {
  return <td className={cx(right && 'ac-td-right', mono && 'ac-mono text-[11px]')}>{children}</td>;
}

export function TableScroll({ minWidth, children }: { minWidth: number; children: ReactNode }) {
  return (
    <div className="ac-scroll overflow-x-auto">
      <table className="ac-table" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}
