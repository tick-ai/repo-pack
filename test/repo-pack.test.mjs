import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../repo-pack.mjs', import.meta.url));

// A fixture folder: `files` maps a relative path to a string or a Buffer.
function fixture(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-pack-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

function run(args, { cwd } = {}) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// Runs the tool on a fresh fixture, removes it afterwards.
function pack(files, args = [], check) {
  const dir = fixture(files);
  try {
    const r = run([dir, ...args]);
    if (check) check(r, dir);
    return r;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function packedPaths(files, args = []) {
  const r = pack(files, ['--json', '--top', '1000', ...args]);
  assert.equal(r.code, 0, r.err);
  return JSON.parse(r.out).files.map((f) => f.path).sort();
}

const omittedOf = (files, args = []) => JSON.parse(pack(files, ['--json', ...args]).out).omitted;

// ------------------------------------------------------------------ formats

test('markdown pack, byte for byte', () => {
  const r = pack({ 'README.md': '# Hi\n', 'src/a.js': 'one\ntwo', 'b.txt': 'x\n' });
  assert.equal(r.code, 0);
  assert.equal(
    r.out,
    [
      '# Repository pack',
      '',
      '- files: 3',
      '- lines: 4',
      '- characters: 14',
      '- estimated tokens: 4',
      '',
      '## Tree',
      '',
      '```',
      'README.md',
      'b.txt',
      'src/',
      '  a.js',
      '```',
      '',
      '## File: README.md',
      '',
      '```',
      '# Hi',
      '```',
      '',
      '## File: b.txt',
      '',
      '```',
      'x',
      '```',
      '',
      '## File: src/a.js',
      '',
      '```',
      'one',
      'two',
      '```',
      '',
    ].join('\n'),
  );
  assert.equal(r.err, 'packed: 3 files, 4 lines, 14 characters, about 4 tokens\n');
});

test('xml pack, byte for byte, with escapes', () => {
  const r = pack({ 'a&b.txt': 'x ]]> y\n</file>\n', 'dir/q.txt': '' }, ['--style', 'xml']);
  assert.equal(r.code, 0);
  assert.equal(
    r.out,
    '<repository files="2" lines="2" characters="16" estimated_tokens="4">\n' +
      '<tree>\na&amp;b.txt\ndir/\n  q.txt\n</tree>\n' +
      '<file path="a&amp;b.txt">\n<![CDATA[\nx ]]]]><![CDATA[> y\n</file>\n]]>\n</file>\n' +
      '<file path="dir/q.txt">\n<![CDATA[\n]]>\n</file>\n' +
      '</repository>\n',
  );
});

test('xml escapes <, > and " in the path attribute (file names that allow it)', { skip: process.platform === 'win32' }, () => {
  const r = pack({ 'a<b>"c.txt': 'x\n' }, ['--style', 'xml']);
  assert.match(r.out, /<file path="a&lt;b&gt;&quot;c\.txt">/);
  assert.match(r.out, /<tree>\na&lt;b&gt;"c\.txt\n<\/tree>/);
});

test('plain pack, byte for byte', () => {
  const r = pack({ 'b.txt': 'x\ny', 'a/c.txt': '=== fake (lines: 1) ===\n' }, ['--style', 'plain']);
  assert.equal(
    r.out,
    'repo-pack\nfiles: 2\nlines: 3\ncharacters: 27\nestimated tokens: 7\n\n' +
      'Tree:\na/\n  c.txt\nb.txt\n' +
      '\n=== a/c.txt (lines: 1) ===\n=== fake (lines: 1) ===\n' +
      '\n=== b.txt (lines: 2) ===\nx\ny\n',
  );
});

test('markdown fence grows past the longest run of backticks and is at least three', () => {
  const r = pack({ 'a.md': 'x\n```\ny\n`````\n', 'b.md': '``\n' });
  assert.ok(r.out.includes('## File: a.md\n\n``````\nx\n```\ny\n`````\n``````\n'));
  assert.ok(r.out.includes('## File: b.md\n\n```\n``\n```\n'));
});

test('markdown tree fence also grows past backticks in names', { skip: process.platform === 'win32' }, () => {
  const r = pack({ 'a```b.txt': 'x\n' });
  assert.ok(r.out.includes('## Tree\n\n````\na```b.txt\n````\n'));
});

test('empty folder gives a valid empty pack in every format', () => {
  const md = pack({});
  assert.equal(
    md.out,
    '# Repository pack\n\n- files: 0\n- lines: 0\n- characters: 0\n- estimated tokens: 0\n\n## Tree\n\n```\n```\n',
  );
  assert.equal(md.err, 'packed: 0 files, 0 lines, 0 characters, about 0 tokens\n');
  assert.equal(
    pack({}, ['--style', 'xml']).out,
    '<repository files="0" lines="0" characters="0" estimated_tokens="0">\n<tree>\n</tree>\n</repository>\n',
  );
  assert.equal(
    pack({}, ['--style', 'plain']).out,
    'repo-pack\nfiles: 0\nlines: 0\ncharacters: 0\nestimated tokens: 0\n\nTree:\n',
  );
  assert.equal(md.code, 0);
});

test('an empty file is text: empty block, zero counts', () => {
  const r = pack({ 'e.txt': '' });
  assert.ok(r.out.includes('- files: 1\n- lines: 0\n'));
  assert.ok(r.out.endsWith('## File: e.txt\n\n```\n```\n'));
});

// -------------------------------------------------------------- text, counts

test('CRLF becomes LF, a lone CR stays, one BOM is dropped', () => {
  const r = pack({ 'a.txt': Buffer.from('﻿one\r\ntwo\rthree\r\n') }, ['--style', 'plain']);
  assert.ok(r.out.endsWith('=== a.txt (lines: 2) ===\none\ntwo\rthree\n'));
  assert.ok(r.out.includes('characters: 14\n'));
});

test('characters count code points, lines follow the stated rule', () => {
  const r = pack({ 'a.txt': 'a😀é\n', 'b.txt': 'a', 'c.txt': 'a\n\n', 'd.txt': '' }, ['--json']);
  const j = JSON.parse(r.out);
  const by = Object.fromEntries(j.files.map((f) => [f.path, f]));
  assert.deepEqual(by['a.txt'], { path: 'a.txt', lines: 1, characters: 4, tokens: 1 });
  assert.deepEqual(by['b.txt'], { path: 'b.txt', lines: 1, characters: 1, tokens: 1 });
  assert.deepEqual(by['c.txt'], { path: 'c.txt', lines: 2, characters: 3, tokens: 1 });
  assert.deepEqual(by['d.txt'], { path: 'd.txt', lines: 0, characters: 0, tokens: 0 });
});

test('total tokens come from the total characters, not from the files', () => {
  const j = JSON.parse(pack({ 'a.txt': 'abcde', 'b.txt': 'abcde' }, ['--json']).out);
  assert.equal(j.total.characters, 10);
  assert.equal(j.total.tokens, 3);
  assert.deepEqual(j.files.map((f) => f.tokens), [2, 2]);
});

test('--line-numbers numbers each line, no padding, empty lines too', () => {
  const r = pack({ 'a.txt': 'x\n\nz' }, ['--line-numbers']);
  assert.ok(r.out.includes('```\n1: x\n2: \n3: z\n```\n'));
  const p = pack({ 'a.txt': 'x\n' }, ['--line-numbers', '--style', 'plain']);
  assert.ok(p.out.endsWith('=== a.txt (lines: 1) ===\n1: x\n'));
  const e = pack({ 'a.txt': '' }, ['--line-numbers']);
  assert.ok(e.out.endsWith('```\n```\n'));
  const lines = pack({ 'a.txt': 'x\ny\n' }, ['--line-numbers']);
  assert.ok(lines.out.includes('- characters: 4\n'), 'counts never include line numbers');
});

// -------------------------------------------------------------------- order

test('README.md of the root first, then code unit order', () => {
  const files = { 'z.txt': '1', 'a.txt': '1', 'a/b.txt': '1', 'B.txt': '1', 'docs/README.md': '1', 'README.md': '1' };
  const r = pack(files, ['--style', 'plain']);
  const headers = [...r.out.matchAll(/^=== (.*) \(lines/gm)].map((m) => m[1]);
  assert.deepEqual(headers, ['README.md', 'B.txt', 'a.txt', 'a/b.txt', 'docs/README.md', 'z.txt']);
  // the tree keeps its own order, folders and files together by name
  assert.ok(r.out.includes('Tree:\nB.txt\nREADME.md\na/\n  b.txt\na.txt\ndocs/\n  README.md\nz.txt\n'));
  // no other file is moved: not readme.md, not a README.md below the root
  const other = pack({ 'readme.md': '1', 'B.txt': '1', 'a.txt': '1', 'sub/README.md': '1' }, ['--style', 'plain']);
  const h2 = [...other.out.matchAll(/^=== (.*) \(lines/gm)].map((m) => m[1]);
  assert.deepEqual(h2, ['B.txt', 'a.txt', 'readme.md', 'sub/README.md']);
});

test('same bytes whatever order the files were made in', () => {
  const names = ['x/1.txt', 'x/2.txt', 'a.txt', 'README.md', 'm/n/o.txt'];
  const a = pack(Object.fromEntries(names.map((n) => [n, n + '\n'])));
  const b = pack(Object.fromEntries([...names].reverse().map((n) => [n, n + '\n'])));
  assert.equal(a.out, b.out);
});

// ---------------------------------------------------------------- .gitignore

function ignoredBy(gitignore, names, extra = {}) {
  const files = { '.gitignore': gitignore, ...extra };
  for (const n of names) files[n] = 'x\n';
  const kept = packedPaths(files);
  return names.filter((n) => !kept.includes(n)).sort();
}

test('gitignore: comments, blank lines, escapes', () => {
  assert.deepEqual(ignoredBy('# a.txt\n\n\\#b.txt\n\\!c.txt\n', ['a.txt', '#b.txt', '!c.txt', 'd.txt']), ['!c.txt', '#b.txt']);
  assert.deepEqual(ignoredBy('a.txt\r\nb.txt\r\n', ['a.txt', 'b.txt', 'c.txt']), ['a.txt', 'b.txt']);
});

test('gitignore: trailing spaces are removed unless escaped; an escaped star is a star', { skip: process.platform === 'win32' }, () => {
  assert.deepEqual(ignoredBy('a.txt   \n', ['a.txt', 'a.txt   ']), ['a.txt']);
  assert.deepEqual(ignoredBy('a.txt\\ \n', ['a.txt', 'a.txt ']), ['a.txt ']);
  assert.deepEqual(ignoredBy('  b.txt\n', ['b.txt', '  b.txt']), ['  b.txt']);
  assert.deepEqual(ignoredBy('a\\*\n', ['a*', 'ab']), ['a*']);
});

test('gitignore: a BOM at the start is dropped', () => {
  const dir = fixture({ 'a.txt': 'x', 'b.txt': 'x' });
  fs.writeFileSync(path.join(dir, '.gitignore'), Buffer.from('﻿a.txt\n'));
  const r = run([dir, '--json']);
  fs.rmSync(dir, { recursive: true });
  assert.deepEqual(JSON.parse(r.out).files.map((f) => f.path).sort(), ['.gitignore', 'b.txt']);
});

test('gitignore: name patterns match at any depth, anchored ones only at the root of the .gitignore', () => {
  assert.deepEqual(ignoredBy('x.txt\n', ['x.txt', 'a/x.txt', 'a/b/x.txt', 'y.txt']), ['a/b/x.txt', 'a/x.txt', 'x.txt']);
  assert.deepEqual(ignoredBy('/x.txt\n', ['x.txt', 'a/x.txt']), ['x.txt']);
  assert.deepEqual(ignoredBy('a/x.txt\n', ['x.txt', 'a/x.txt', 'b/a/x.txt']), ['a/x.txt']);
  assert.deepEqual(ignoredBy('a/*.txt\n', ['a/x.txt', 'a/b/x.txt']), ['a/x.txt']);
});

test('gitignore: trailing slash matches folders only', () => {
  assert.deepEqual(ignoredBy('out/\n', ['out/a.txt', 'src/out/b.txt', 'c/out']), ['out/a.txt', 'src/out/b.txt']);
  assert.deepEqual(ignoredBy('out\n', ['out/a.txt', 'c/out']), ['c/out', 'out/a.txt']);
});

test('gitignore: * ? [...] and the leading dot', () => {
  assert.deepEqual(ignoredBy('*.log\n', ['a.log', '.log', 'a.logs', 'd/b.log']), ['.log', 'a.log', 'd/b.log']);
  assert.deepEqual(ignoredBy('a?c\n', ['abc', 'ac', 'a.c', 'a/c', 'abbc']), ['a.c', 'abc']);
  assert.deepEqual(ignoredBy('[abc].txt\n', ['a.txt', 'd.txt', 'ab.txt']), ['a.txt']);
  assert.deepEqual(ignoredBy('[a-c]1\n', ['a1', 'b1', 'd1']), ['a1', 'b1']);
  assert.deepEqual(ignoredBy('[!a-c]1\n', ['a1', 'd1', 'e1']), ['d1', 'e1']);
  assert.deepEqual(ignoredBy('[^a-c]1\n', ['a1', 'd1']), ['d1']);
  assert.deepEqual(ignoredBy('[]a]1\n', [']1', 'a1', 'b1']), [']1', 'a1']);
  assert.deepEqual(ignoredBy('[!]a]1\n', [']1', 'a1', 'b1']), ['b1']);
  assert.deepEqual(ignoredBy('[c-a]1\n', ['a1', 'b1', 'c1']), []);
  assert.deepEqual(ignoredBy('[a1\n', ['[a1', 'a1']), ['[a1']);
  assert.deepEqual(ignoredBy('*\n!*.txt\n', ['a.md', 'b.txt', '.c.txt']), ['a.md']);
});

test('gitignore: ** in all places', () => {
  assert.deepEqual(ignoredBy('**/x.txt\n', ['x.txt', 'a/x.txt', 'a/b/x.txt', 'y.txt']), ['a/b/x.txt', 'a/x.txt', 'x.txt']);
  assert.deepEqual(ignoredBy('a/**/b\n', ['a/b', 'a/x/y/b', 'a/x/b/c', 'b']), ['a/b', 'a/x/b/c', 'a/x/y/b']);
  assert.deepEqual(ignoredBy('a/**\n', ['a/d', 'a/b/c', 'a2/b']), ['a/b/c', 'a/d']);
  assert.deepEqual(ignoredBy('**\n!.gitignore\n', ['a', 'b/c']), ['a', 'b/c']);
  assert.deepEqual(ignoredBy('a**b\n', ['ab', 'axxb', 'a/b']), ['ab', 'axxb']);
  assert.deepEqual(ignoredBy('a***b\n', ['ab', 'axxb', 'a/b']), ['ab', 'axxb']);
  assert.deepEqual(ignoredBy('doc/**/*.md\n', ['doc/a.md', 'doc/x/b.md', 'doc/x/c.txt']), ['doc/a.md', 'doc/x/b.md']);
});

test('gitignore: negation and the last match wins', () => {
  assert.deepEqual(ignoredBy('*.txt\n!keep.txt\n', ['a.txt', 'keep.txt', 'd/keep.txt']), ['a.txt']);
  assert.deepEqual(ignoredBy('!keep.txt\n*.txt\n', ['keep.txt', 'a.txt']), ['a.txt', 'keep.txt']);
  assert.deepEqual(ignoredBy('a.txt\n!a.txt\na.txt\n', ['a.txt']), ['a.txt']);
});

test('gitignore: an ignored folder is not entered, nothing inside comes back', () => {
  assert.deepEqual(ignoredBy('out/\n!out/keep.txt\n', ['out/keep.txt', 'out/x.txt']), ['out/keep.txt', 'out/x.txt']);
  assert.deepEqual(ignoredBy('vendor/*\n!vendor/lib/\n', ['vendor/lib/a.txt', 'vendor/b.txt']), ['vendor/b.txt']);
  // every regular file inside an ignored folder is counted as ignored, at any depth
  const o = omittedOf({ '.gitignore': 'out/\n', 'out/a': '1', 'out/d/e/f': '1', 'k.txt': '1' });
  assert.equal(o.ignored, 2);
});

test('gitignore: nested files apply below their own folder, relative to it', () => {
  const files = {
    'sub/.gitignore': '/only.txt\n*.tmp\n!keep.tmp\n',
    'sub/only.txt': 'x', 'sub/deep/only.txt': 'x', 'only.txt': 'x',
    'sub/a.tmp': 'x', 'sub/keep.tmp': 'x', 'sub/deep/b.tmp': 'x', 'a.tmp': 'x',
  };
  assert.deepEqual(packedPaths(files), ['a.tmp', 'only.txt', 'sub/.gitignore', 'sub/deep/only.txt', 'sub/keep.tmp']);
  // a nested file can re-include what a file above ignored, the deepest decides
  const f2 = { '.gitignore': '*.log\n', 'sub/.gitignore': '!*.log\n', 'a.log': 'x', 'sub/b.log': 'x' };
  assert.deepEqual(packedPaths(f2), ['.gitignore', 'sub/.gitignore', 'sub/b.log']);
});

test('gitignore: a .gitignore above the folder given, and .git/info/exclude, are not read', () => {
  const outer = fixture({ '.gitignore': '*.txt\n', 'inner/a.txt': 'x', 'inner/b.md': 'x' });
  fs.mkdirSync(path.join(outer, 'inner', '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(outer, 'inner', '.git', 'info', 'exclude'), '*.md\n');
  try {
    const r = run([path.join(outer, 'inner'), '--json', '--top', '9']);
    assert.deepEqual(JSON.parse(r.out).files.map((f) => f.path), ['a.txt', 'b.md']);
  } finally {
    fs.rmSync(outer, { recursive: true });
  }
});

test('the .gitignore files are themselves packed', () => {
  assert.deepEqual(packedPaths({ '.gitignore': 'x\n', 'a/.gitignore': 'y\n' }), ['.gitignore', 'a/.gitignore']);
});

// ----------------------------------------------------------- include/exclude

const TREE = { 'a.js': '1', 'b.md': '1', 'src/c.js': '1', 'src/d.md': '1', 'src/deep/e.js': '1', 'docs/f.md': '1' };

test('--exclude: anchored at the root, names alone do not match, folders leave out their files', () => {
  assert.deepEqual(packedPaths(TREE, ['--exclude', '*.js']), ['b.md', 'docs/f.md', 'src/c.js', 'src/d.md', 'src/deep/e.js']);
  assert.deepEqual(packedPaths(TREE, ['--exclude', '**/*.js']), ['b.md', 'docs/f.md', 'src/d.md']);
  assert.deepEqual(packedPaths(TREE, ['--exclude', 'src']), ['a.js', 'b.md', 'docs/f.md']);
  assert.deepEqual(packedPaths(TREE, ['--exclude', './src/']), ['a.js', 'b.md', 'docs/f.md']);
  assert.deepEqual(packedPaths(TREE, ['--exclude', 'src/deep']), ['a.js', 'b.md', 'docs/f.md', 'src/c.js', 'src/d.md']);
  assert.deepEqual(packedPaths(TREE, ['--exclude', 'src/**']), ['a.js', 'b.md', 'docs/f.md']);
  assert.deepEqual(packedPaths(TREE, ['--exclude', 'e.js']), Object.keys(TREE).sort());
  assert.deepEqual(packedPaths(TREE, ['--exclude', 'a.?s', '--exclude', 'b.[m]d']), ['docs/f.md', 'src/c.js', 'src/d.md', 'src/deep/e.js']);
});

test('--include: only what matches, directory names too, repeated', () => {
  assert.deepEqual(packedPaths(TREE, ['--include', 'docs']), ['docs/f.md']);
  assert.deepEqual(packedPaths(TREE, ['--include', 'docs', '--include', '*.js']), ['a.js', 'docs/f.md']);
  assert.deepEqual(packedPaths(TREE, ['--include', 'src/**/*.js']), ['src/c.js', 'src/deep/e.js']);
  assert.deepEqual(packedPaths(TREE, ['--include', 'src', '--exclude', 'src/deep']), ['src/c.js', 'src/d.md']);
});

test('--include never puts back what the defaults leave out', () => {
  const files = {
    '.gitignore': 'ign.txt\n', 'ign.txt': 'x', '.env': 'S=1', 'package-lock.json': '{}', 'bin.dat': Buffer.from([0, 1]),
    'big.txt': 'x'.repeat(50), 'ok.txt': 'x',
  };
  assert.deepEqual(packedPaths(files, ['--include', 'ign.txt', '--include', '.env', '--include', 'package-lock.json',
    '--include', 'bin.dat', '--include', 'big.txt', '--include', 'ok.txt', '--max-size', '10']), ['ok.txt']);
});

test('reason order: ignored, excluded, not-included, secret, lock, large, binary', () => {
  const files = {
    '.gitignore': 'i.txt\n', 'i.txt': 'x', 'e.txt': 'x', 'n.txt': 'x', '.env': 'x', 'yarn.lock': 'x',
    'l.txt': 'x'.repeat(20), 'b.bin': Buffer.from([0]), 'ok.txt': 'x',
    // each of these would match several reasons; the first in the order is the one counted
    'e2.env': 'x',
  };
  const o = omittedOf(files, ['--exclude', 'e*', '--include', 'ok.txt', '--include', 'i.txt', '--include', '.env', '--max-size', '10']);
  assert.deepEqual(o, { ignored: 1, excluded: 2, 'not-included': 5, secret: 1, lock: 0, large: 0, binary: 0 });
  // an ignored file that is also excluded is counted once, as ignored
  assert.deepEqual(omittedOf({ '.gitignore': 'a\n', a: 'x' }, ['--exclude', 'a']).ignored, 1);
  // secret before lock before large before binary
  const o2 = omittedOf({ '.env': Buffer.from([0]), 'yarn.lock': Buffer.alloc(30), 'l.bin': Buffer.alloc(30), 'b.bin': Buffer.alloc(3) }, ['--max-size', '10']);
  assert.deepEqual(o2, { ignored: 0, excluded: 0, 'not-included': 0, secret: 1, lock: 1, large: 1, binary: 1 });
});

// ----------------------------------------------------------------- left out

test('secret files', () => {
  // built from pieces, never written whole
  const keyText = '-----BEGIN ' + 'PRIVATE' + ' ' + 'KEY-----\nabc\n';
  const secret = {
    '.env': 'A=1', 'upper/.ENV': 'A=1', '.env.local': 'A=1', 'app/.env.production': 'A=1', '.netrc': 'x', '.npmrc': 'x', '.pypirc': 'x',
    '.pgpass': 'x', '.htpasswd': 'x', id_rsa: keyText, id_dsa: 'x', id_ecdsa: 'x', 'ssh/ID_ED25519': 'x',
    'a.pem': 'x', 'a.KEY': 'x', 'a.p12': 'x', 'a.pfx': 'x', 'a.jks': 'x', 'a.keystore': 'x', 'a.crt': 'x', 'a.cer': 'x', 'a.der': 'x',
    'a.p8': 'x', 'a.ppk': 'x',
  };
  const fine = {
    '.env.example': 'x', '.env.sample': 'x', '.ENV.TEMPLATE': 'x', '.env.dist': 'x', 'id_rsa.pub': 'x', 'monkey.txt': 'x', 'env': 'x',
    'dot.env': 'x', '.envrc': 'x',
  };
  const r = pack({ ...secret, ...fine }, ['--json', '--top', '100']);
  const j = JSON.parse(r.out);
  assert.equal(j.omitted.secret, Object.keys(secret).length);
  assert.deepEqual(j.files.map((f) => f.path).sort(), Object.keys(fine).sort());
  assert.ok(!r.out.includes('BEGIN'));
});

test('lock files, and --with-locks', () => {
  const locks = [
    'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'Cargo.lock', 'Gemfile.lock',
    'poetry.lock', 'Pipfile.lock', 'composer.lock', 'go.sum', 'uv.lock', 'pdm.lock', 'mix.lock', 'Podfile.lock', 'flake.lock',
    'pubspec.lock', 'packages.lock.json', 'gradle.lockfile',
  ];
  const files = Object.fromEntries(locks.map((n, i) => [i % 2 ? `sub/${n}` : n, 'x\n']));
  files['case/Yarn.lock'] = 'x\n'; // exact, case-sensitive
  files['other.lock'] = 'x\n';
  assert.deepEqual(packedPaths(files), ['case/Yarn.lock', 'other.lock']);
  assert.equal(omittedOf(files).lock, locks.length);
  const withLocks = packedPaths(files, ['--with-locks']);
  assert.equal(withLocks.length, locks.length + 2);
  assert.equal(omittedOf(files, ['--with-locks']).lock, 0);
});

test('--with-locks does not bring back secrets', () => {
  assert.deepEqual(packedPaths({ '.env': 'x', 'yarn.lock': 'x' }, ['--with-locks']), ['yarn.lock']);
});

test('--max-size: exactly that size is packed, one more is left out; 0 is allowed', () => {
  assert.deepEqual(packedPaths({ 'a.txt': 'x'.repeat(10), 'b.txt': 'x'.repeat(11) }, ['--max-size', '10']), ['a.txt']);
  assert.deepEqual(packedPaths({ 'a.txt': 'x', 'e.txt': '' }, ['--max-size', '0']), ['e.txt']);
  assert.equal(omittedOf({ 'a.txt': 'x' }, ['--max-size', '0']).large, 1);
  // the size is of the bytes, before anything is dropped (BOM, CRLF)
  assert.deepEqual(packedPaths({ 'a.txt': Buffer.from('﻿a\r\n') }, ['--max-size', '4']), []);
  assert.deepEqual(packedPaths({ 'a.txt': 'x'.repeat(1048576) }), ['a.txt']);
  assert.deepEqual(packedPaths({ 'a.txt': 'x'.repeat(1048577) }), []);
});

test('binary: NUL in the first 8000 bytes, or invalid UTF-8', () => {
  const late = Buffer.concat([Buffer.from('a'.repeat(8000)), Buffer.from([0]), Buffer.from('tail\n')]);
  const at7999 = Buffer.concat([Buffer.from('a'.repeat(7999)), Buffer.from([0])]);
  const files = {
    'nul.bin': Buffer.from('ab\0cd'), 'at7999.bin': at7999, 'late.txt': late, 'bad.txt': Buffer.from([0x61, 0xff, 0x62]),
    'trunc.txt': Buffer.from([0xe2, 0x82]), 'overlong.txt': Buffer.from([0xc0, 0xaf]), 'surrogate.txt': Buffer.from([0xed, 0xa0, 0x80]),
    'good.txt': Buffer.from('héllo 😀\n'), 'empty.txt': '',
  };
  assert.deepEqual(packedPaths(files), ['empty.txt', 'good.txt', 'late.txt']);
  assert.equal(omittedOf(files).binary, 6);
});

// ------------------------------------------------------------------- tokens

test('--tokens: counts, largest file first, ties by path, --top and the "more files" line', () => {
  const files = { 'a.txt': 'xxxx', 'b.txt': 'x'.repeat(101), 'c.txt': 'xxxx', 'README.md': 'xx\nxx\n', 'd.txt': 'x' };
  const r = pack(files, ['--tokens']);
  assert.equal(r.code, 0);
  assert.equal(
    r.out,
    'files: 5\nlines: 6\ncharacters: 116\nestimated tokens: 29\n\n' +
      'tokens characters lines path\n26 101 1 b.txt\n2 6 2 README.md\n1 4 1 a.txt\n1 4 1 c.txt\n1 1 1 d.txt\n',
  );
  assert.equal(r.err, 'packed: 5 files, 6 lines, 116 characters, about 29 tokens\n');
  const top = pack(files, ['--tokens', '--top', '2']);
  assert.equal(top.out.split('\n').slice(5).join('\n'), 'tokens characters lines path\n26 101 1 b.txt\n2 6 2 README.md\n... and 3 more files\n');
  const one = pack({ 'a.txt': 'x', 'b.txt': 'yy' }, ['--tokens', '--top', '1']);
  assert.ok(one.out.endsWith('1 2 1 b.txt\n... and 1 more files\n'));
  const exact = pack({ 'a.txt': 'x' }, ['--tokens', '--top', '1']);
  assert.ok(!exact.out.includes('more files'));
});

test('--tokens: ten rows by default; style and line numbers have no effect', () => {
  const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${String(i).padStart(2, '0')}.txt`, 'x\n']));
  const r = pack(files, ['--tokens', '--style', 'xml', '--line-numbers']);
  const rows = r.out.split('\n').filter((l) => /^\d+ \d+ \d+ f/.test(l));
  assert.equal(rows.length, 10);
  assert.ok(r.out.endsWith('... and 2 more files\n'));
  assert.ok(r.out.includes('characters: 24\n'));
});

test('--tokens with nothing packed prints the counts, the empty line and the column line', () => {
  assert.equal(
    pack({}, ['--tokens']).out,
    'files: 0\nlines: 0\ncharacters: 0\nestimated tokens: 0\n\ntokens characters lines path\n',
  );
});

test('--json: the object, key order and omitted counts', () => {
  const files = { 'big.txt': 'x'.repeat(101), 'a.txt': 'xy\n', '.env': 'S', 'bin.dat': Buffer.from([0]), 'yarn.lock': 'x' };
  const r = pack(files, ['--json']);
  assert.equal(r.code, 0);
  assert.equal(
    r.out,
    JSON.stringify(
      {
        tool: 'repo-pack',
        version: '0.1.0',
        total: { files: 2, lines: 2, characters: 104, tokens: 26 },
        files: [
          { path: 'big.txt', lines: 1, characters: 101, tokens: 26 },
          { path: 'a.txt', lines: 1, characters: 3, tokens: 1 },
        ],
        omitted: { ignored: 0, excluded: 0, 'not-included': 0, secret: 1, lock: 1, large: 0, binary: 1 },
      },
      null,
      2,
    ) + '\n',
  );
  assert.equal(r.err, 'packed: 2 files, 2 lines, 104 characters, about 26 tokens\nleft out: 1 secret\nleft out: 1 lock\nleft out: 1 binary\n');
  const top = JSON.parse(pack(files, ['--json', '--top', '1']).out);
  assert.equal(top.files.length, 1);
  assert.equal(top.total.files, 2);
  const none = JSON.parse(pack({}, ['--json']).out);
  assert.deepEqual(none.files, []);
});

// ------------------------------------------------------------- stderr, --out

test('the summary goes to stderr and never into the pack', () => {
  const r = pack({ 'a.txt': 'x\n', '.env': 'S', 'b.bin': Buffer.from([0]), 'c.bin': Buffer.from([0]) });
  assert.equal(r.err, 'packed: 1 files, 1 lines, 2 characters, about 1 tokens\nleft out: 1 secret\nleft out: 2 binary\n');
  assert.ok(!r.out.includes('packed:') && !r.out.includes('left out'));
});

test('--out writes the file, prints nothing on stdout, never packs itself', () => {
  const dir = fixture({ 'a.txt': 'x\n' });
  try {
    const out = path.join(dir, 'pack.md');
    const first = run([dir, '--out', out]);
    assert.equal(first.code, 0);
    assert.equal(first.out, '');
    assert.equal(first.err, 'packed: 1 files, 1 lines, 2 characters, about 1 tokens\n');
    const written = fs.readFileSync(out, 'utf8');
    assert.ok(written.includes('## File: a.txt'));
    assert.ok(!written.includes('pack.md'));
    // again, with the file now existing: the same bytes
    const second = run([dir, '--out', out]);
    assert.equal(fs.readFileSync(out, 'utf8'), written);
    assert.equal(second.err, first.err);
    // relative to the current directory
    const rel = run(['.', '--out', 'rel.md'], { cwd: dir });
    assert.equal(rel.code, 0);
    assert.equal(rel.out, '');
    assert.ok(fs.readFileSync(path.join(dir, 'rel.md'), 'utf8').includes('## File: a.txt'));
    // --out with --json and --tokens writes those
    run([dir, '--json', '--out', 'c.json'], { cwd: dir });
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'c.json'), 'utf8')).tool, 'repo-pack');
    run([dir, '--tokens', '--out', 'c.txt'], { cwd: dir });
    assert.ok(fs.readFileSync(path.join(dir, 'c.txt'), 'utf8').startsWith('files:'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('--out in a subfolder and inside an ignored folder is not counted', () => {
  const dir = fixture({ 'a.txt': 'x\n', '.gitignore': 'build/\n', 'build/old.txt': 'x', 'sub/keep.txt': 'x' });
  try {
    const r = run([dir, '--out', path.join(dir, 'build', 'pack.md'), '--json']);
    assert.equal(r.code, 0);
    assert.equal(r.out, '');
    assert.equal(fs.existsSync(path.join(dir, 'build', 'pack.md')), true);
    assert.equal(r.err.includes('left out: 1 ignored'), true);
    run([dir, '--out', path.join(dir, 'sub', 'p.md')]);
    const again = run([dir, '--out', path.join(dir, 'sub', 'p.md')]);
    assert.ok(again.err.startsWith('packed: 3 files'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('--out that cannot be written: exit 1 and a message', () => {
  const dir = fixture({ 'a.txt': 'x\n' });
  try {
    const r = run([dir, '--out', path.join(dir, 'no-such-folder', 'p.md')]);
    assert.equal(r.code, 1);
    assert.equal(r.out, '');
    assert.notEqual(r.err, '');
    const d = run([dir, '--out', dir]);
    assert.equal(d.code, 1);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ------------------------------------------------------------ walking

test('the folder is optional: the current directory is packed', () => {
  const dir = fixture({ 'a.txt': 'x\n' });
  try {
    const r = run([], { cwd: dir });
    assert.equal(r.code, 0);
    assert.ok(r.out.includes('## File: a.txt'));
    assert.equal(run(['sub'], { cwd: dir }).code, 2);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('dot files and dot folders are walked; .git is never entered or counted', () => {
  const files = { '.eslintrc': 'x', '.github/ci.yml': 'x', '.git/config': 'x', 'sub/.git/HEAD': 'x', 'a.txt': 'x' };
  assert.deepEqual(packedPaths(files), ['.eslintrc', '.github/ci.yml', 'a.txt']);
  const o = omittedOf({ ...files, '.gitignore': '*\n' });
  assert.equal(o.ignored, 4);
  // a file named .git is not entered either
  assert.deepEqual(packedPaths({ '.git': 'x', 'a.txt': 'x' }), ['a.txt']);
});

test('symbolic links are not followed and not counted', { skip: process.platform === 'win32' }, () => {
  const dir = fixture({ 'real.txt': 'x\n', 'd/in.txt': 'y\n' });
  const other = fixture({ 'outside.txt': 'z\n' });
  try {
    fs.symlinkSync(path.join(dir, 'real.txt'), path.join(dir, 'link.txt'));
    fs.symlinkSync(path.join(dir, 'd'), path.join(dir, 'dlink'));
    fs.symlinkSync(other, path.join(dir, 'olink'));
    fs.symlinkSync(path.join(dir, 'nowhere'), path.join(dir, 'dangling'));
    const r = run([dir, '--json', '--top', '10']);
    assert.deepEqual(JSON.parse(r.out).files.map((f) => f.path).sort(), ['d/in.txt', 'real.txt']);
    assert.equal(r.err, 'packed: 2 files, 2 lines, 4 characters, about 1 tokens\n');
    // a symlink as the folder given is fine
    const viaLink = run([path.join(dir, 'dlink'), '--json']);
    assert.deepEqual(JSON.parse(viaLink.out).files.map((f) => f.path), ['in.txt']);
  } finally {
    fs.rmSync(dir, { recursive: true });
    fs.rmSync(other, { recursive: true });
  }
});

test('the pack does not depend on the folder name or location', () => {
  const a = fixture({ 'x.txt': 'x\n' });
  const b = fixture({ 'x.txt': 'x\n' });
  try {
    assert.equal(run([a]).out, run([b]).out);
  } finally {
    fs.rmSync(a, { recursive: true });
    fs.rmSync(b, { recursive: true });
  }
});

test('an unreadable file is exit 1 with a message on stderr and nothing on stdout', { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () => {
  const dir = fixture({ 'a.txt': 'x\n', 'b.txt': 'y\n' });
  try {
    fs.chmodSync(path.join(dir, 'b.txt'), 0);
    const r = run([dir]);
    assert.equal(r.code, 1);
    assert.equal(r.out, '');
    assert.match(r.err, /b\.txt/);
  } finally {
    fs.chmodSync(path.join(dir, 'b.txt'), 0o644);
    fs.rmSync(dir, { recursive: true });
  }
});

// ------------------------------------------------------------- usage errors

function usageError(args) {
  const dir = fixture({ 'a.txt': 'x\n' });
  try {
    const before = fs.readdirSync(dir).sort();
    const r = run(args, { cwd: dir });
    assert.equal(r.code, 2, `args ${JSON.stringify(args)}: ${r.err}`);
    assert.equal(r.out, '');
    assert.notEqual(r.err, '');
    assert.deepEqual(fs.readdirSync(dir).sort(), before, 'no file written');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
}

test('usage errors: exit 2, message on stderr, nothing on stdout, no file written', () => {
  usageError(['--bogus']);
  usageError(['-x']);
  usageError(['-']);
  usageError(['--top=5']);
  usageError(['--style']);
  usageError(['--style', 'html']);
  usageError(['--style', '--tokens']);
  usageError(['--out']);
  usageError(['--out', '--json']);
  usageError(['--include']);
  usageError(['--exclude']);
  usageError(['--max-size']);
  usageError(['--max-size', '-1']);
  usageError(['--max-size', '1.5']);
  usageError(['--max-size', 'abc']);
  usageError(['--max-size', '']);
  usageError(['--top', '0']);
  usageError(['--top', '-3']);
  usageError(['--top', 'x']);
  usageError(['--top', '2.5']);
  usageError(['--top']);
  usageError(['--include', '']);
  usageError(['--exclude', '']);
  usageError(['--include', './']);
  usageError(['--exclude', '/']);
  usageError(['--exclude', './/']);
  usageError(['nope-folder']);
  usageError(['a.txt']);
  usageError(['.', '.']);
  usageError(['.', 'a.txt']);
  // an error anywhere wins over --out: no file is written
  usageError(['--out', 'p.md', '--style', 'html']);
  usageError(['--out', 'p.md', '--bogus', '--tokens']);
});

test('--help prints the usage on stdout and exits 0', () => {
  const r = run(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.out, /Usage/);
  assert.match(r.out, /--line-numbers/);
  assert.equal(r.err, '');
});

test('a value may start with a single dash', () => {
  const dir = fixture({ 'a.txt': 'x\n', '-b.txt': 'y\n' });
  try {
    const r = run([dir, '--exclude', '-b.txt', '--json']);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out).files.map((f) => f.path), ['a.txt']);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('the tool starts with the node shebang and uses only built-in modules', () => {
  const src = fs.readFileSync(TOOL, 'utf8');
  assert.match(src, /^#!\/usr\/bin\/env node\r?\n/);
  const specifiers = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
  assert.ok(specifiers.length > 0);
  for (const s of specifiers) assert.match(s, /^node:/);
});

test('package.json is as the job states', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, 'repo-pack');
  assert.equal(pkg.version, '0.1.0');
  assert.equal(pkg.type, 'module');
  assert.deepEqual(pkg.bin, { 'repo-pack': 'repo-pack.mjs' });
  assert.deepEqual(pkg.files, ['repo-pack.mjs', 'README.md', 'LICENSE']);
  assert.deepEqual(pkg.engines, { node: '>=22' });
  assert.deepEqual(pkg.scripts, { test: 'node --test' });
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.repository.url, 'git+https://github.com/tick-ai/repo-pack.git');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
