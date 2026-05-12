'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

// ─── Variant definitions ───────────────────────────────────────────────────────

const buttonVariants = cva(
  // Base styles shared by all variants
  [
    'inline-flex items-center justify-center gap-2',
    'font-semibold font-body rounded-[12px]',
    'border-0 cursor-pointer select-none',
    'transition-[background-color,border-color,opacity] duration-150 ease-out',
    'active:scale-[0.97] active:brightness-95',
    // active transition is instant (100ms) — override the 150ms above
    '[transition-duration:150ms] active:[transition-duration:100ms]',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
  ],
  {
    variants: {
      variant: {
        primary: [
          'text-white',
          'focus-visible:ring-[#E07A5A]',
        ],
        ghost: [
          'bg-transparent border-2 border-solid',
          'focus-visible:ring-[#E07A5A]',
        ],
        secondary: [
          'border-0',
          'focus-visible:ring-[#A8A099]',
        ],
        danger: [
          'text-white border-0',
          'focus-visible:ring-[#B8442E]',
        ],
      },
      size: {
        sm:   'px-4 py-2 text-sm leading-5',
        md:   'px-6 py-[14px] text-base leading-6',
        lg:   'px-8 py-4 text-lg leading-7',
        full: 'w-full px-6 py-[14px] text-base leading-6',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

// ─── Component ────────────────────────────────────────────────────────────────

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

// Brand-color inline styles keyed by variant (Tailwind can't JIT arbitrary hex)
const variantStyles: Record<string, React.CSSProperties> = {
  primary:   { backgroundColor: '#C75D3D', color: '#FFFFFF' },
  ghost:     { backgroundColor: 'transparent', borderColor: '#C75D3D', color: '#C75D3D' },
  secondary: { backgroundColor: '#F5F1EA', color: '#3D362F' },
  danger:    { backgroundColor: '#B8442E', color: '#FFFFFF' },
};

const hoverStyles: Record<string, string> = {
  primary:   '#A84A2E',
  ghost:     '#FDF1EB',  // light hearth tint on hover fill
  secondary: '#E8E3DC',
  danger:    '#962419',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', style, onMouseEnter, onMouseLeave, ...props }, ref) => {
    const resolvedVariant = variant ?? 'primary';

    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        style={{ ...variantStyles[resolvedVariant], ...style }}
        onMouseEnter={(e) => {
          if (!props.disabled) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = hoverStyles[resolvedVariant];
          }
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          if (!props.disabled) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              resolvedVariant === 'ghost'
                ? 'transparent'
                : (variantStyles[resolvedVariant].backgroundColor as string);
          }
          onMouseLeave?.(e);
        }}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';

// Named export for variant helper (useful for composing)
export { buttonVariants };
