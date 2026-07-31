#!/usr/bin/env node
/**
 * Fails when a backtick appears inside an inline Angular template.
 *
 * ## Why this exists
 *
 * A component's `template:` is a JavaScript template literal, so a backtick inside it — almost
 * always someone writing `` `code` `` in an explanatory HTML comment — terminates the string early.
 * What follows is then parsed as TypeScript, and the compiler reports the damage wherever it
 * happens to give up:
 *
 *     NG5002: Unexpected character "EOF"
 *     TS2353: Object literal may only specify known properties, and 'attr' does not exist…
 *     TS2552: Cannot find name 'attr'
 *
 * None of those name the real problem, and none point at the line with the backtick on it. This
 * mistake was made three times in one afternoon across three different files, and each time the
 * diagnosis cost more than the fix.
 *
 * A lint rule would be the tidier home for this, but ESLint parses the template as a string and
 * has no opinion about its contents; this reads the source directly, which is the level the bug
 * lives at.
 *
 * Run via `npm run check:templates`, and as part of `npm run lint`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname;

/** Every `.ts` file under src, depth-first. */
function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      yield* sourceFiles(path);
    } else if (entry.endsWith('.ts')) {
      yield path;
    }
  }
}

/**
 * Extracts each inline template body.
 *
 * Matches from `template:` and its opening backtick to the first backtick that is followed by the
 * decorator's closing punctuation — the same shape the Angular compiler sees. A component whose
 * template is genuinely unterminated will not match, and that is fine: the compiler already fails
 * loudly for it.
 */
function templateBodies(source) {
  const bodies = [];
  const pattern = /template:\s*`([\s\S]*?)`\s*[,}]/g;

  for (const match of source.matchAll(pattern)) {
    const body = match[1];

    if (body !== undefined) {
      // Line number of the template's start, so the report points somewhere useful.
      const line = source.slice(0, match.index).split('\n').length;
      bodies.push({ body, line });
    }
  }

  return bodies;
}

let failures = 0;

for (const file of sourceFiles(ROOT)) {
  const source = readFileSync(file, 'utf8');

  if (!source.includes('template:')) {
    continue;
  }

  for (const { body, line } of templateBodies(source)) {
    if (!body.includes('`')) {
      continue;
    }

    // Report the offending line within the template, not just the component.
    body.split('\n').forEach((text, offset) => {
      if (text.includes('`')) {
        failures += 1;
        process.stdout.write(
          `${relative(process.cwd(), file)}:${String(line + offset)}\n` +
            `  backtick inside an inline template — it terminates the template literal\n` +
            `  ${text.trim().slice(0, 100)}\n`,
        );
      }
    });
  }
}

if (failures > 0) {
  process.stdout.write(
    `\n${String(failures)} backtick(s) inside inline templates. Use plain words or single quotes in\n` +
      `template comments — a backtick ends the template literal and the compiler error that follows\n` +
      `will point somewhere else entirely.\n`,
  );
  process.exit(1);
}

process.stdout.write('No backticks inside inline templates.\n');
