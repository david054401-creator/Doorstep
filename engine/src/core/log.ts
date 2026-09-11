/**
 * Structured event log. Everything the engine does emits an event; the QA
 * dashboard and the escalation cards are both just views over this stream.
 */

export type EventLevel = 'debug' | 'info' | 'warn' | 'error';

export type EngineEvent = {
  at: string;
  level: EventLevel;
  /** e.g. "orchestrator", "rig", "critic.vlm" */
  channel: string;
  message: string;
  data?: Record<string, unknown>;
  /** Node id in the DAG, when the event belongs to one. */
  nodeId?: string;
  shotId?: string;
  durationMs?: number;
};

export type Logger = {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(channel: string, context?: Record<string, unknown>): Logger;
  events(): readonly EngineEvent[];
};

export type LoggerOptions = {
  channel?: string;
  minLevel?: EventLevel;
  /** Mirror to stderr. Off inside tests. */
  echo?: boolean;
  sink?: EngineEvent[];
  context?: Record<string, unknown>;
  /** Injectable clock keeps golden-file tests stable. */
  now?: () => string;
  color?: boolean;
};

const ORDER: Record<EventLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const ESC = String.fromCharCode(27);
const COLOR: Record<EventLevel, string> = {
  debug: `${ESC}[90m`,
  info: `${ESC}[36m`,
  warn: `${ESC}[33m`,
  error: `${ESC}[31m`,
};
const RESET = `${ESC}[0m`;
const DIM = `${ESC}[2m`;

export function createLogger(options: LoggerOptions = {}): Logger {
  const sink: EngineEvent[] = options.sink ?? [];
  const channel = options.channel ?? 'engine';
  const minLevel = options.minLevel ?? 'info';
  const echo = options.echo ?? false;
  const color = options.color ?? true;
  const context = options.context ?? {};
  const now = options.now ?? (() => new Date().toISOString());

  const emit = (level: EventLevel, message: string, data?: Record<string, unknown>): void => {
    const merged = { ...context, ...(data ?? {}) };
    const event: EngineEvent = {
      at: now(),
      level,
      channel,
      message,
      data: Object.keys(merged).length ? merged : undefined,
      nodeId: typeof merged.nodeId === 'string' ? merged.nodeId : undefined,
      shotId: typeof merged.shotId === 'string' ? merged.shotId : undefined,
    };
    sink.push(event);
    if (echo && ORDER[level] >= ORDER[minLevel]) {
      const extra = event.data ? ` ${JSON.stringify(event.data)}` : '';
      const line = color
        ? `${COLOR[level]}${level.padEnd(5)}${RESET} ${DIM}${channel}${RESET} ${message}${extra}`
        : `${level.padEnd(5)} ${channel} ${message}${extra}`;
      process.stderr.write(`${line}\n`);
    }
  };

  return {
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
    child: (sub, ctx) =>
      createLogger({
        ...options,
        sink,
        channel: `${channel}.${sub}`,
        context: { ...context, ...(ctx ?? {}) },
      }),
    events: () => sink,
  };
}

export const silentLogger = (): Logger => createLogger({ echo: false });
