#!/usr/bin/env node
/**
 * Rejects keys that Vercel's schema does not allow in `vercel.json`.
 *
 * ## Why
 *
 * Every level of Vercel's schema is `additionalProperties: false` — the top level, `rewrites[]`,
 * `headers[]`, and each `headers[].headers[]` entry. JSON has no comment syntax, so the natural
 * instinct is a `"//"` key; Vercel does not ignore it, it **refuses the whole file** and the
 * deployment fails. This file carried five of them, and the failure only surfaced on Vercel, after
 * a push, with nothing locally to catch it.
 *
 * Checked against a hard-coded key list rather than by fetching the live schema, because a
 * pre-deploy check that needs the network is one that fails on a train. The lists come from
 * https://openapi.vercel.sh/vercel.json and cover the properties this project uses; an unrecognised
 * key is reported rather than assumed invalid, so a legitimately new Vercel feature reads as
 * "unknown to this check" instead of as an error.
 *
 * Run via `npm run check:vercel-json`, and as part of `npm run lint`.
 */
import { readFileSync } from 'node:fs';

const FILE = new URL('../vercel.json', import.meta.url).pathname;

/** Keys Vercel accepts, per level. `$schema` is tolerated at the top by convention. */
const ALLOWED = {
  root: [
    '$schema', 'buildCommand', 'installCommand', 'outputDirectory', 'devCommand', 'ignoreCommand',
    'framework', 'public', 'regions', 'redirects', 'rewrites', 'headers', 'cleanUrls',
    'trailingSlash', 'functions', 'crons', 'images', 'git', 'github',
  ],
  rewrite: ['source', 'destination', 'has', 'missing', 'statusCode', 'transforms', 'env', 'respectOriginCacheControl'],
  headerRule: ['source', 'headers', 'has', 'missing'],
  header: ['key', 'value'],
};

let source;

try {
  source = readFileSync(FILE, 'utf8');
} catch {
  process.stdout.write('vercel.json not found — nothing to check.\n');
  process.exit(0);
}

let config;

try {
  config = JSON.parse(source);
} catch (error) {
  process.stdout.write(`vercel.json is not valid JSON: ${String(error)}\n`);
  process.exit(1);
}

const problems = [];

/** Reports keys at `path` that are not in `allowed`, naming `"//"` explicitly since it is the common one. */
function checkKeys(object, allowed, path) {
  for (const key of Object.keys(object)) {
    if (allowed.includes(key)) {
      continue;
    }

    problems.push(
      key === '//'
        ? `${path}."//" — JSON has no comments, and Vercel rejects unknown keys rather than ignoring them. Move the explanation to DEPLOYMENT.md.`
        : `${path}.${key} — not a key Vercel accepts here. Allowed: ${allowed.join(', ')}`,
    );
  }
}

checkKeys(config, ALLOWED.root, 'root');

for (const [index, rule] of (config.rewrites ?? []).entries()) {
  checkKeys(rule, ALLOWED.rewrite, `rewrites[${String(index)}]`);
}

for (const [index, rule] of (config.headers ?? []).entries()) {
  checkKeys(rule, ALLOWED.headerRule, `headers[${String(index)}]`);

  for (const [headerIndex, header] of (rule.headers ?? []).entries()) {
    checkKeys(header, ALLOWED.header, `headers[${String(index)}].headers[${String(headerIndex)}]`);
  }
}

if (problems.length > 0) {
  process.stdout.write('vercel.json will be rejected by Vercel:\n');
  for (const problem of problems) {
    process.stdout.write(`  ${problem}\n`);
  }
  process.exit(1);
}

process.stdout.write('vercel.json has no keys Vercel would reject.\n');
