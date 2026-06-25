import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide font-body transition-colors',
  {
    variants: {
      variant: {
        default: 'border-strike-border-light bg-white/[0.06] text-white/80',
        primary: 'border-accent-primary/30 bg-accent-primary/15 text-accent-primary',
        secondary: 'border-accent-secondary/30 bg-accent-secondary/15 text-accent-secondary',
        success: 'border-ui-success/30 bg-ui-success/15 text-ui-success',
        warning: 'border-ui-warning/30 bg-ui-warning/15 text-ui-warning',
        danger: 'border-ui-danger/30 bg-ui-danger/15 text-ui-danger',
        info: 'border-ui-info/30 bg-ui-info/15 text-ui-info',
        outline: 'border-strike-border-light bg-transparent text-white/60',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
