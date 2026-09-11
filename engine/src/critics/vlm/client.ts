/**
 * Vision-language critic client.
 *
 * The Anthropic implementation is the reference; any provider that can
 * take images plus an instruction and return JSON fits the same seam.
 *
 * Two rules are enforced here rather than trusted to the model:
 *   - a verdict with no frame citation is downgraded to "uncertain",
 *     because an uncitable finding cannot be repaired or reviewed;
 *   - a critic never gates on its own; the ensemble and the calibration
 *     record decide whether its verdict is allowed to block anything.
 */

import type { VlmProvider, VlmRequest, Rubric } from '../types.ts';
import type { CriticVerdict } from '../../graph/types.ts';
import { renderRubricPrompt } from './rubrics.ts';
import { encodePng } from '../../raster/png.ts';
import { resize } from '../../raster/buffer.ts';
import type { ImageBuffer } from '../../raster/buffer.ts';

export type AnthropicVlmOptions = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** Longest edge the images are downscaled to before sending. */
  maxEdge?: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
  /** Seconds to wait before giving up on a call. */
  timeoutSeconds?: number;
};

const DEFAULT_MODEL = 'claude-sonnet-5';

/**
 * Build an Anthropic-backed critic.
 *
 * Returns null when no API key is configured, so the caller can report
 * honestly that the tier-2 critic did not run instead of pretending it
 * passed.
 */
export function anthropicVlm(options: AnthropicVlmOptions = {}): VlmProvider | null {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
  const maxEdge = options.maxEdge ?? 768;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: 'anthropic',
    model,
    async critique(request: VlmRequest): Promise<CriticVerdict> {
      const frames = request.images.map((i) => i.frame);
      const prompt = renderRubricPrompt(
        request.rubric,
        {
          styleBible: request.context.styleBible
            ? summariseBible(request.context.styleBible)
            : undefined,
          intent: request.context.shot?.beats.map((b) => b.intent).join(' / '),
          characters: request.context.characterNames,
          extra: request.context.extra,
        },
        frames,
      );

      const content: unknown[] = [];
      for (const img of request.images) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: encodePng(downscale(img.image, maxEdge), { level: 6 }).toString('base64'),
          },
        });
      }
      content.push({ type: 'text', text: prompt });

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        (options.timeoutSeconds ?? 90) * 1000,
      );
      try {
        const response = await doFetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: options.maxTokens ?? 1024,
            messages: [{ role: 'user', content }],
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.text();
          return uncertain(
            request.rubric,
            model,
            `The critic could not be reached (HTTP ${response.status}): ${body.slice(0, 180)}`,
          );
        }
        const json = (await response.json()) as {
          content?: { type: string; text?: string }[];
        };
        const text = (json.content ?? [])
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('\n');
        return parseVerdict(text, request.rubric, model);
      } catch (e) {
        return uncertain(request.rubric, model, `The critic call failed: ${(e as Error).message}`);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function downscale(img: ImageBuffer, maxEdge: number): ImageBuffer {
  const longest = Math.max(img.width, img.height);
  if (longest <= maxEdge) return img;
  const k = maxEdge / longest;
  return resize(img, Math.round(img.width * k), Math.round(img.height * k));
}

function summariseBible(bible: NonNullable<VlmRequest['context']['styleBible']>): string {
  return [
    bible.statement,
    `Shape language: ${bible.shapeLanguage.primary}`,
    `Line: ${bible.lineRules.quality}, weight ${bible.lineRules.weight}px, colour ${bible.lineRules.color}.`,
    `Shading: ${bible.lightingRules.shadingModel}, key at ${bible.lightingRules.keyDirection} degrees, ${bible.lightingRules.shadowQuality}.`,
    `Forbidden: ${bible.forbidden.join('; ')}.`,
  ].join('\n');
}

/**
 * Parse a critic's reply.
 *
 * Tolerant of fenced code blocks and surrounding prose, strict about the
 * citation requirement.
 */
export function parseVerdict(text: string, rubric: Rubric, model: string): CriticVerdict {
  const json = extractJson(text);
  if (!json) {
    return uncertain(rubric, model, `The critic did not return JSON. Raw reply: ${text.slice(0, 200)}`);
  }
  const raw = json as {
    verdict?: string;
    confidence?: number;
    citations?: { frame?: number; note?: string }[];
    rationale?: string;
  };
  const citations = (raw.citations ?? [])
    .filter((c) => typeof c.frame === 'number' && Number.isFinite(c.frame))
    .map((c) => ({ frame: Math.round(c.frame as number), note: String(c.note ?? '') }));

  let verdict: CriticVerdict['verdict'] =
    raw.verdict === 'pass' ? 'pass' : raw.verdict === 'fail' ? 'fail' : 'uncertain';

  let rationale = String(raw.rationale ?? '').trim();
  // A failure with no citation cannot be acted on, so it is not a failure
  // we are willing to act on either.
  if (verdict === 'fail' && citations.length === 0) {
    verdict = 'uncertain';
    rationale = `${rationale} (Downgraded: the critic reported a failure but cited no frame, so the finding cannot be located or repaired.)`.trim();
  }

  return {
    critic: 'vlm',
    rubric: rubric.id,
    verdict,
    confidence: clamp01(Number(raw.confidence ?? 0.5)),
    citations,
    rationale: rationale || 'No rationale given.',
    model,
  };
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function uncertain(rubric: Rubric, model: string, reason: string): CriticVerdict {
  return {
    critic: 'vlm',
    rubric: rubric.id,
    verdict: 'uncertain',
    confidence: 0,
    citations: [],
    rationale: reason,
    model,
  };
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/**
 * A deterministic offline critic.
 *
 * Used by tests and by any run without network access. It does not
 * pretend to see: it returns "uncertain" with an explicit reason, which
 * is what an honest score sheet should show when tier 2 did not run.
 */
export function offlineVlm(reason = 'No vision-language provider is configured.'): VlmProvider {
  return {
    name: 'offline',
    model: 'none',
    critique: async (request) => ({
      critic: 'vlm',
      rubric: request.rubric.id,
      verdict: 'uncertain',
      confidence: 0,
      citations: [],
      rationale: reason,
      model: 'none',
    }),
  };
}
