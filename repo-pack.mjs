#!/usr/bin/env node
// repo-pack: your repository as one file for an AI, in one command.
// Plain Node 22, built-in modules only. See README.md.
import fs from 'node:fs';
import path from 'node:path';

const VERSION = '0.1.0';
const REASONS = ['ignored', 'excluded', 'not-included', 'secret', 'lock', 'large', 'binary'];
const STYLES = ['markdown', 'xml', 'plain'];
const VALUE_OPTIONS = new Set(['--style', '--include', '--exclude', '--max-size', '--out', '--top']);
const FLAG_OPTIONS = new Set(['--with-locks', '--line-numbers', '--tokens', '--json', '--help']);

const USAGE = `repo-pack: your repository as one file for an AI.

Usage:
  node repo-pack.mjs [folder] [--style markdown|xml|plain] [--include <glob>]... [--exclude <glob>]...
                     [--max-size <bytes>] [--with-locks] [--line-numbers] [--out <file>]
                     [--tokens] [--top <n>] [--json]

Options:
  folder               the folder to pack (default: the current directory)
  --style <style>      markdown (default), xml or plain
  --include <glob>     pack only files matching a glob (repeatable; never brings back what is left out)
  --exclude <glob>     leave out files matching a glob (repeatable)
  --max-size <bytes>   leave out files with more bytes than this (default 1048576)
  --with-locks         pack lock files too
  --line-numbers       number each line of each file
  --out <file>         write the output to this file instead of stdout
  --tokens             print the counts (estimated tokens, file by file) instead of the pack
  --top <n>            with --tokens or --json, how many files to list (default 10)
  --json               print the counts as one JSON object (implies --tokens)
  --help               print this help

Tokens are an estimate: the number of characters divided by 4, rounded up.
Exit codes: 0 done, 1 a file could not be read or --out could not be written, 2 usage error.
`;

class UsageError extends Error {}
class ReadError extends Error {}

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opts = {
    folder: null, style: 'markdown', include: [], exclude: [], maxSize: 1048576,
    withLocks: false, lineNumbers: false, out: null, tokens: false, top: 10, json: false, help: false,
  };
  let error = null;
  const fail = (msg) => { if (!error) error = msg; };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-')) {
      if (opts.folder !== null) fail(`more than one folder given: ${JSON.stringify(arg)}`);
      else opts.folder = arg;
      continue;
    }
    if (FLAG_OPTIONS.has(arg)) {
      if (arg === '--with-locks') opts.withLocks = true;
      else if (arg === '--line-numbers') opts.lineNumbers = true;
      else if (arg === '--tokens') opts.tokens = true;
      else if (arg === '--json') opts.json = true;
      else opts.help = true;
      continue;
    }
    if (VALUE_OPTIONS.has(arg)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { fail(`option ${arg} needs a value`); continue; }
      i++;
      if (arg === '--style') {
        if (STYLES.includes(next)) opts.style = next;
        else fail(`--style must be markdown, xml or plain, not ${JSON.stringify(next)}`);
      } else if (arg === '--include' || arg === '--exclude') {
        let g = next;
        if (g.startsWith('./')) g = g.slice(2);
        if (g.endsWith('/')) g = g.slice(0, -1);
        if (g === '') fail(`${arg} glob is empty: ${JSON.stringify(next)}`);
        else (arg === '--include' ? opts.include : opts.exclude).push(g);
      } else if (arg === '--max-size') {
        if (/^[0-9]+$/.test(next)) opts.maxSize = Number(next);
        else fail(`--max-size must be a whole number of bytes, 0 or more, not ${JSON.stringify(next)}`);
      } else if (arg === '--top') {
        if (/^[0-9]+$/.test(next) && Number(next) > 0) opts.top = Number(next);
        else fail(`--top must be a whole number above 0, not ${JSON.stringify(next)}`);
      } else if (arg === '--out') {
        opts.out = next;
      }
      continue;
    }
    fail(`unknown option ${arg}`);
  }
  if (opts.help) return opts;
  if (error) throw new UsageError(error);
  const folder = opts.folder === null ? '.' : opts.folder;
  let st;
  try { st = fs.statSync(folder); } catch { throw new UsageError(`folder does not exist: ${folder}`); }
  if (!st.isDirectory()) throw new UsageError(`not a folder: ${folder}`);
  opts.folder = folder;
  if (opts.json) opts.tokens = true;
  return opts;
}

