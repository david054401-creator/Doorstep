import type { Metadata } from 'next';
import Link from 'next/link';
import { loadBuild } from '@/lib/studio/build';
import { C, scoreColor, pct } from '@/lib/studio/format';
import { Pill } from '@/components/studio/primitives';

export const metadata: Metadata = {
  title: { default: 'Studio', template: '%s · Studio' },
  description: 'Review surface for the 2D feature engine: shots, QA, gates and the contract.',
};

/**
 * The build directory is read at request time and changes whenever the
 * engine runs, so nothing here may be prerendered at deploy time.
 */
export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/studio', label: 'Overview' },
  { href: '/studio/shots', label: 'Shots' },
  { href: '/studio/qa', label: 'QA' },
  { href: '/studio/gates', label: 'Gates' },
  { href: '/studio/notes', label: 'Notes' },
  { href: '/studio/contract', label: 'Contract' },
] as const;

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const state = await loadBuild();

  return (
    <div className="min-h-screen" style={{ backgroundColor: C.bg, color: C.text }}>
      <header className="border-b" style={{ borderColor: C.border, backgroundColor: C.panel }}>
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          <Link href="/studio" className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold tracking-tight" style={{ color: C.text }}>
              Studio
            </span>
            <span className="text-[11px] tracking-[0.18em] uppercase" style={{ color: C.faint }}>
              2D Feature Engine
            </span>
          </Link>

          <nav className="flex flex-wrap items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-[13px]"
                style={{ color: C.dim }}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {state.ok ? (
              <>
                <span className="text-[12px]" style={{ color: C.dim }}>
                  {state.build.project.name}
                </span>
                <Pill color={scoreColor(state.build.score.score)}>
                  score {pct(state.build.score.score)}
                </Pill>
                {state.build.awaitingGate.length ? (
                  <Pill color={C.warn}>{state.build.awaitingGate.length} at a gate</Pill>
                ) : null}
                {state.build.escalated.length ? (
                  <Pill color={C.fail}>{state.build.escalated.length} escalated</Pill>
                ) : null}
              </>
            ) : (
              <Pill color={C.fail}>no build</Pill>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-5 py-7">{children}</main>

      <footer
        className="mx-auto max-w-[1400px] px-5 pt-2 pb-10 text-[11px] leading-relaxed"
        style={{ color: C.faint }}
      >
        {state.ok ? (
          <>
            Built {new Date(state.build.builtAt).toLocaleString()} · graph{' '}
            <code>{state.build.graphHash.slice(0, 20)}</code> · {state.build.stats.checks} checks ·{' '}
            {state.build.stats.frames} preview frames · read from <code>{state.directory}</code>
          </>
        ) : (
          <>Looking for a build in {state.directory}</>
        )}
      </footer>
    </div>
  );
}
