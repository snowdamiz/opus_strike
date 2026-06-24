import * as React from 'react';
import { cn } from '../lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-strike-border-light bg-strike-canvas px-3 py-1 text-sm text-white shadow-sm transition-colors',
        'placeholder:text-white/30 font-body',
        'focus-visible:outline-none focus-visible:border-accent-primary/60 focus-visible:ring-1 focus-visible:ring-accent-primary/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export { Input };