// ------------------------------------------------------------------- globs

const hex = (c) => `\\u{${c.codePointAt(0).toString(16)}}`;

// Split a pattern into parts at every `/` that is not escaped; each part is a list of code points.
function splitParts(pattern) {
  const cps = Array.from(pattern);
  const parts = [];
  let cur = [];
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    if (c === '\\' && i + 1 < cps.length) { cur.push(c, cps[i + 1]); i++; }
    else if (c === '/') { parts.push(cur); cur = []; }
    else cur.push(c);
  }
  parts.push(cur);
  return parts;
}

// Parse a [...] set starting at cps[i] === '['. Returns { re, end } or null when it is not closed.
function parseClass(cps, i) {
  const n = cps.length;
  let j = i + 1;
  let neg = false;
  if (cps[j] === '!' || cps[j] === '^') { neg = true; j++; }
  const ranges = [];
  let first = true;
  const member = () => {
    let c = cps[j];
    if (c === '\\' && j + 1 < n) { c = cps[j + 1]; j += 2; } else j++;
    return c;
  };
  for (;;) {
    if (j >= n) return null;
    if (cps[j] === ']' && !first) break;
    first = false;
    const lo = member();
    if (cps[j] === '-' && j + 1 < n && cps[j + 1] !== ']') {
      j++;
      const hi = member();
      if (hi.codePointAt(0) >= lo.codePointAt(0)) ranges.push([lo, hi]);
    } else {
      ranges.push([lo, lo]);
    }
  }
  const body = ranges.map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join('');
  let re;
  if (neg) re = `[^${body}\\u{2f}]`;
  else re = ranges.length ? `(?:(?!/)[${body}])` : '(?!)';
  return { re, end: j };
}

function segmentSource(cps) {
  let out = '';
  const n = cps.length;
  for (let i = 0; i < n; i++) {
    const c = cps[i];
    if (c === '\\') {
      if (i + 1 < n) { out += hex(cps[i + 1]); i++; } else out += hex('\\');
    } else if (c === '*') {
      while (cps[i + 1] === '*') i++;
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '[') {
      const r = parseClass(cps, i);
      if (r) { out += r.re; i = r.end; } else out += hex('[');
    } else {
      out += hex(c);
    }
  }
  return out;
}

// parts: list of parts from splitParts. Returns a RegExp that must match the whole string.
function partsToRegex(parts) {
  const last = parts.length - 1;
  let src = '';
  for (let k = 0; k <= last; k++) {
    const p = parts[k];
    if (p.length === 2 && p[0] === '*' && p[1] === '*') {
      if (last === 0) src += '[^]*';
      else if (k === last) src += '[^]+';
      else src += '(?:[^/]+/)*';
    } else {
      src += segmentSource(p);
      if (k < last) src += '/';
    }
  }
  return new RegExp(`^${src}$`, 'u');
}

function compileGlob(glob) {
  return partsToRegex(splitParts(glob));
}

// ------------------------------------------------------------- .gitignore

function parseGitignore(buf) {
  const text = new TextDecoder('utf-8').decode(buf); // drops a leading BOM, never throws
  const rules = [];
  for (let line of text.split('\n')) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    while (line.endsWith(' ') && !line.endsWith('\\ ')) line = line.slice(0, -1);
    if (line === '' || line[0] === '#') continue;
    let negate = false;
    if (line[0] === '!') { negate = true; line = line.slice(1); }
    let dirOnly = false;
    if (line.endsWith('/')) { dirOnly = true; line = line.slice(0, -1); }
    if (line === '') continue;
    const parts = splitParts(line);
    const anchored = parts.length > 1;
    if (anchored && parts[0].length === 0) parts.shift();
    rules.push({ negate, dirOnly, anchored, re: partsToRegex(parts) });
  }
  return rules;
}

