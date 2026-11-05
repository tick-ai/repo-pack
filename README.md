# repo-pack

**repo-pack walks a folder and writes one file holding its text files, each under a header with its path, ready to paste or attach to an AI chat assistant, leaving out the `.gitignore`d files, binaries, big files, lock files and secrets, and telling you what it left out and how big the paste is.**

```
npx github:tick-ai/repo-pack
```

Run in a folder, it prints the pack on stdout (here, a three-file project with a `.env` and a `package-lock.json` next to it):

````
# Repository pack

- files: 3
- lines: 5
- characters: 74
- estimated tokens: 19

## Tree

```
.gitignore
README.md
src/
  add.js
```

## File: README.md

```
# demo

A tiny project.
```

## File: .gitignore

```
node_modules/
```

## File: src/add.js

```
export const add = (a, b) => a + b;
```
````

and, on stderr, never in the pack, what it did:

```
packed: 3 files, 5 lines, 74 characters, about 19 tokens
left out: 1 secret
left out: 1 lock
```

Want the size before you paste? `npx github:tick-ai/repo-pack --tokens`:

```
files: 3
lines: 5
characters: 74
estimated tokens: 19

tokens characters lines path
9 36 1 src/add.js
6 24 3 README.md
4 14 1 .gitignore
```

Tokens are always an **estimate**: the number of characters divided by 4, rounded up. repo-pack never claims more.

## Why

People paste code into chat assistants and agents all day. By hand that means opening files one by one, forgetting the ones that matter, and pasting the ones that must never leave the machine: `.env` files, private keys, a 4 MB lock file that eats the context window. And nobody knows how big the paste is until the assistant refuses it.

repo-pack does it in one command, with nothing to install and no network: plain Node 22, no dependencies, and the same bytes for the same folder every time.

## Run it

```
npx github:tick-ai/repo-pack [folder] [options]
```

or, from a clone of this repository:

```
node repo-pack.mjs [folder] [options]
```

It is not published on npm yet; run it from GitHub as above. Node 22 or newer is needed.

Pipe or copy it: `npx github:tick-ai/repo-pack | pbcopy`, or write a file: `npx github:tick-ai/repo-pack --out pack.md`.

## Options

```
node repo-pack.mjs [folder] [--style markdown|xml|plain] [--include <glob>]... [--exclude <glob>]...
                   [--max-size <bytes>] [--with-locks] [--line-numbers] [--out <file>]
                   [--tokens] [--top <n>] [--json]
```

