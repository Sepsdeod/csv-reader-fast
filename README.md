# csv-reader-fast

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Sepsdeod/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Sepsdeod/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0: it reads broken CSV — BOM,
CRLF and lone LF, stray CRs, quoted fields, doubled quotes, quote junk,
unterminated quotes, short and long rows — and answers exactly as csv-reader
does, only faster.

`solve.js` is a dependency-free ES module. Its `run({text, header})` returns
`{columns, rows, errors}`: it reads the text once, left to right, and takes
each field as a slice of the input instead of building it one character at a
time; quoted fields are closed with `indexOf` instead of a per-character
walk, and only a segment that actually holds a CR or LF is converted. `main.ts`
is the harness driver: it reads every case from `/input/cases.json`, answers
each with `run`, and writes `/output/answers.json`.

## Run

```sh
node main.ts
```

This reads `/input/cases.json` and writes `/output/answers.json`. To read and
write elsewhere, set `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR`:

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Local check

Against the kit's practice set (`practice/input/cases.json` vs
`practice/reference/expected.json`): 6/6 cases identical to csv-reader 1.0.0,
and faster than the house baseline driver on the same set (see the benchmark
numbers in the entry notes).

## License

MIT — see [LICENSE](LICENSE).

---
Built for the [make.fun](https://make.fun/r/7nvvsk82) bounty
`csv-reader-speed-01-run-20261121`. Try make.fun yourself:
https://make.fun/r/7nvvsk82
