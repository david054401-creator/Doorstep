import { type ElementType, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// ─── Placeholder illustration ─────────────────────────────────────────────────
// A simple hand-drawn-style house SVG used when no icon prop is given.

function HouseIllustration() {
  return (
    <svg
      width="80"
      height="80"
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Roof */}
      <path
        d="M10 38L40 10L70 38"
        stroke="#E8E3DC"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* House body */}
      <rect
        x="16"
        y="37"
        width="48"
        height="32"
        rx="3"
        fill="#F5F1EA"
        stroke="#E8E3DC"
        strokeWidth="3"
      />
      {/* Door */}
      <rect
        x="31"
        y="52"
        width="18"
        height="17"
        rx="3"
        fill="#E8E3DC"
        stroke="#D4C9BC"
        strokeWidth="2"
      />
      {/* Door knob */}
      <circle cx="46" cy="61" r="2" fill="#A8A099" />
      {/* Left window */}
      <rect
        x="20"
        y="48"
        width="9"
        height="9"
        rx="2"
        fill="#E5EEF5"
        stroke="#D4C9BC"
        strokeWidth="1.5"
      />
      {/* Right window */}
      <rect
        x="51"
        y="48"
        width="9"
        height="9"
        rx="2"
        fill="#E5EEF5"
        stroke="#D4C9BC"
        strokeWidth="1.5"
      />
      {/* Chimney */}
      <rect
        x="52"
        y="15"
        width="8"
        height="14"
        rx="2"
        fill="#F5F1EA"
        stroke="#E8E3DC"
        strokeWidth="2.5"
      />
      {/* Smoke puffs */}
      <circle cx="56" cy="11" r="3.5" fill="#E8E3DC" opacity="0.7" />
      <circle cx="60" cy="7"  r="2.5" fill="#E8E3DC" opacity="0.4" />
    </svg>
  );
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  /** Defaults to true */
  primary?: boolean;
}

export interface EmptyStateProps {
  /**
   * A Lucide icon component (e.g. `import { Inbox } from 'lucide-react'`).
   * When omitted, a friendly house illustration is shown instead.
   */
  icon?: ElementType;
  title: string;
  description?: string;
  /** Primary CTA – renders a button */
  action?: EmptyStateAction;
  /** Secondary text shown below the action, e.g. "Or drag & drop a CSV" */
  helpText?: string;
  className?: string;
  children?: ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  helpText,
  className,
  children,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        'px-6 py-16 gap-4',
        className
      )}
      role="status"
      aria-label={title}
    >
      {/* Illustration / icon */}
      <div
        className="flex items-center justify-center rounded-full mb-2"
        style={{
          width: 88,
          height: 88,
          backgroundColor: '#F5F1EA',
          border: '2px solid #E8E3DC',
        }}
      >
        {Icon ? (
          <Icon
            size={40}
            strokeWidth={1.5}
            aria-hidden
            style={{ color: '#A8A099' }}
          />
        ) : (
          <HouseIllustration />
        )}
      </div>

      {/* Text */}
      <div className="flex flex-col items-center gap-2 max-w-xs">
        <h3
          className="font-display font-medium text-[22px] leading-[30px] tracking-tight"
          style={{ color: '#1A1714' }}
        >
          {title}
        </h3>

        {description && (
          <p className="text-base leading-6" style={{ color: '#6B6058' }}>
            {description}
          </p>
        )}
      </div>

      {/* Action button */}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 inline-flex items-center justify-center rounded-[12px] px-6 py-[14px] text-base font-semibold font-body text-white transition-colors duration-150 active:scale-[0.97]"
          style={{ backgroundColor: '#C75D3D' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#A84A2E';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#C75D3D';
          }}
        >
          {action.label}
        </button>
      )}

      {/* Help text */}
      {helpText && (
        <p className="text-sm" style={{ color: '#A8A099' }}>
          {helpText}
        </p>
      )}

      {/* Slot for extra content */}
      {children}
    </div>
  );
}
