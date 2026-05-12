import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

// ─── Card ────────────────────────────────────────────────────────────────────

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Extra Tailwind classes */
  className?: string;
  children?: React.ReactNode;
}

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn('rounded-[20px] border border-[#E8E3DC] shadow-md', className)}
      style={{ backgroundColor: '#FFFFFF' }}
      {...props}
    >
      {children}
    </div>
  );
}

// ─── CardHeader ──────────────────────────────────────────────────────────────

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

export function CardHeader({ className, children, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn('flex items-center justify-between px-6 py-5 border-b border-[#E8E3DC]', className)}
      {...props}
    >
      {children}
    </div>
  );
}

// ─── CardBody ─────────────────────────────────────────────────────────────────

export interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

export function CardBody({ className, children, ...props }: CardBodyProps) {
  return (
    <div className={cn('px-6 py-5', className)} {...props}>
      {children}
    </div>
  );
}

// ─── CardFooter ───────────────────────────────────────────────────────────────

export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

export function CardFooter({ className, children, ...props }: CardFooterProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-6 py-4 border-t border-[#E8E3DC] rounded-b-[20px]',
        className
      )}
      style={{ backgroundColor: '#FDFCFA' }}
      {...props}
    >
      {children}
    </div>
  );
}
