'use client';

import { useMemo, useState } from 'react';
import type { CheckResult } from '@/lib/studio/types';
import { bySeverity } from '@/lib/studio/types';
import { C, severityColor, measurement, locatorLabel, assetUrl } from '@/lib/studio/format';
import { Pill } from './primitives';

/**
 * The QA surface.
 *
 * Two rules it is built around. First, a check is never shown as a bare
 * pass or fail: the measured value, the threshold and the diagnosis are
 * the useful part, and they are always on screen. Second, failures sort
 * first and the default filter hides nothing — a dashboard that opens on
 * a wall of green is decoration.
 */
export function CheckList({
  checks,
  frameHref,
  compact = false,
}: {
  checks: CheckResult[];
  /** Turn a frame citation into a link into the animatic. */
  frameHref?: (frame: number) => string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<'all' | 'failing' | 'warnings'>('all');
  const [department, setDepartment] = useState<string>('all');

  const departments = useMemo(
    () => [...new Set(checks.map((c) => c.department))].sort(),
    [checks],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return checks
      .filter((c) => {
        if (only === 'failing' && (c.pass || c.severity === 'info' || c.severity === 'warn')) return false;
        if (only === 'warnings' && (c.pass || c.severity !== 'warn')) return false;
        if (department !== 'all' && c.department !== department) return false;
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          c.message.toLowerCase().includes(q) ||
          (c.diagnosis ?? '').toLowerCase().includes(q)
        );
      })
      .sort(bySeverity);
  }, [checks, query, only, department]);

  const failing = checks.filter((c) => !c.pass && (c.severity === 'error' || c.severity === 'fatal')).length;
  const warning = checks.filter((c) => !c.pass && c.severity === 'warn').length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name, message or diagnosis"
          className="min-w-[220px] flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ backgroundColor: C.bg, borderColor: C.border, color: C.text }}
        />
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ backgroundColor: C.bg, borderColor: C.border, color: C.text }}
        >
          <option value="all">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <div className="flex overflow-hidden rounded-lg border" style={{ borderColor: C.border }}>
          {(
            [
              ['all', `All ${checks.length}`],
              ['failing', `Failing ${failing}`],
              ['warnings', `Warnings ${warning}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setOnly(key)}
              className="px-3 py-2 text-[12px] font-medium"
              style={{
                backgroundColor: only === key ? C.panelHi : 'transparent',
                color: only === key ? C.text : C.dim,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm" style={{ color: C.dim }}>
          Nothing matches that filter.
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((c, i) => {
            const color = severityColor(c.severity, c.pass);
            const m = measurement(c);
            const locator = locatorLabel(c.where);
            return (
              <li
                key={`${c.name}-${i}`}
                className="rounded-lg border p-3"
                style={{ borderColor: C.border, backgroundColor: C.bg }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <code className="text-[13px] font-semibold" style={{ color: C.text }}>
                    {c.name}
                  </code>
                  <Pill color={color}>{c.pass ? 'pass' : c.severity}</Pill>
                  {m ? (
                    <Pill color={C.dim} title="Measured against the threshold">
                      {m}
                    </Pill>
                  ) : null}
                  {c.diagnosis ? (
                    <Pill color={C.accent} title="Routes into the repair table">
                      {c.diagnosis}
                    </Pill>
                  ) : null}
                  <span className="ml-auto text-[11px]" style={{ color: C.faint }}>
                    {c.department}
                  </span>
                </div>
                {compact ? null : (
                  <p className="mt-2 text-[13px] leading-relaxed" style={{ color: C.dim }}>
                    {c.message}
                  </p>
                )}
                {(locator || c.evidence?.length) && !compact ? (
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]" style={{ color: C.faint }}>
                    {locator ? <span>{locator}</span> : null}
                    {c.evidence?.map((e, j) => {
                      const frame = e.ref.startsWith('frame:') ? Number(e.ref.slice(6)) : NaN;
                      const href =
                        frameHref && Number.isFinite(frame) ? frameHref(frame) : undefined;
                      const body = `${e.kind}: ${e.caption ?? e.ref}`;
                      return href ? (
                        <a
                          key={j}
                          href={href}
                          className="underline underline-offset-2"
                          style={{ color: C.info }}
                        >
                          {body}
                        </a>
                      ) : (
                        <span key={j}>{body}</span>
                      );
                    })}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export { assetUrl };
