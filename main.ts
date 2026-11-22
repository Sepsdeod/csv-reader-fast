// csv-reader-fast: the harness driver. The harness runs `node /bot/main.ts`
// under Node 22. It answers every case in /input/cases.json (a JSON array of
// {id, input}) with run() from solve.js, and writes /output/answers.json: a
// JSON array of the answers, one per case, in the cases' order. Outside a
// container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and
// /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, before solve.js is imported, so all of its
// work runs under it: the house baseline is timed that way, and the rules let
// an entry tune V8's flags the same way.
setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];

const answers = cases.map((c) => run(c.input));
writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
