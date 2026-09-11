#!/usr/bin/env node
// Entry point for the `film` CLI. TypeScript is executed natively by Node
// (type stripping, unflagged since 22.18), so there is no build step.
import { main } from '../src/cli/film.ts';

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
