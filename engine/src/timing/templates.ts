/**
 * Action templates: antic → action → overshoot → settle, applied to channels.
 *
 * These are the physical grammar of a landed action. Director notes like
 * "more punch on the jump" resolve to changes in these numbers.
 */

import type { Channel, EaseName } from '../graph/types.ts';
import { addAnticipation, addOvershoot, setKey, setEases } from './curves.ts';
import { rangeFor } from './chart.ts';
import type { ActionClass } from './chart.ts';

export type ActionShape = {
  /** Frames of counter-move before the action. */
  anticipationFrames: number;
  /** Counter-move size as a fraction of the action range. */
  anticipationAmount: number;
  /** Frames the main action takes. */
  actionFrames: number;
  /** Frames past the target before settling. */
  overshootFrames: number;
  overshootAmount: number;
  settleFrames: number;
  actionEase: EaseName;
};

/** Craft defaults per punch level, 1 (subtle) to 5 (broad). */
export function shapeFor(cls: ActionClass, punch: number, fps = 24): ActionShape {
  const [, typical] = rangeFor(cls, fps);
  const p = Math.max(1, Math.min(5, punch));
  const k = 0.6 + p * 0.18; // 0.78 .. 1.5
  return {
    anticipationFrames: Math.max(2, Math.round(rangeFor('anticipation', fps)[1] * k)),
    anticipationAmount: 0.08 + p * 0.045,
    actionFrames: Math.max(2, Math.round(typical / (0.8 + p * 0.1))),
    overshootFrames: Math.max(1, Math.round(rangeFor('overshoot', fps)[1] * (p >= 3 ? 1 : 0.6))),
    overshootAmount: p <= 1 ? 0 : 0.04 + (p - 1) * 0.04,
    settleFrames: Math.max(2, Math.round(rangeFor('settle', fps)[1] * (1.1 - p * 0.08))),
    actionEase: p >= 4 ? 'easeInStrong' : p >= 2 ? 'easeInOut' : 'easeOut',
  };
}

/**
 * Author a full action onto a channel: rest → antic → action → overshoot →
 * settle. Returns the channel plus the frames of each landmark, so the
 * timing chart and the validators can be built from the same source.
 */
export function applyActionShape(
  channel: Channel,
  options: {
    startFrame: number;
    fromValue: number;
    toValue: number;
    shape: ActionShape;
  },
): { channel: Channel; landmarks: { antic: number; action: number; peak: number; settle: number } } {
  const { startFrame, fromValue, toValue, shape } = options;
  const anticFrame = startFrame + shape.anticipationFrames;
  const actionFrame = anticFrame + shape.actionFrames;
  const peakFrame = actionFrame + shape.overshootFrames;
  const settleFrame = peakFrame + shape.settleFrames;
  const range = toValue - fromValue;

  let out = setKey(channel, { frame: startFrame, value: fromValue, ease: 'easeInOut' });
  if (shape.anticipationAmount > 0) {
    out = setKey(out, {
      frame: anticFrame,
      value: fromValue - range * shape.anticipationAmount,
      ease: 'easeOut',
    });
  }
  out = setKey(out, { frame: actionFrame, value: toValue, ease: shape.actionEase });
  if (shape.overshootAmount > 0) {
    out = setKey(out, {
      frame: peakFrame,
      value: toValue + range * shape.overshootAmount,
      ease: 'easeOut',
    });
    out = setKey(out, { frame: settleFrame, value: toValue, ease: 'easeInOut' });
  }
  return {
    channel: out,
    landmarks: { antic: anticFrame, action: actionFrame, peak: peakFrame, settle: settleFrame },
  };
}

/** "More punch": shorten the antic-to-peak span and deepen the overshoot. */
export function punchUp(channel: Channel, actionFrame: number, amount = 1): Channel {
  let out = addAnticipation(channel, actionFrame, Math.max(2, Math.round(4 * amount)), 0.12 * amount);
  out = addOvershoot(out, actionFrame, Math.max(1, Math.round(3 * amount)), Math.max(2, Math.round(5 * amount)), 0.1 * amount);
  return out;
}

/** "Too floaty": tighten every ease and compress the mid-section. */
export function tighten(channel: Channel): Channel {
  return setEases(channel, 'easeInStrong');
}

export { addAnticipation, addOvershoot };
