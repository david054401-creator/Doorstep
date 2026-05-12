'use client';

import {
  forwardRef,
  useState,
  useId,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

// ─── Shared style helpers ─────────────────────────────────────────────────────

/** Returns the border-color style based on error / focus state */
function fieldBorderStyle(hasError: boolean, focused: boolean): React.CSSProperties {
  if (hasError) return { borderColor: '#B8442E' };
  if (focused)  return { borderColor: '#E07A5A', boxShadow: '0 0 0 3px rgba(224,122,90,0.18)' };
  return { borderColor: '#E8E3DC' };
}

const baseFieldClass = [
  'w-full rounded-[12px] border bg-[#F5F1EA]',
  'font-body text-base text-[#1A1714] placeholder:text-[#A8A099]',
  'px-4 py-3 outline-none',
  'transition-[border-color,box-shadow] duration-150 ease-out',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

// ─── Label ────────────────────────────────────────────────────────────────────

interface LabelProps {
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

function Label({ htmlFor, required, children, className }: LabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        'block text-sm font-semibold mb-1.5',
        className
      )}
      style={{ color: '#3D362F' }}
    >
      {children}
      {required && (
        <span className="ml-0.5" style={{ color: '#B8442E' }} aria-hidden>
          *
        </span>
      )}
    </label>
  );
}

// ─── Error message ────────────────────────────────────────────────────────────

function ErrorMessage({ id, message }: { id?: string; message: string }) {
  return (
    <p
      id={id}
      role="alert"
      className={cn('mt-1.5 text-sm animate-shake')}
      style={{ color: '#B8442E' }}
    >
      {message}
    </p>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helpText?: string;
  /** Element to render inside the left side of the input (e.g. icon) */
  leftAddon?: ReactNode;
  /** Element to render inside the right side of the input (e.g. icon / clear button) */
  rightAddon?: ReactNode;
  /** Hide label visually but keep it accessible */
  srOnlyLabel?: boolean;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helpText,
      leftAddon,
      rightAddon,
      srOnlyLabel,
      wrapperClassName,
      className,
      id: externalId,
      required,
      disabled,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const id = externalId ?? generatedId;
    const errorId = `${id}-error`;
    const helpId  = `${id}-help`;

    const [focused, setFocused] = useState(false);
    const hasError = Boolean(error);

    return (
      <div className={cn('flex flex-col', wrapperClassName)}>
        {label && (
          <Label
            htmlFor={id}
            required={required}
            className={srOnlyLabel ? 'sr-only' : undefined}
          >
            {label}
          </Label>
        )}

        <div className="relative flex items-center">
          {leftAddon && (
            <span
              className="pointer-events-none absolute left-3 flex items-center"
              style={{ color: '#A8A099' }}
            >
              {leftAddon}
            </span>
          )}

          <input
            ref={ref}
            id={id}
            required={required}
            disabled={disabled}
            aria-describedby={
              [hasError ? errorId : '', helpText ? helpId : ''].filter(Boolean).join(' ') || undefined
            }
            aria-invalid={hasError ? 'true' : undefined}
            className={cn(
              baseFieldClass,
              leftAddon  && 'pl-10',
              rightAddon && 'pr-10',
              hasError   && 'animate-shake',
              className
            )}
            style={{
              fontSize: '16px',        // prevents iOS zoom on focus
              fontFamily: 'Inter, sans-serif',
              ...fieldBorderStyle(hasError, focused),
            }}
            onFocus={(e) => {
              setFocused(true);
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              props.onBlur?.(e);
            }}
            {...props}
          />

          {rightAddon && (
            <span
              className="absolute right-3 flex items-center"
              style={{ color: '#A8A099' }}
            >
              {rightAddon}
            </span>
          )}
        </div>

        {hasError && <ErrorMessage id={errorId} message={error!} />}

        {helpText && !hasError && (
          <p id={helpId} className="mt-1.5 text-sm" style={{ color: '#6B6058' }}>
            {helpText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

// ─── Textarea ─────────────────────────────────────────────────────────────────

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helpText?: string;
  srOnlyLabel?: boolean;
  wrapperClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      error,
      helpText,
      srOnlyLabel,
      wrapperClassName,
      className,
      id: externalId,
      required,
      rows = 4,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const id = externalId ?? generatedId;
    const errorId = `${id}-error`;
    const helpId  = `${id}-help`;

    const [focused, setFocused] = useState(false);
    const hasError = Boolean(error);

    return (
      <div className={cn('flex flex-col', wrapperClassName)}>
        {label && (
          <Label
            htmlFor={id}
            required={required}
            className={srOnlyLabel ? 'sr-only' : undefined}
          >
            {label}
          </Label>
        )}

        <textarea
          ref={ref}
          id={id}
          required={required}
          rows={rows}
          aria-describedby={
            [hasError ? errorId : '', helpText ? helpId : ''].filter(Boolean).join(' ') || undefined
          }
          aria-invalid={hasError ? 'true' : undefined}
          className={cn(
            baseFieldClass,
            'resize-y min-h-[96px]',
            hasError && 'animate-shake',
            className
          )}
          style={{
            fontSize: '16px',
            fontFamily: 'Inter, sans-serif',
            ...fieldBorderStyle(hasError, focused),
          }}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          {...props}
        />

        {hasError && <ErrorMessage id={errorId} message={error!} />}

        {helpText && !hasError && (
          <p id={helpId} className="mt-1.5 text-sm" style={{ color: '#6B6058' }}>
            {helpText}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
