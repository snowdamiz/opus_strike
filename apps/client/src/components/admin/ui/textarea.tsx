import * as React from 'react';
import { cn } from '../lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[72px] w-full rounded-md border border-strike-border-light bg-strike-canvas px-3 py-2 text-sm text-white shadow-sm transition-colors',
        'placeholder:text-white/30 font-body',
        'focus-visible:outline-none focus-visible:border-accent-primary/60 focus-visible:ring-1 focus-visible:ring-accent-primary/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export { Textarea };
