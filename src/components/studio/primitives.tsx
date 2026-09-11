import type { ReactNode } from 'react';
import { C } from '@/lib/studio/format';

export function Panel({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={`rounded-xl border ${padded ? 'p-5' : ''} ${className}`}
      style={{ backgroundColor: C.panel, borderColor: C.border }}
    >
      {children}
    </section>
  );
}

export function PanelTitle({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <header className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="text-[13px] font-semibold tracking-[0.14em] uppercase" style={{ color: C.dim }}>
        {children}
      </h2>
      {note ? (
        <span className="text-[12px]" style={{ color: C.faint }}>
          {note}
        </span>
      ) : null}
    </header>
  );
}

export function Pill({
  children,
  color,
  title,
}: {
  children: ReactNode;
  color: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full border px-2 py-[2px] text-[11px] font-medium whitespace-nowrap"
      style={{ color, borderColor: `${color}55`, backgroundColor: `${color}14` }}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: ReactNode;
  color?: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[11px] tracking-[0.12em] uppercase" style={{ color: C.faint }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: color ?? C.text }}>
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-[12px]" style={{ color: C.dim }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function Empty({ title, body, code }: { title: string; body: string; code?: string }) {
  return (
    <div
      className="rounded-xl border border-dashed p-8 text-center"
      style={{ borderColor: C.border }}
    >
      <p className="text-base font-medium" style={{ color: C.text }}>
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-xl text-sm" style={{ color: C.dim }}>
        {body}
      </p>
      {code ? (
        <pre
          className="mx-auto mt-4 max-w-xl overflow-x-auto rounded-lg border p-3 text-left text-[12px]"
          style={{ borderColor: C.border, backgroundColor: C.bg, color: C.accent }}
        >
          {code}
        </pre>
      ) : null}
    </div>
  );
}

/** A horizontal 0..1 bar. Colour carries the verdict, length the value. */
export function Meter({ value, color }: { value: number; color: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div
      className="h-[6px] w-full overflow-hidden rounded-full"
      style={{ backgroundColor: C.panelHi }}
      role="meter"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${clamped * 100}%`, backgroundColor: color }}
      />
    </div>
  );
}
