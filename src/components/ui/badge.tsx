import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// ─── Variant map ──────────────────────────────────────────────────────────────
// Each variant carries bg + text as inline styles so exact brand hex is used.

const badgeVariants = cva(
  // Base
  'inline-flex items-center rounded-full px-[10px] py-[4px] text-[14px] leading-[18px] font-semibold select-none',
  {
    variants: {
      variant: {
        moss:    '',
        honey:   '',
        brick:   '',
        sky:     '',
        primary: '',
      },
    },
    defaultVariants: {
      variant: 'moss',
    },
  }
);

// Brand-color pairs keyed by variant
const variantColors: Record<string, { bg: string; text: string }> = {
  moss:    { bg: '#EEF4E5', text: '#5C8A3A' },
  honey:   { bg: '#FBF1E0', text: '#D4923B' },
  brick:   { bg: '#FAE5DE', text: '#B8442E' },
  sky:     { bg: '#E5EEF5', text: '#4A7C9E' },
  primary: { bg: '#C75D3D', text: '#FFFFFF' },
};

// ─── Component ───────────────────────────────────────────────────────────────

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Optional icon element rendered before the label */
  icon?: React.ReactNode;
}

export function Badge({ className, variant = 'moss', icon, children, style, ...props }: BadgeProps) {
  const resolvedVariant = variant ?? 'moss';
  const colors = variantColors[resolvedVariant];

  return (
    <span
      className={cn(badgeVariants({ variant }), className)}
      style={{ backgroundColor: colors.bg, color: colors.text, ...style }}
      {...props}
    >
      {icon && (
        <span className="mr-1 inline-flex items-center" aria-hidden>
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

// Named export for composing variant logic externally
export { badgeVariants };