| Option | Meaning |
| --- | --- |
| `folder` | The folder to pack, relative to the current directory or absolute. Default: the current directory. It must be an existing folder; at most one is given. |
| `--style markdown\|xml\|plain` | The format of the pack. Default `markdown`. |
| `--include <glob>` | Repeatable. Pack only files that match one of the globs. It only narrows: it never brings back what is left out by `.gitignore`, as a secret, a lock file, large or binary. |
| `--exclude <glob>` | Repeatable. Leave out files that match one of the globs. |
| `--max-size <bytes>` | A file with more bytes than this is left out. A whole number, 0 or more. Default `1048576` (1 MiB). A file of exactly that size is packed. |
| `--with-locks` | Pack the lock files too. |
| `--line-numbers` | Number each line of each file in the pack, as `<n>: <line>`, from 1, with no padding. |
| `--out <file>` | Write the output to this file (relative to the current directory) instead of stdout; nothing is then printed on stdout. The file is never packed itself, if it lies in the folder. |
| `--tokens` | Print only the counts (see [The counts](#the-counts---tokens-and---json)) instead of the pack. `--style` and `--line-numbers` have no effect. |
| `--top <n>` | With `--tokens` or `--json`, how many files the per-file list shows. A whole number above 0. Default `10`. |
| `--json` | Print the counts as one JSON object instead of the pack (it implies `--tokens`). |
| `--help` | Print the usage on stdout and exit 0. |

An option with a value takes the next argument as its value (`--top 5`); a next argument that starts with `--` is not a value. The form `--top=5` is not supported. Any argument that starts with `-` and is not listed above is an unknown option.

## What is walked

The folder is walked at any depth. Names that start with a dot are walked like any other (`.github/`, `.eslintrc`), except as said here.

- A file or folder named `.git`, at any depth, is never entered and never counted.
- Symbolic links (to files or to folders) are not followed and not counted. Anything that is not a regular file or folder is skipped and not counted.
- The file written with `--out` is never packed or counted.
- Every other regular file is **counted once**, in the first of these cases that applies, in this order: `ignored`, `excluded`, `not-included`, `secret`, `lock`, `large`, `binary`. A file that none of them applies to is **packed**. These seven words are the reasons shown in the summary and in the JSON.
- A file is read as UTF-8. Its **text** is what is packed: a byte order mark (EF BB BF) at the very start is dropped, and every `\r\n` is replaced by `\n` (a lone `\r` is kept). Lines, characters, tokens and the pack are all about this text.

## `.gitignore` rules (reason `ignored`)

Every file named `.gitignore` in the folder or in a folder below it is read, as UTF-8 (a leading byte order mark dropped; lines end at `\n`, and a `\r` just before it is dropped). Its patterns apply to the paths in its own folder and below, matched against the path relative to the folder that holds the `.gitignore`. A `.gitignore` above the folder given is not read. **`.git/info/exclude`, the global excludes file (`core.excludesFile`), `.ignore` files and every git setting are not read.** The `.gitignore` files are themselves packed like other files.

Each line is one pattern:

1. Trailing spaces (U+0020) are removed, except one that is preceded by a backslash. Leading spaces are kept. A line that is empty then matches nothing.
2. A line whose first character is `#` is a comment and matches nothing. A leading `\#` matches a name that starts with a literal `#`.
3. A line whose first character is `!` is a **negation**: the rest is the pattern, and a path it matches is not ignored. A leading `\!` matches a name that starts with a literal `!`.
4. A `/` at the end of the pattern means the pattern matches **folders only**; that `/` is then removed. A pattern with no trailing `/` matches files and folders.
5. A pattern that has a `/` anywhere else (beginning or middle) is **anchored**: it is matched against the whole relative path, and a leading `/` is removed. A pattern with no other `/` is matched against the **name** of a file or folder (its last part) at any depth below the `.gitignore`.
6. In the pattern: `*` matches any run of characters (also none) except `/`; `?` matches one character except `/`; `[...]` matches one character of the set, never `/`: it lists characters and ranges (`a-z`), is negated by `!` or `^` right after the `[`, takes a `]` right after the opening (or after the `!` or `^`) as a member, and a range whose end is before its start matches nothing; a `[` with no closing `]` is an ordinary character. `\` makes the next character ordinary. `*` and `?` also match a leading dot. Matching is case-sensitive, on Unicode code points.
7. `**` as a whole part of the pattern (between `/`, or at its start or end) means: at the start, `**/` matches any number of folders (also none); in the middle, `/**/` matches any number of folders (also none), so `a/**/b` matches `a/b` and `a/x/y/b`; at the end, `/**` matches everything inside (not the folder itself). A pattern that is only `**` matches everything. Two asterisks in any other place, and three or more anywhere, act as one `*`.

Which pattern wins: for a path, the patterns of all the `.gitignore` files that apply are tried from the one in the folder given down to the one in the path's own folder, each in the order of its lines, and **the last pattern that matches decides**: a negation means not ignored, any other means ignored; if none matches the path is not ignored. A file is tested as a file, a folder as a folder.

A **folder that is ignored is not entered, and nothing inside it can be re-included**: every regular file inside it is counted as `ignored`. So with `out/` then `!out/keep.txt`, `out/keep.txt` stays ignored; with `vendor/*` then `!vendor/lib/`, `vendor/lib/` is entered.

## Include and exclude globs (reasons `excluded`, `not-included`)

`--exclude <glob>` and `--include <glob>` can each be given many times. A glob is matched against a file's path **from the folder given**, with `/` between parts, never a name alone: it is always anchored at the root. One leading `./` and one trailing `/` of the glob are removed first; a glob that is empty after that is a usage error. The glob language is the one of the `.gitignore` rules above (items 6 and 7: `*`, `?`, `[...]`, `\`, `**`), with no `!`, no `#` and no other meaning for `/`. A glob matches a file when it matches the file's whole path **or the path of one of the folders the file is in**, so `--exclude src` leaves out everything under `src/`, and `--include docs` packs everything under `docs/`. Note that `--exclude '*.js'` therefore leaves out only the `.js` files at the root; use `'**/*.js'` for all of them.

- A file that matches any `--exclude` glob (and was not `ignored`) is `excluded`.
- When any `--include` is given, a file that matches none of them (and was not `ignored` or `excluded`) is `not-included`.
- `--include` only narrows: it never brings back a file that is `ignored`, `secret`, a `lock` (unless `--with-locks`), `large` or `binary`.

## What is left out (reasons `secret`, `lock`, `large`, `binary`)

Applied to a file that is not `ignored`, `excluded` or `not-included`, by its path and then its bytes, in this order.

- **`secret`**: the base name (the last part of the path), compared without regard to case, is `.env`, or starts with `.env.` and is not one of `.env.example`, `.env.sample`, `.env.template`, `.env.dist`; or is one of `.netrc`, `.npmrc`, `.pypirc`, `.pgpass`, `.htpasswd`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`; or ends with one of `.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.keystore`, `.crt`, `.cer`, `.der`, `.p8`, `.ppk`. (`id_rsa.pub` and `monkey.txt` are not.) These are judged by name only; repo-pack does not read a file's text to look for secrets, so check what you paste.
- **`lock`**: the base name, exactly (case-sensitive), is one of `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `Gemfile.lock`, `poetry.lock`, `Pipfile.lock`, `composer.lock`, `go.sum`, `uv.lock`, `pdm.lock`, `mix.lock`, `Podfile.lock`, `flake.lock`, `pubspec.lock`, `packages.lock.json`, `gradle.lockfile`. With `--with-locks` this reason does not apply.
- **`large`**: the file's size on disk is more than `--max-size` bytes (a file of exactly that size is packed). The size is the number of bytes of the file, before anything is dropped.
- **`binary`**: the file has a NUL byte (0x00) among its first 8000 bytes (positions 0 to 7999), or its bytes are not valid UTF-8 (the WHATWG Encoding Standard decoder, as `TextDecoder` with `fatal: true` implements it). A NUL byte later in a valid UTF-8 file does not make it binary. An empty file is text.

## Lines, characters and tokens

For a file's text `T` (after the byte order mark and the CRLF rule above):

- **characters**: the number of Unicode code points in `T` (a surrogate pair is one; a combining mark is one; `\n` is one).
- **lines**: the number of `\n` in `T`, plus 1 when `T` is not empty and does not end with `\n`. So `""` has 0 lines, `"a"` 1, `"a\n"` 1, `"a\n\n"` 2.
- **estimated tokens**: `ceil(characters / 4)` (0 characters are 0 tokens). This is an estimate, not what any particular model would count.
- **totals**: lines and characters are the sums over the packed files; the total estimated tokens are `ceil(total characters / 4)`, computed once from the total, not the sum of the files' tokens.

These counts never include headers, fences, tags, the tree or line numbers.

The **block** of a file is what is written for its text: with `--line-numbers`, each line of `T` as `<n>: <line>` and `\n` (`n` from 1, no padding, so an empty line is `3: `); without it, `T`, with a `\n` added when `T` is not empty and does not end with `\n`.

## The order of files

The packed files are sorted by their path (the relative path with `/` between parts) as a whole string, comparing **code unit by code unit** (a plain `<` on JavaScript strings; so `a.txt` comes before `a/b.txt`, because `.` is before `/`, and `B.txt` before `a.txt`), **except that the file `README.md` in the root of the folder, when packed, comes first**. No other file is moved (not `docs/README.md`, not `readme.md`). The order is the same in every format and with `--line-numbers`.

## The tree

The tree of the packed files is a list of lines. Each folder that holds packed files, directly or deeper, is a line `<name>/`, each packed file a line `<name>`, indented by two spaces per level of folders above it. The root is not a line. In each folder, the entries (folders and files together) are sorted by name, code unit by code unit, and a folder's lines are followed by its own entries. The tree's order is its own: `README.md` is not moved in it.

## The three formats

Every pack is UTF-8 with `\n` line ends, no byte order mark, ending with the `\n` that ends its last line. `N`, `L`, `C`, `T` are the packed files, lines, characters and estimated tokens (totals). Nothing in a pack depends on the folder's name or location, the time, or the machine.

### `markdown` (default)

````
# Repository pack

- files: N
- lines: L
- characters: C
- estimated tokens: T

## Tree

<fence>
<tree block><fence>

## File: <path>

<fence>
<block><fence>
````

with a `## File:` part (preceded by one empty line) for each packed file, in order. `<fence>` is a line of backticks: **as many as the longest run of consecutive backticks anywhere in the block it encloses, plus one, and at least three**; it opens and closes that block, with no language after it. A file whose text holds a line of three backticks is therefore written inside a fence of four or more, and the pack stays unambiguous. With nothing packed, the pack has the header and the empty tree in its fences.

### `xml`

```
<repository files="N" lines="L" characters="C" estimated_tokens="T">
<tree>
<tree block></tree>
<file path="<path>">
<![CDATA[
<block>]]>
</file>
</repository>
```

with one `<file ...>` part for each packed file, in order. The tree block is written with `&`, `<` and `>` replaced by `&amp;`, `&lt;` and `&gt;`. In the `path` attribute `&`, `<`, `>` and `"` are replaced by `&amp;`, `&lt;`, `&gt;` and `&quot;`. A file's block is written inside a CDATA section as it is, except that **every `]]>` in it is written `]]]]><![CDATA[>`**, so that the text of the file, such as `</file>`, never closes anything and the pack is well formed. (A reader gets a file's text back by joining the CDATA parts and dropping the one `\n` that follows `<![CDATA[`.)

### `plain`

```
repo-pack
files: N
lines: L
characters: C
estimated tokens: T

Tree:
<tree block>
=== <path> (lines: <n>) ===
<block>
```

with an `=== <path> (lines: <n>) ===` part for each packed file, in order, preceded by one empty line; `n` is the file's number of lines. Nothing is escaped: a file's block is written as it is, and because the header gives the number of lines the block holds, a reader can always tell where a file ends, even when its text holds a line that looks like a header.

## The counts: `--tokens` and `--json`

`--tokens` prints this instead of the pack:

```
files: N
lines: L
characters: C
estimated tokens: T

tokens characters lines path
<tokens> <characters> <lines> <path>
```

with one row per file, separated by single spaces, the files sorted by **characters, most first, equal characters by path** (code unit order, with no README rule). Only the first `--top` rows (default 10) are written; if there are more files, a last line `... and K more files` follows, `K` being the number of rows not shown. With no file, only the four lines of totals are written.

`--json` prints one JSON object instead, written as `JSON.stringify(object, null, 2)` followed by `\n`, with the keys in this order, and nothing else on stdout:

```json
{
  "tool": "repo-pack",
  "version": "0.1.0",
  "total": { "files": 5, "lines": 13, "characters": 131, "tokens": 33 },
  "files": [
    { "path": "big.txt", "lines": 1, "characters": 101, "tokens": 26 }
  ],
  "omitted": { "ignored": 0, "excluded": 0, "not-included": 0, "secret": 0, "lock": 0, "large": 0, "binary": 0 }
}
```

(Shown compactly; the real output is indented by `JSON.stringify(object, null, 2)`, one key per line.) `total` is for all packed files; `files` holds the first `--top` files in the order above (so with `--top` below the number of files, the list is shorter than `total.files`); `omitted` has the seven reasons, each the number of files counted under it (0 when none).

## The summary on stderr

Whatever is printed (a pack, the counts, a file written with `--out`), repo-pack also prints on stderr, and never in the pack, a first line

```
packed: N files, L lines, C characters, about T tokens
```

then, for each reason in the order `ignored`, `excluded`, `not-included`, `secret`, `lock`, `large`, `binary` whose count is above 0, one line `left out: <count> <reason>`, for example `left out: 3 binary`. Usage errors print their message on stderr only.

## Exit codes

- `0`: the output was written, even when no file was packed.
- `1`: the folder or a file in it could not be read, or `--out` could not be written. A message is printed on stderr.
- `2`: a usage error: an unknown option, an option with its value missing, a second folder, a folder that does not exist or is not a folder, a `--style` that is not one of the three, a `--max-size` or `--top` value that does not fit what is said above, or a glob that is empty. It prints a message on stderr, prints nothing on stdout, writes no file.

## Tests

`node --test` from the root of this repository. The tests run the tool as a child process in temporary folders they make and remove.

## Where it came from

Built by agents on TickHub, as TickHub job `5c282e2c-c832-4d8f-912c-fc4daa0b9d53`: https://tick.company/hub/#/job/5c282e2c-c832-4d8f-912c-fc4daa0b9d53. The job, the hand-ins and the receipt are on TickHub's public log. `docs/the-job.md` is the job as it was given.

AI does the work. Tick makes it trustworthy. https://tick.company

## Licence

Apache-2.0, Copyright 2026 Parsa Esmaeili, see `LICENSE`.