// rulesets: [{ base, rules }] from the folder given down to the path's own folder.
function isIgnored(rel, isDir, rulesets) {
  for (let r = rulesets.length - 1; r >= 0; r--) {
    const { base, rules } = rulesets[r];
    const sub = base ? rel.slice(base.length + 1) : rel;
    const name = sub.slice(sub.lastIndexOf('/') + 1);
    for (let k = rules.length - 1; k >= 0; k--) {
      const rule = rules[k];
      if (rule.dirOnly && !isDir) continue;
      if (rule.re.test(rule.anchored ? sub : name)) return !rule.negate;
    }
  }
  return false;
}

// ------------------------------------------------------------ classifiers

const SECRET_EXAMPLES = new Set(['.env.example', '.env.sample', '.env.template', '.env.dist']);
const SECRET_NAMES = new Set(['.netrc', '.npmrc', '.pypirc', '.pgpass', '.htpasswd', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519']);
const SECRET_SUFFIXES = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.crt', '.cer', '.der', '.p8', '.ppk'];
const LOCK_NAMES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'Pipfile.lock', 'composer.lock', 'go.sum', 'uv.lock',
  'pdm.lock', 'mix.lock', 'Podfile.lock', 'flake.lock', 'pubspec.lock', 'packages.lock.json', 'gradle.lockfile',
]);

function isSecret(rel) {
  const base = rel.slice(rel.lastIndexOf('/') + 1).toLowerCase();
  if (base === '.env') return true;
  if (base.startsWith('.env.') && !SECRET_EXAMPLES.has(base)) return true;
  if (SECRET_NAMES.has(base)) return true;
  return SECRET_SUFFIXES.some((s) => base.endsWith(s));
}

function isLock(rel) {
  return LOCK_NAMES.has(rel.slice(rel.lastIndexOf('/') + 1));
}

function matchesAny(regexes, rel) {
  if (regexes.length === 0) return false;
  let end = rel.indexOf('/');
  while (end !== -1) {
    const prefix = rel.slice(0, end);
    if (regexes.some((re) => re.test(prefix))) return true;
    end = rel.indexOf('/', end + 1);
  }
  return regexes.some((re) => re.test(rel));
}

const strictDecoder = new TextDecoder('utf-8', { fatal: true });

// ------------------------------------------------------------------- text

function countChars(t) {
  let n = t.length;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = t.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { n--; i++; }
    }
  }
  return n;
}

function countLines(t) {
  if (t === '') return 0;
  let n = 1;
  let idx = t.indexOf('\n');
  while (idx !== -1) { n++; idx = t.indexOf('\n', idx + 1); }
  return t.endsWith('\n') ? n - 1 : n;
}

function makeBlock(text, lineNumbers) {
  if (lineNumbers) {
    const lines = text.split('\n');
    if (text === '' || text.endsWith('\n')) lines.pop();
    let out = '';
    for (let i = 0; i < lines.length; i++) out += `${i + 1}: ${lines[i]}\n`;
    return out;
  }
  return text === '' || text.endsWith('\n') ? text : `${text}\n`;
}

const tokensOf = (chars) => Math.ceil(chars / 4);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ------------------------------------------------------------------- walk

function fail(rel, err) {
  return new ReadError(`cannot read ${rel === '' ? '.' : rel}: ${err && err.message ? err.message : err}`);
}

