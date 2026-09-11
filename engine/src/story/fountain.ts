/**
 * Fountain — plain-text screenplay format.
 *
 * Story is the first structured artifact, and it has to round-trip: a human
 * edits the screenplay, the engine re-derives the shot list, and nothing is
 * lost in either direction.
 */

export type FountainElementType =
  | 'title'
  | 'sceneHeading'
  | 'action'
  | 'character'
  | 'dialogue'
  | 'parenthetical'
  | 'transition'
  | 'shot'
  | 'section'
  | 'synopsis'
  | 'note'
  | 'pageBreak';

export type FountainElement = {
  type: FountainElementType;
  text: string;
  /** Character name for dialogue and parentheticals. */
  character?: string;
  /** Dual dialogue marker. */
  dual?: boolean;
  /** Section depth for '#' headings. */
  depth?: number;
  /** 1-based source line. */
  line: number;
};

export type FountainScript = {
  titlePage: Record<string, string>;
  elements: FountainElement[];
};

const SCENE_PREFIX = /^(INT\.?|EXT\.?|EST\.?|INT\.?\/EXT\.?|I\/E)[\s.]/i;
const TRANSITION_RE = /^[A-Z\s]+(TO:|IN:|OUT\.?)$/;
const CHARACTER_RE = /^[A-Z][A-Z0-9\s._'\-()]*$/;

export function parseFountain(source: string): FountainScript {
  const rawLines = source.replace(/\r\n?/g, '\n').split('\n');
  const titlePage: Record<string, string> = {};
  const elements: FountainElement[] = [];

  let i = 0;
  // Title page: "Key: value" pairs before the first blank line.
  if (rawLines.length && /^[A-Za-z ]+:/.test(rawLines[0])) {
    let lastKey = '';
    for (; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (line.trim() === '') {
        i++;
        break;
      }
      const m = /^([A-Za-z ]+):\s*(.*)$/.exec(line);
      if (m) {
        lastKey = m[1].trim().toLowerCase();
        titlePage[lastKey] = m[2].trim();
      } else if (lastKey) {
        titlePage[lastKey] = `${titlePage[lastKey]} ${line.trim()}`.trim();
      }
    }
  }

  let pendingCharacter: string | null = null;

  for (; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const lineNo = i + 1;

    if (trimmed === '') {
      pendingCharacter = null;
      continue;
    }
    if (trimmed === '===' || /^={3,}$/.test(trimmed)) {
      elements.push({ type: 'pageBreak', text: '', line: lineNo });
      continue;
    }
    if (trimmed.startsWith('#')) {
      const depth = trimmed.match(/^#+/)?.[0].length ?? 1;
      elements.push({ type: 'section', text: trimmed.replace(/^#+\s*/, ''), depth, line: lineNo });
      continue;
    }
    if (trimmed.startsWith('=')) {
      elements.push({ type: 'synopsis', text: trimmed.replace(/^=\s*/, ''), line: lineNo });
      continue;
    }
    if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) {
      elements.push({ type: 'note', text: trimmed.slice(2, -2).trim(), line: lineNo });
      continue;
    }
    // Forced elements.
    if (trimmed.startsWith('.') && !trimmed.startsWith('..')) {
      elements.push({ type: 'sceneHeading', text: trimmed.slice(1).trim(), line: lineNo });
      pendingCharacter = null;
      continue;
    }
    if (trimmed.startsWith('!')) {
      elements.push({ type: 'action', text: trimmed.slice(1), line: lineNo });
      continue;
    }
    if (trimmed.startsWith('@')) {
      pendingCharacter = trimmed.slice(1).trim();
      elements.push({ type: 'character', text: pendingCharacter, character: pendingCharacter, line: lineNo });
      continue;
    }
    if (trimmed.startsWith('>') && trimmed.endsWith('<')) {
      elements.push({ type: 'action', text: trimmed.slice(1, -1).trim(), line: lineNo });
      continue;
    }
    if (trimmed.startsWith('>')) {
      elements.push({ type: 'transition', text: trimmed.slice(1).trim(), line: lineNo });
      continue;
    }

    if (SCENE_PREFIX.test(trimmed)) {
      elements.push({ type: 'sceneHeading', text: trimmed, line: lineNo });
      pendingCharacter = null;
      continue;
    }
    if (TRANSITION_RE.test(trimmed) && trimmed === trimmed.toUpperCase()) {
      elements.push({ type: 'transition', text: trimmed, line: lineNo });
      continue;
    }
    // A shot line: all caps, short, and not followed by dialogue.
    if (pendingCharacter === null && /^[A-Z][A-Z0-9\s\-.]+$/.test(trimmed) && trimmed.length < 60) {
      const next = (rawLines[i + 1] ?? '').trim();
      const isCharacter =
        next !== '' && CHARACTER_RE.test(trimmed) && !SCENE_PREFIX.test(trimmed);
      if (isCharacter) {
        const dual = trimmed.endsWith('^');
        const name = trimmed.replace(/\^$/, '').replace(/\s*\(.*\)$/, '').trim();
        pendingCharacter = name;
        elements.push({ type: 'character', text: trimmed, character: name, dual, line: lineNo });
        continue;
      }
      elements.push({ type: 'shot', text: trimmed, line: lineNo });
      continue;
    }

    if (pendingCharacter !== null) {
      if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        elements.push({
          type: 'parenthetical',
          text: trimmed.slice(1, -1),
          character: pendingCharacter,
          line: lineNo,
        });
      } else {
        elements.push({ type: 'dialogue', text: trimmed, character: pendingCharacter, line: lineNo });
      }
      continue;
    }

    elements.push({ type: 'action', text: trimmed, line: lineNo });
  }

  return { titlePage, elements };
}

export function writeFountain(script: FountainScript): string {
  const out: string[] = [];
  const keys = Object.keys(script.titlePage);
  if (keys.length) {
    for (const k of keys) {
      const label = k.charAt(0).toUpperCase() + k.slice(1);
      out.push(`${label}: ${script.titlePage[k]}`);
    }
    out.push('');
  }
  let prev: FountainElementType | null = null;
  for (const el of script.elements) {
    const needsBlank =
      prev !== null &&
      !(prev === 'character' && (el.type === 'dialogue' || el.type === 'parenthetical')) &&
      !(prev === 'parenthetical' && el.type === 'dialogue') &&
      !(prev === 'dialogue' && (el.type === 'dialogue' || el.type === 'parenthetical'));
    if (needsBlank) out.push('');
    switch (el.type) {
      case 'sceneHeading':
        out.push(el.text.toUpperCase());
        break;
      case 'character':
        out.push(el.text.toUpperCase());
        break;
      case 'parenthetical':
        out.push(`(${el.text})`);
        break;
      case 'transition':
        out.push(`> ${el.text.toUpperCase()}`);
        break;
      case 'section':
        out.push(`${'#'.repeat(el.depth ?? 1)} ${el.text}`);
        break;
      case 'synopsis':
        out.push(`= ${el.text}`);
        break;
      case 'note':
        out.push(`[[${el.text}]]`);
        break;
      case 'pageBreak':
        out.push('===');
        break;
      case 'shot':
        out.push(el.text.toUpperCase());
        break;
      default:
        out.push(el.text);
    }
    prev = el.type;
  }
  return `${out.join('\n')}\n`;
}

/** Scene headings split into their parts. */
export type ParsedHeading = {
  interior: boolean;
  exterior: boolean;
  location: string;
  timeOfDay: string;
  raw: string;
};

export function parseSceneHeading(text: string): ParsedHeading {
  const raw = text.trim();
  const upper = raw.toUpperCase();
  const interior = /^(INT|I\/E|INT\.\/EXT)/.test(upper);
  const exterior = /^(EXT|EST|I\/E|INT\.\/EXT)/.test(upper);
  const body = raw.replace(/^(INT\.?\/EXT\.?|I\/E|INT\.?|EXT\.?|EST\.?)\s*/i, '');
  const dashIndex = body.lastIndexOf(' - ');
  const location = dashIndex >= 0 ? body.slice(0, dashIndex).trim() : body.trim();
  const timeOfDay = dashIndex >= 0 ? body.slice(dashIndex + 3).trim() : '';
  return { interior, exterior, location, timeOfDay, raw };
}

/** Every speaking character in the script, in order of first appearance. */
export function speakingCharacters(script: FountainScript): string[] {
  const seen: string[] = [];
  for (const el of script.elements) {
    if (el.type === 'character' && el.character && !seen.includes(el.character)) {
      seen.push(el.character);
    }
  }
  return seen;
}

/** Total dialogue word count, used by the read-aloud duration estimate. */
export function dialogueWordCount(script: FountainScript): number {
  return script.elements
    .filter((e) => e.type === 'dialogue')
    .reduce((a, e) => a + e.text.trim().split(/\s+/).filter(Boolean).length, 0);
}

export function actionWordCount(script: FountainScript): number {
  return script.elements
    .filter((e) => e.type === 'action')
    .reduce((a, e) => a + e.text.trim().split(/\s+/).filter(Boolean).length, 0);
}
