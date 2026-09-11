/**
 * `film` — the engine's command line.
 *
 * Every command that produces something also prints a score sheet.
 * Nothing reports success without one.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildMiboProject, MIBO_SCRIPT } from '../../examples/mibo/project.ts';
import { parseProject, safeParseProject } from '../graph/schema.ts';
import type { Project, Shot } from '../graph/types.ts';
import { buildPipeline } from '../orchestrator/pipeline.ts';
import { runDag } from '../orchestrator/runner.ts';
import { fileCache, memoryCache } from '../orchestrator/cache.ts';
import { formatLedger, planShots } from '../orchestrator/budget.ts';
import { createLogger } from '../core/log.ts';
import { scoreSheet, rollUp } from '../core/result.ts';
import type { CheckResult } from '../core/result.ts';
import { canDeliver, formatContract } from '../validators/invariants.ts';
import { allShots } from '../story/script-to-shots.ts';
import { scriptToSequence } from '../story/script-to-shots.ts';
import { validateStory, checkContinuity } from '../story/validators.ts';
import { validateGrammar } from '../director/grammar.ts';
import { validateRig } from '../rig/validators.ts';
import { repairRig, buildEscalationSummary } from '../rig/repair.ts';
import { parseNote, applyNote, makeNote } from '../director/notes.ts';
import { blockShot } from '../animation/blocking.ts';
import { evaluateShot } from '../animation/evaluate.ts';
import { renderScene } from '../render/renderer.ts';
import { withFraming } from '../orchestrator/pipeline.ts';
import { writeSequence, contactSheet, encodeMovie, buildManifest, writeManifest, hasFfmpeg } from '../delivery/sequence.ts';
import { scenesToPlan, planStats } from '../delivery/blender.ts';
import {
  buildStudio,
  shotSummary,
  writeShotFrames,
  writeStudioImage,
  writeStudioBuild,
  readDecisions,
  writeDecisions,
} from '../delivery/studio.ts';
import type { StudioNode, StudioShot } from '../delivery/studio.ts';
import { validatePlanCoverage } from '../validators/substrate.ts';
import { encodePng } from '../raster/png.ts';
import { describeProviders, deterministicProviders } from '../providers/registry.ts';
import { loadConfig, resolveProviders, providerCaveats, CONFIG_FILENAME } from '../providers/config.ts';
import { scaffold } from './init.ts';
import { poseRig, defaultSwaps } from '../rig/rig.ts';
import { emptyScene } from '../render/scene.ts';
import { parseHex } from '../core/color.ts';
import { mTranslate } from '../core/math.ts';
import { POSE_BATTERY } from '../rig/battery.ts';
import { createImage, paste } from '../raster/buffer.ts';
import { timecode } from '../core/units.ts';

const ESC = String.fromCharCode(27);
const bold = (s: string): string => `${ESC}[1m${s}${ESC}[0m`;
const dim = (s: string): string => `${ESC}[2m${s}${ESC}[0m`;
const green = (s: string): string => `${ESC}[32m${s}${ESC}[0m`;
const red = (s: string): string => `${ESC}[31m${s}${ESC}[0m`;
const yellow = (s: string): string => `${ESC}[33m${s}${ESC}[0m`;

export type Args = {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
};

export function parseArgs(argv: readonly string[]): Args {
  const [command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (rest[i + 1] && !rest[i + 1].startsWith('-')) flags[a.slice(2)] = rest[++i];
      else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { command, positional, flags };
}

const HELP = `${bold('film')} — 2D Feature Engine

  ${bold('film init')} <name> [dir]        Scaffold a new film: script, bible, graph, config
  ${bold('film demo')}                     Build the MIBO demo project and write it out
  ${bold('film build')} [project.json]     Run the full pipeline, print the score sheet
  ${bold('film validate')} [project.json]  Validate without rendering
  ${bold('film rig')} [project.json]       Rig every character and run the battery
  ${bold('film battery')} <characterId>    Render the twenty-pose battery as a contact sheet
  ${bold('film render')} [project.json]    Render frames and write a delivery manifest
  ${bold('film studio')} [project.json]    Build everything the studio UI reads
  ${bold('film export-blender')} [project]  Export Grease Pencil plans for the Blender substrate
  ${bold('film note')} "<text>"            Parse a director note into structured edits
  ${bold('film contract')} [project.json]  Audit against the thirteen hard invariants
  ${bold('film providers')}                Report which providers are configured
  ${bold('film doctor')}                   Check the environment

Flags
  --out <dir>        Output directory (default: ./out)
  --width, --height  Render size (default: the delivery spec)
  --samples <n>      Anti-aliasing samples (default 4; 8 for a master)
  --shot <id>        Restrict to one shot
  --stage <name>     story | boards | animation | render | delivery
  --attempts <n>     Repair attempts per node
  --no-cache         Ignore the content-addressed cache
  --json             Machine-readable output
  --quiet            Errors only

Studio flags
  --preview-width <n>  Frame width written for the animatic (default 640)
  --every <n>          Write every Nth frame (default 1)
  --gates <mode>       hold | approve — whether the CLI stands in for the director
`;

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const out = resolve(String(args.flags.out ?? 'out'));
  const quiet = !!args.flags.quiet;
  const asJson = !!args.flags.json;
  const logger = createLogger({ echo: !quiet && !asJson, minLevel: 'info', color: !asJson });

  switch (args.command) {
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(`${HELP}\n`);
      return 0;

    case 'init': {
      const name = args.positional[0];
      if (!name) {
        process.stderr.write('Name the film: film init "The Lost Hum" [directory]\n');
        return 1;
      }
      const directory = resolve(args.positional[1] ?? '.');
      const result = scaffold({
        name,
        directory,
        force: !!args.flags.force,
        fps: args.flags.fps ? Number(args.flags.fps) : undefined,
        width: args.flags.width ? Number(args.flags.width) : undefined,
        height: args.flags.height ? Number(args.flags.height) : undefined,
      });
      const lines = result.written.map((f) => `${green('Wrote')} ${f}`);
      for (const f of result.skipped) {
        lines.push(`${yellow('Kept')}  ${f} ${dim('(already there; --force to overwrite)')}`);
      }
      lines.push('');
      lines.push(`${bold(name)} is scaffolded. Next:`);
      lines.push(dim(`  cd ${directory}`));
      lines.push(dim('  film validate          # every check, no pixels'));
      lines.push(dim('  film studio --out out  # build what the studio UI reads'));
      print(lines.join('\n'), quiet);
      return 0;
    }

    case 'demo': {
      mkdirSync(out, { recursive: true });
      const project = buildMiboProject({ logger });
      writeFileSync(join(out, 'project.json'), JSON.stringify(project, null, 2));
      writeFileSync(join(out, 'script.fountain'), MIBO_SCRIPT);
      const shots = allShots(project.sequences[0]);
      print(
        [
          `${green('Wrote')} ${join(out, 'project.json')}`,
          `${green('Wrote')} ${join(out, 'script.fountain')}`,
          '',
          `${bold(project.name)} — ${project.logline}`,
          `${project.characters.length} characters, ${project.environments.length} environments, ${shots.length} shots, ${shots.reduce((a, s) => a + s.durationFrames, 0)} frames (${timecode(shots.reduce((a, s) => a + s.durationFrames, 0), project.deliverySpec.fps)})`,
        ].join('\n'),
        quiet,
      );
      return 0;
    }

    case 'validate':
    case 'build':
    case 'render': {
      const project = loadProject(args.positional[0]);
      const stage =
        (args.flags.stage as 'story' | 'boards' | 'animation' | 'render' | 'delivery') ??
        (args.command === 'validate' ? 'animation' : args.command === 'render' ? 'render' : 'render');
      const dag = buildPipeline(project, {
        logger,
        width: args.flags.width ? Number(args.flags.width) : undefined,
        height: args.flags.height ? Number(args.flags.height) : undefined,
        samples: args.flags.samples ? Number(args.flags.samples) : 4,
        throughStage: stage,
        shotRepairAttempts: args.flags.attempts ? Number(args.flags.attempts) : undefined,
      });

      const only = args.flags.shot
        ? dag.order.filter((id) => id.includes(String(args.flags.shot)))
        : undefined;

      const report = await runDag(dag, {
        logger,
        concurrency: 4,
        cache: args.flags['no-cache'] ? memoryCache() : fileCache(join(out, '.cache')),
        only,
        // Auto-approve gates on the command line; the studio UI is where a
        // person actually reviews. The manifest records that it happened.
        gates: (gate) => ({
          gate,
          approved: true,
          by: process.env.USER ?? 'cli',
          at: new Date().toISOString(),
          notes: 'Approved non-interactively by the CLI.',
        }),
      });

      const allChecks = [...report.results.values()].flatMap((r) => r.checks);
      if (asJson) {
        process.stdout.write(
          `${JSON.stringify(
            {
              score: report.scoreSheet.score,
              passed: report.scoreSheet.passed,
              failed: report.scoreSheet.failed,
              escalated: report.escalated,
              nodes: [...report.results].map(([id, r]) => ({ id, status: r.status })),
            },
            null,
            2,
          )}\n`,
        );
      } else {
        print(formatRun(report, allChecks), quiet);
      }

      if (args.command === 'render') {
        await writeRenderOutputs(project, report, out, quiet);
      }
      return report.escalated.length > 0 ? 1 : 0;
    }

    case 'rig': {
      const project = loadProject(args.positional[0]);
      const lines: string[] = [];
      let failures = 0;
      for (const character of project.characters) {
        if (!character.rig) {
          lines.push(`${red('no rig')} ${character.name}`);
          failures++;
          continue;
        }
        const outcome = repairRig(character.rig, {
          logger,
          budget: { attempts: args.flags.attempts ? Number(args.flags.attempts) : 24 },
        });
        const sheet = scoreSheet(character.name, outcome.result.checks);
        lines.push(
          `${outcome.clean ? green('PASS') : red('FAIL')} ${bold(character.name.padEnd(10))} ` +
            `score ${sheet.score.toFixed(3)}  ${sheet.passed} passed, ${sheet.failed} failed  ` +
            `${outcome.records.length} repair(s)`,
        );
        for (const c of outcome.result.checks.filter((x) => !x.pass)) {
          lines.push(`     ${severityTag(c)} ${c.name}: ${c.message}`);
        }
        if (outcome.escalation) {
          lines.push('');
          lines.push(dim(outcome.escalation.summary));
        }
        if (!outcome.clean) failures++;
      }
      print(lines.join('\n'), quiet);
      return failures > 0 ? 1 : 0;
    }

    case 'battery': {
      const project = loadProject(args.positional[1]);
      const id = args.positional[0];
      const character = project.characters.find((c) => c.id === id || c.name.toLowerCase() === id?.toLowerCase());
      if (!character?.rig) {
        process.stderr.write(`No rigged character matching "${id}".\n`);
        return 1;
      }
      mkdirSync(out, { recursive: true });
      const rig = character.rig;
      const w = Number(args.flags.width ?? 240);
      const h = Number(args.flags.height ?? 340);
      const cols = 5;
      const rows = Math.ceil(POSE_BATTERY.length / cols);
      const sheet = createImage(w * cols, h * rows, parseHex('#141418'));
      POSE_BATTERY.forEach((bp, i) => {
        const scene = emptyScene(w, h, parseHex('#F7F2E7'));
        scene.layers.push(
          poseRig(rig, bp.pose, {
            view: rig.views[0],
            swaps: defaultSwaps(rig),
            colorModel: character.colorModel,
          }).layer,
        );
        scene.camera = mTranslate(w / 2, h - 24);
        paste(sheet, renderScene(scene, { samples: 4 }), (i % cols) * w, Math.floor(i / cols) * h);
      });
      const path = join(out, `battery_${character.id}.png`);
      writeFileSync(path, encodePng(sheet));
      const result = validateRig(rig);
      print(
        [
          `${green('Wrote')} ${path}`,
          `${POSE_BATTERY.length} poses across ${rig.views.length} view(s)`,
          formatChecks(result.checks),
        ].join('\n'),
        quiet,
      );
      return result.checks.some((c) => !c.pass && c.severity !== 'warn' && c.severity !== 'info') ? 1 : 0;
    }

    case 'studio': {
      const project = loadProject(args.positional[0]);
      mkdirSync(out, { recursive: true });
      const dag = buildPipeline(project, {
        logger,
        width: args.flags.width ? Number(args.flags.width) : undefined,
        height: args.flags.height ? Number(args.flags.height) : undefined,
        samples: args.flags.samples ? Number(args.flags.samples) : 4,
        throughStage: 'render',
        shotRepairAttempts: args.flags.attempts ? Number(args.flags.attempts) : undefined,
      });

      // Gate policy. `hold` is the honest default: a gate is a human
      // decision, and the studio UI is where a human makes it. The CLI
      // can stand in, but the build records that it did.
      const gateMode = String(args.flags.gates ?? 'hold');
      const priorDecisions = readDecisions(out);
      const report = await runDag(dag, {
        logger,
        concurrency: 4,
        cache: args.flags['no-cache'] ? memoryCache() : fileCache(join(out, '.cache')),
        only: args.flags.shot ? dag.order.filter((id) => id.includes(String(args.flags.shot))) : undefined,
        gates: (gate, node) => {
          const prior = priorDecisions.approvals.find((a) => a.nodeId === node.id);
          if (prior) return prior;
          if (gateMode !== 'approve') return null;
          return {
            gate,
            approved: true,
            by: process.env.USER ?? 'cli',
            at: new Date().toISOString(),
            notes: 'Approved non-interactively by the CLI.',
          };
        },
      });

      const previewWidth = Number(args.flags['preview-width'] ?? 640);
      const every = Number(args.flags.every ?? 1);

      const studioNodes: StudioNode[] = [];
      for (const [id, result] of report.results) {
        const contract = dag.nodes.get(id);
        studioNodes.push({
          id,
          department: contract?.department ?? 'unknown',
          title: contract?.title ?? id,
          shotId: contract?.shotId,
          gate: contract?.gate,
          status: result.status,
          score: result.scoreSheet?.score,
          passed: result.scoreSheet?.passed ?? 0,
          failed: result.scoreSheet?.failed ?? 0,
          warnings: result.scoreSheet?.warnings ?? 0,
          fromCache: result.fromCache,
          durationMs: result.durationMs,
          repairs: result.repairs,
          escalation: result.escalation,
          checks: result.checks,
        });
      }

      const studioShots: StudioShot[] = [];
      let frameCount = 0;
      for (const sequence of project.sequences) {
        for (const scene of sequence.scenes) {
          for (const shot of scene.shots) {
            const render = report.results.get(`render:${shot.id}`);
            const board = report.results.get(`board:${shot.id}`);
            const rendered = render?.output as { images?: unknown[] } | undefined;
            const images = (rendered?.images ?? []) as Parameters<typeof writeShotFrames>[2];
            const frames = images.length
              ? writeShotFrames(out, shot.id, images, { previewWidth, every })
              : [];
            frameCount += frames.length;

            let boardPath: string | undefined;
            const boardOut = board?.output as { board?: Parameters<typeof writeStudioImage>[2] } | undefined;
            if (boardOut?.board) {
              boardPath = writeStudioImage(out, `boards/${shot.id}.png`, boardOut.board);
            }
            let sheetPath: string | undefined;
            if (images.length) {
              sheetPath = writeStudioImage(
                out,
                `contact/${shot.id}.png`,
                contactSheet(images, { label: shot.id }),
              );
            }

            studioShots.push({
              ...shotSummary(shot, project, scene.slug, sequence.name),
              frames,
              board: boardPath,
              contactSheet: sheetPath,
              score: render?.scoreSheet?.score ?? board?.scoreSheet?.score,
              checks: [...(board?.checks ?? []), ...(render?.checks ?? [])],
            });
          }
        }
      }

      const caveats = [
        'Tier-2 vision critics did not run: no provider is configured, so those invariants are unmeasured rather than held.',
      ];
      if (gateMode === 'approve') {
        caveats.push(
          'Human gates were approved non-interactively by the command line. No person looked at these artifacts.',
        );
      }

      const build = buildStudio(
        project,
        studioNodes,
        studioShots,
        { durationMs: report.durationMs, cacheHits: report.cacheHits },
        caveats,
      );
      writeStudioBuild(build, out);
      writeDecisions(out, priorDecisions);
      writeFileSync(join(out, 'project.json'), JSON.stringify(project, null, 2));

      if (asJson) {
        process.stdout.write(`${JSON.stringify({ score: build.score.score, shots: build.shots.length, frames: frameCount }, null, 2)}\n`);
      } else {
        print(
          [
            formatRun(report, studioNodes.flatMap((n) => n.checks)),
            '',
            `${green('Wrote')} ${join(out, 'studio.json')}`,
            `${green('Wrote')} ${frameCount} preview frame(s) across ${studioShots.length} shot(s)`,
            build.awaitingGate.length
              ? `${yellow('Awaiting a human')} at ${build.awaitingGate.length} gate(s) — open the studio to review them`
              : dim('No gates are waiting.'),
            dim(`Point the studio at this directory:  FILM_STUDIO_BUILD=${out} npm run dev`),
          ].join('\n'),
          quiet,
        );
      }
      return report.escalated.length > 0 ? 1 : 0;
    }

    case 'export-blender': {
      const project = loadProject(args.positional[0]);
      const dir = join(out, 'plans');
      mkdirSync(dir, { recursive: true });
      const fps = project.deliverySpec.fps;
      const width = args.flags.width ? Number(args.flags.width) : project.deliverySpec.width;
      const height = args.flags.height ? Number(args.flags.height) : project.deliverySpec.height;
      const lines: string[] = [];
      const checks: CheckResult[] = [];
      let exported = 0;

      for (const sequence of project.sequences) {
        for (const scene of sequence.scenes) {
          const environment = project.environments.find((e) => e.id === scene.environmentId);
          for (const shot of scene.shots) {
            if (args.flags.shot && !shot.id.includes(String(args.flags.shot))) continue;
            const framed = withFraming(shot, project, width, height, environment);
            const frames = evaluateShot(framed, project, { fps, environment, width, height });
            if (frames.length === 0) {
              lines.push(`${yellow('skipped')} ${shot.id}: the shot evaluates to no frames`);
              continue;
            }
            const plan = scenesToPlan(
              frames.map((f) => f.scene),
              { shotId: shot.id, project: project.name, fps, lineScale: 1 },
            );
            const path = join(dir, `${shot.id}.json`);
            writeFileSync(path, JSON.stringify(plan, null, 2));
            const stats = planStats(plan);
            checks.push(...validatePlanCoverage(plan, { shotId: shot.id }));
            lines.push(
              `${green('Wrote')} ${path}  ${dim(`${stats.frames} frames, ${stats.layers} layers, ${stats.strokes} strokes, ${stats.points} points`)}`,
            );
            exported++;
          }
        }
      }

      if (exported === 0) {
        process.stderr.write('No shots matched.\n');
        return 1;
      }
      lines.push('');
      lines.push(formatChecks(checks));
      lines.push('');
      lines.push(dim('Render one with:'));
      lines.push(
        dim(
          `  blender --background --factory-startup --python blender/render_shot.py -- --plan ${join(dir, '<shot>.json')} --out ${join(out, 'blender')}`,
        ),
      );
      print(lines.join('\n'), quiet);
      return checks.some((c) => !c.pass && c.severity !== 'warn' && c.severity !== 'info') ? 1 : 0;
    }

    case 'note': {
      const text = args.positional.join(' ');
      if (!text) {
        process.stderr.write('Give a note: film note "more punch on the jump"\n');
        return 1;
      }
      const parsed = parseNote(text);
      if (asJson) {
        process.stdout.write(
          `${JSON.stringify(
            {
              text,
              edits: parsed.edits,
              unrecognised: parsed.unrecognised,
              message:
                parsed.edits.length === 0
                  ? 'No structured edit matched this note. It is recorded, not guessed at.'
                  : `Resolved to ${parsed.edits.length} structured edit(s)${
                      parsed.unrecognised.length
                        ? `; ${parsed.unrecognised.length} phrase(s) were not understood and were not guessed at`
                        : ''
                    }.`,
            },
            null,
            2,
          )}\n`,
        );
        return 0;
      }
      const lines = [`${bold('Note:')} ${text}`, ''];
      if (parsed.edits.length === 0) lines.push(yellow('No structured edit matched this note.'));
      for (const e of parsed.edits) {
        lines.push(`${green('->')} ${bold(e.op)}  ${dim(String(e.params.diagnosis ?? ''))}`);
        lines.push(`   ${e.rationale}`);
      }
      if (parsed.unrecognised.length) {
        lines.push('');
        lines.push(yellow('Not understood, and not guessed at:'));
        for (const u of parsed.unrecognised) lines.push(`   "${u}"`);
      }
      print(lines.join('\n'), quiet);
      return 0;
    }

    case 'contract': {
      const project = loadProject(args.positional[0]);
      const dag = buildPipeline(project, {
        logger,
        width: Number(args.flags.width ?? 640),
        height: Number(args.flags.height ?? 360),
        samples: 2,
        throughStage: (args.flags.stage as never) ?? 'render',
      });
      const report = await runDag(dag, {
        logger,
        concurrency: 4,
        cache: memoryCache(),
        gates: (gate) => ({ gate, approved: true, by: 'cli', at: new Date().toISOString() }),
      });
      const checks = [...report.results.values()].flatMap((r) => r.checks);
      const verdict = canDeliver(checks);
      print(formatContract(verdict), quiet);
      return verdict.deliverable ? 0 : 1;
    }

    case 'providers': {
      const loaded = loadConfig();
      const resolved = await resolveProviders(loaded);
      const lines = [
        loaded.path ? `${dim('config')} ${loaded.path}` : dim(`no ${CONFIG_FILENAME} found; every slot is on its deterministic baseline`),
        '',
        ...resolved.report.map((r) => `  ${r}`),
      ];
      const caveats = providerCaveats(resolved);
      if (caveats.length) {
        lines.push('');
        for (const c of caveats) lines.push(yellow(`  ${c}`));
      }
      lines.push('');
      lines.push(dim(describeProviders(resolved.set).join('\n')));
      print(lines.join('\n'), quiet);
      return resolved.failures.length > 0 ? 1 : 0;
    }

    case 'providers-builtin': {
      print(describeProviders(deterministicProviders()).join('\n'), quiet);
      return 0;
    }

    case 'doctor': {
      const rows = [
        `node            ${process.version}`,
        `ffmpeg          ${hasFfmpeg() ? green('present') : yellow('absent — PNG sequences only')}`,
        `ANTHROPIC_API_KEY ${process.env.ANTHROPIC_API_KEY ? green('set — tier-2 critics can run') : yellow('unset — tier-2 critics report as unmeasured')}`,
        '',
        ...describeProviders(deterministicProviders()),
      ];
      print(rows.join('\n'), quiet);
      return 0;
    }

    default:
      process.stderr.write(`Unknown command "${args.command}".\n\n${HELP}\n`);
      return 1;
  }
}

function loadProject(path?: string): Project {
  if (!path) return buildMiboProject({});
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`No such project file: ${resolved}`);
  const raw = JSON.parse(readFileSync(resolved, 'utf8'));
  const parsed = safeParseProject(raw);
  if (!parsed.ok) {
    throw new Error(
      `${resolved} does not match the Film Graph schema:\n` +
        parsed.errors.slice(0, 10).map((e) => `  ${e}`).join('\n'),
    );
  }
  return parsed.project;
}

function severityTag(c: CheckResult): string {
  return c.severity === 'fatal'
    ? red('FATAL')
    : c.severity === 'error'
      ? red('ERROR')
      : c.severity === 'warn'
        ? yellow('warn ')
        : dim('info ');
}

function formatChecks(checks: readonly CheckResult[]): string {
  const sheet = scoreSheet('checks', checks);
  const lines = [
    `${sheet.clean ? green('CLEAN') : red('FAILED')}  score ${sheet.score.toFixed(3)}  ` +
      `${sheet.passed} passed, ${sheet.failed} failed, ${sheet.warnings} warnings`,
  ];
  for (const c of checks.filter((x) => !x.pass)) {
    lines.push(`  ${severityTag(c)} ${c.name}: ${c.message}`);
  }
  return lines.join('\n');
}

function formatRun(
  report: Awaited<ReturnType<typeof runDag>>,
  checks: readonly CheckResult[],
): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(bold('Nodes'));
  for (const [id, r] of report.results) {
    const mark =
      r.status === 'passed' || r.status === 'cached'
        ? green(r.status.padEnd(9))
        : r.status === 'blocked' || r.status === 'skipped'
          ? dim(r.status.padEnd(9))
          : red(r.status.padEnd(9));
    lines.push(`  ${mark} ${id.padEnd(34)} ${dim(`${(r.durationMs / 1000).toFixed(2)}s`)}`);
  }
  lines.push('');
  lines.push(bold('Score sheet'));
  lines.push(`  ${formatChecks(checks).split('\n').join('\n  ')}`);
  if (report.escalated.length) {
    lines.push('');
    lines.push(bold(red('Escalations')));
    for (const id of report.escalated) {
      const r = report.results.get(id);
      if (!r?.escalation) continue;
      lines.push(dim(r.escalation.summary.split('\n').map((l) => `  ${l}`).join('\n')));
    }
  }
  if (report.awaitingGate.length) {
    lines.push('');
    lines.push(bold(yellow('Awaiting a human')));
    for (const id of report.awaitingGate) lines.push(`  ${id}`);
  }
  lines.push('');
  lines.push(dim(formatLedger(report.ledger)));
  lines.push('');
  lines.push(
    `${report.cacheHits} cache hit(s), ${(report.durationMs / 1000).toFixed(2)}s wall clock.`,
  );
  return lines.join('\n');
}

async function writeRenderOutputs(
  project: Project,
  report: Awaited<ReturnType<typeof runDag>>,
  out: string,
  quiet: boolean,
): Promise<void> {
  const framesDir = join(out, 'frames');
  mkdirSync(framesDir, { recursive: true });
  const written: { shot: Shot; manifest: ReturnType<typeof writeSequence>; scoreSheet?: ReturnType<typeof scoreSheet> }[] = [];

  for (const [id, result] of report.results) {
    if (!id.startsWith('render:') || !result.output) continue;
    const o = result.output as { shot: Shot; images: Parameters<typeof writeSequence>[0] };
    const dir = join(framesDir, o.shot.id);
    const manifest = writeSequence(o.images, dir, {
      delivery: project.deliverySpec,
      shotId: o.shot.id,
      level: 9,
      text: { Project: project.name },
    });
    writeFileSync(
      join(out, `contact_${o.shot.id}.png`),
      encodePng(contactSheet(o.images, { label: o.shot.id })),
    );
    written.push({ shot: o.shot, manifest, scoreSheet: result.scoreSheet });
  }

  if (written.length === 0) {
    print(yellow('No rendered shots to write.'), quiet);
    return;
  }

  const master = encodeMovie(written[0].manifest, join(out, 'master.mov'), {
    codec: project.deliverySpec.masterCodec,
  });
  const manifest = buildManifest(project, written, {
    master,
    caveats: [
      'Tier-2 vision critics did not run: no provider is configured, so those invariants are unmeasured rather than held.',
    ],
  });
  writeManifest(manifest, join(out, 'delivery.json'));
  print(
    [
      '',
      `${green('Wrote')} ${written.length} shot sequence(s) to ${framesDir}`,
      `${green('Wrote')} ${join(out, 'delivery.json')}`,
      master.ok ? `${green('Wrote')} ${master.path}` : yellow(`Master not written: ${master.reason}`),
      `Film hash ${manifest.filmHash}`,
    ].join('\n'),
    quiet,
  );
}

function print(text: string, quiet: boolean): void {
  if (!quiet) process.stdout.write(`${text}\n`);
}

export { rollUp };