function walk(opts) {
  const rootAbs = path.resolve(opts.folder);
  let rootReal = rootAbs;
  try { rootReal = fs.realpathSync(rootAbs); } catch { /* keep */ }
  let outAbs = null;
  let outReal = null;
  if (opts.out !== null && opts.out !== '') {
    outAbs = path.resolve(opts.out);
    try { outReal = path.join(fs.realpathSync(path.dirname(outAbs)), path.basename(outAbs)); } catch { /* keep null */ }
  }
  const isOut = (rel) => {
    if (outAbs === null) return false;
    const sys = rel.split('/').join(path.sep);
    return path.join(rootAbs, sys) === outAbs || (outReal !== null && path.join(rootReal, sys) === outReal);
  };

  const includeRes = opts.include.map(compileGlob);
  const excludeRes = opts.exclude.map(compileGlob);
  const omitted = Object.fromEntries(REASONS.map((r) => [r, 0]));
  const files = [];

  const list = (dirRel) => {
    const abs = dirRel === '' ? rootAbs : path.join(rootAbs, ...dirRel.split('/'));
    try { return fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { throw fail(dirRel, e); }
  };

  const countIgnored = (dirRel) => {
    for (const ent of list(dirRel)) {
      if (ent.name === '.git' || ent.isSymbolicLink()) continue;
      const rel = dirRel === '' ? ent.name : `${dirRel}/${ent.name}`;
      if (ent.isDirectory()) countIgnored(rel);
      else if (ent.isFile() && !isOut(rel)) omitted.ignored++;
    }
  };

  const handleFile = (rel, rulesets) => {
    if (isIgnored(rel, false, rulesets)) { omitted.ignored++; return; }
    if (matchesAny(excludeRes, rel)) { omitted.excluded++; return; }
    if (includeRes.length > 0 && !matchesAny(includeRes, rel)) { omitted['not-included']++; return; }
    if (isSecret(rel)) { omitted.secret++; return; }
    if (!opts.withLocks && isLock(rel)) { omitted.lock++; return; }
    const abs = path.join(rootAbs, ...rel.split('/'));
    let buf;
    try {
      const size = fs.lstatSync(abs).size;
      if (size > opts.maxSize) { omitted.large++; return; }
      buf = fs.readFileSync(abs);
    } catch (e) { throw fail(rel, e); }
    const head = buf.length > 8000 ? buf.subarray(0, 8000) : buf;
    if (head.includes(0)) { omitted.binary++; return; }
    let text;
    try { text = strictDecoder.decode(buf); } catch { omitted.binary++; return; }
    // the decoder (ignoreBOM false) has already dropped one leading byte order mark
    if (text.includes('\r\n')) text = text.split('\r\n').join('\n');
    const chars = countChars(text);
    files.push({ path: rel, text, chars, lines: countLines(text), tokens: tokensOf(chars) });
  };

  const visit = (dirRel, rulesets) => {
    const entries = list(dirRel);
    let rs = rulesets;
    const gi = entries.find((e) => e.name === '.gitignore' && e.isFile());
    if (gi) {
      const rel = dirRel === '' ? gi.name : `${dirRel}/${gi.name}`;
      let buf;
      try { buf = fs.readFileSync(path.join(rootAbs, ...rel.split('/'))); } catch (e) { throw fail(rel, e); }
      rs = [...rulesets, { base: dirRel, rules: parseGitignore(buf) }];
    }
    for (const ent of entries) {
      if (ent.name === '.git' || ent.isSymbolicLink()) continue;
      const rel = dirRel === '' ? ent.name : `${dirRel}/${ent.name}`;
      if (ent.isDirectory()) {
        if (isIgnored(rel, true, rs)) countIgnored(rel);
        else visit(rel, rs);
      } else if (ent.isFile()) {
        if (!isOut(rel)) handleFile(rel, rs);
      }
    }
  };

  visit('', []);
  return { files, omitted };
}

// ------------------------------------------------------------------ output

function orderFiles(files) {
  return files.slice().sort((a, b) => {
    const ar = a.path === 'README.md';
    const br = b.path === 'README.md';
    if (ar !== br) return ar ? -1 : 1;
    return cmp(a.path, b.path);
  });
}

function treeBlock(files) {
  const root = new Map();
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.has(parts[i])) node.set(parts[i], new Map());
      node = node.get(parts[i]);
    }
    node.set(parts[parts.length - 1], null);
  }
  let out = '';
  const emit = (node, depth) => {
    for (const name of [...node.keys()].sort(cmp)) {
      const child = node.get(name);
      out += `${'  '.repeat(depth)}${name}${child ? '/' : ''}\n`;
      if (child) emit(child, depth + 1);
    }
  };
  emit(root, 0);
  return out;
}

function fenceFor(block) {
  let longest = 0;
  const re = /`+/g;
  let m;
  while ((m = re.exec(block)) !== null) if (m[0].length > longest) longest = m[0].length;
  return '`'.repeat(Math.max(3, longest + 1));
}

