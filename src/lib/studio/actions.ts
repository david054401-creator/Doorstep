'use server';

/**
 * The director's two powers, and the engine behind both.
 *
 * Law 5: the human is the director, not the animator. The studio does
 * not let anyone nudge a curve. It lets them do exactly two things —
 * approve or reject a gate, and give a note — and both are recorded as
 * structured decisions that the next engine run replays.
 *
 * Note parsing is done by the engine itself, as a subprocess. The
 * mapping from "more punch on the jump" to a set of curve operations is
 * engine logic with its own tests; reimplementing a second, drifting
 * copy of it in the web app would be a way to make the studio lie.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { revalidatePath } from 'next/cache';
import { buildDirectory, loadDecisions } from './build';
import type { DirectorNote, DrawOverStroke, HumanApproval, StructuredEdit } from './types';

const run = promisify(execFile);

/** Where `bin/film.mjs` lives. Configurable; defaults to the sibling engine. */
function enginePath(): string | null {
  const configured = process.env.FILM_ENGINE_BIN;
  const candidates = [
    configured,
    resolve(process.cwd(), 'engine', 'bin', 'film.mjs'),
    resolve(process.cwd(), '..', 'engine', 'bin', 'film.mjs'),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function saveDecisions(
  mutate: (current: { approvals: HumanApproval[]; notes: DirectorNote[] }) => void,
): Promise<void> {
  const directory = buildDirectory();
  const decisions = await loadDecisions(directory);
  mutate(decisions);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'decisions.json'), JSON.stringify(decisions, null, 2), 'utf8');
}

export type GateDecisionInput = {
  nodeId: string;
  gate: HumanApproval['gate'];
  approved: boolean;
  by: string;
  notes?: string;
};

export async function recordGateDecision(input: GateDecisionInput): Promise<void> {
  if (!input.nodeId || !input.gate) throw new Error('A gate decision must name the node and the gate.');
  if (!input.by.trim()) throw new Error('A gate decision must be signed. An unsigned approval is not an approval.');
  if (!input.approved && !input.notes?.trim()) {
    // A rejection with no reason sends the pipeline back around the
    // loop with nothing to act on.
    throw new Error('Say what is wrong. A rejection without a reason cannot be repaired.');
  }

  const decision: HumanApproval = {
    nodeId: input.nodeId,
    gate: input.gate,
    approved: input.approved,
    by: input.by.trim(),
    at: new Date().toISOString(),
    notes: input.notes?.trim() || undefined,
  };

  await saveDecisions((d) => {
    d.approvals = [...d.approvals.filter((a) => a.nodeId !== decision.nodeId), decision];
  });
  revalidatePath('/studio', 'layout');
}

export type NoteResult = {
  note: DirectorNote;
  /** Empty when the engine could not turn the note into an operation. */
  edits: StructuredEdit[];
  /** True when the engine was unavailable, so the note is unparsed. */
  unparsed: boolean;
  message: string;
};

/**
 * Parse a director note with the engine and record it.
 *
 * A note the engine cannot understand is kept anyway and marked
 * unresolved. Dropping it would be worse than useless: the director
 * said something about the film and the system pretended not to hear.
 */
export async function submitNote(input: {
  text: string;
  by: string;
  shotId?: string;
  drawOver?: DrawOverStroke[];
}): Promise<NoteResult> {
  const text = input.text.trim();
  if (!text) throw new Error('An empty note is not a note.');

  let edits: StructuredEdit[] = [];
  let unparsed = false;
  let message = '';

  const bin = enginePath();
  if (!bin) {
    unparsed = true;
    message =
      'The engine binary was not found, so this note was recorded but not translated into edits. Set FILM_ENGINE_BIN.';
  } else {
    try {
      const { stdout } = await run(process.execPath, [bin, 'note', text, '--json'], {
        maxBuffer: 8 * 1024 * 1024,
        timeout: 30_000,
      });
      const parsed = JSON.parse(stdout) as { edits?: StructuredEdit[]; message?: string };
      edits = parsed.edits ?? [];
      message =
        parsed.message ??
        (edits.length
          ? `Resolved to ${edits.length} structured edit(s).`
          : 'The engine did not recognise this note. It is recorded for a human to act on.');
    } catch (e) {
      unparsed = true;
      message = `The engine could not parse this note: ${(e as Error).message}. It is recorded unparsed.`;
    }
  }

  const note: DirectorNote = {
    id: `note_${Date.now().toString(36)}`,
    text,
    by: input.by.trim() || 'director',
    at: new Date().toISOString(),
    drawOver: input.drawOver?.length ? input.drawOver : undefined,
    edits,
    resolved: false,
    shotId: input.shotId,
  };

  await saveDecisions((d) => {
    d.notes = [...d.notes, note];
  });
  revalidatePath('/studio', 'layout');

  return { note, edits, unparsed, message };
}

export async function setNoteResolved(id: string, resolved: boolean): Promise<void> {
  await saveDecisions((d) => {
    d.notes = d.notes.map((n) => (n.id === id ? { ...n, resolved } : n));
  });
  revalidatePath('/studio', 'layout');
}