const xmlText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlAttr = (s) => xmlText(s).replace(/"/g, '&quot;');

function totalsOf(files) {
  let lines = 0;
  let chars = 0;
  for (const f of files) { lines += f.lines; chars += f.chars; }
  return { files: files.length, lines, characters: chars, tokens: tokensOf(chars) };
}

function buildPack(files, style, lineNumbers) {
  const t = totalsOf(files);
  const tree = treeBlock(files);
  let out = '';
  if (style === 'markdown') {
    const tf = fenceFor(tree);
    out += `# Repository pack\n\n- files: ${t.files}\n- lines: ${t.lines}\n- characters: ${t.characters}\n- estimated tokens: ${t.tokens}\n\n`;
    out += `## Tree\n\n${tf}\n${tree}${tf}\n`;
    for (const f of files) {
      const block = makeBlock(f.text, lineNumbers);
      const fence = fenceFor(block);
      out += `\n## File: ${f.path}\n\n${fence}\n${block}${fence}\n`;
    }
  } else if (style === 'xml') {
    out += `<repository files="${t.files}" lines="${t.lines}" characters="${t.characters}" estimated_tokens="${t.tokens}">\n`;
    out += `<tree>\n${xmlText(tree)}</tree>\n`;
    for (const f of files) {
      const block = makeBlock(f.text, lineNumbers).split(']]>').join(']]]]><![CDATA[>');
      out += `<file path="${xmlAttr(f.path)}">\n<![CDATA[\n${block}]]>\n</file>\n`;
    }
    out += '</repository>\n';
  } else {
    out += `repo-pack\nfiles: ${t.files}\nlines: ${t.lines}\ncharacters: ${t.characters}\nestimated tokens: ${t.tokens}\n\nTree:\n${tree}`;
    for (const f of files) {
      out += `\n=== ${f.path} (lines: ${f.lines}) ===\n${makeBlock(f.text, lineNumbers)}`;
    }
  }
  return out;
}

function rankedFiles(files) {
  return files.slice().sort((a, b) => b.chars - a.chars || cmp(a.path, b.path));
}

function buildCounts(files, top) {
  const t = totalsOf(files);
  let out = `files: ${t.files}\nlines: ${t.lines}\ncharacters: ${t.characters}\nestimated tokens: ${t.tokens}\n`;
  out += '\ntokens characters lines path\n';
  const ranked = rankedFiles(files);
  for (const f of ranked.slice(0, top)) out += `${f.tokens} ${f.chars} ${f.lines} ${f.path}\n`;
  if (ranked.length > top) out += `... and ${ranked.length - top} more files\n`;
  return out;
}

function buildJson(files, omitted, top) {
  const t = totalsOf(files);
  const obj = {
    tool: 'repo-pack',
    version: VERSION,
    total: { files: t.files, lines: t.lines, characters: t.characters, tokens: t.tokens },
    files: rankedFiles(files).slice(0, top).map((f) => ({ path: f.path, lines: f.lines, characters: f.chars, tokens: f.tokens })),
    omitted: Object.fromEntries(REASONS.map((r) => [r, omitted[r]])),
  };
  return `${JSON.stringify(obj, null, 2)}\n`;
}

function summary(files, omitted) {
  const t = totalsOf(files);
  let s = `packed: ${t.files} files, ${t.lines} lines, ${t.characters} characters, about ${t.tokens} tokens\n`;
  for (const r of REASONS) if (omitted[r] > 0) s += `left out: ${omitted[r]} ${r}\n`;
  return s;
}

// ------------------------------------------------------------------- main

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`repo-pack: ${e.message}\nTry: node repo-pack.mjs --help\n`);
      return 2;
    }
    throw e;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  let result;
  try {
    result = walk(opts);
  } catch (e) {
    if (e instanceof ReadError) {
      process.stderr.write(`repo-pack: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
  const files = orderFiles(result.files);
  let output;
  if (opts.json) output = buildJson(files, result.omitted, opts.top);
  else if (opts.tokens) output = buildCounts(files, opts.top);
  else output = buildPack(files, opts.style, opts.lineNumbers);

  if (opts.out !== null) {
    try {
      fs.writeFileSync(opts.out, output);
    } catch (e) {
      process.stderr.write(`repo-pack: cannot write ${opts.out}: ${e.message}\n`);
      return 1;
    }
  } else {
    process.stdout.write(output);
  }
  process.stderr.write(summary(files, result.omitted));
  return 0;
}

process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`repo-pack: unexpected error: ${e && e.stack ? e.stack : e}\n`);
  process.exitCode = 1;
}
