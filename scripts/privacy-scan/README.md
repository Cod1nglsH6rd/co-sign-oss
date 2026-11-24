# Privacy scanner

A tripwire to run before publishing the repository, not a proof that the tree
holds no personal details.

`scan.js` exports `scanText(text, opts)`, a pure function that returns
findings as `{line, rule, match}`:

- `opts.hashes`: a Set of lowercase hex SHA-256 hashes of lowercase search
  terms, so the private terms themselves never sit in the tree.
- `opts.terms`: optional plaintext terms. `termsFromEnv(process.env)` reads
  them from `PRIVATE_SCAN_TERMS`, comma-separated.

Rules:

- `hashed-term`: a word, or two adjacent words split only by spaces, whose
  lowercase SHA-256 is in the set. The pieces of a word between its `. _ ' -`
  joins are checked too, so `Alice-Private's` and `www.private.example` are
  caught.
- `email`: an email address whose local part or exact domain hashes into the
  set.
- `phone`: a North American phone number whose exchange is not 555, so
  `(408) 555-2317` passes and the same number with any other exchange is
  flagged. `scanTree` does
  not apply it to a binary file (one holding a NUL byte), a minified vendor
  file (`*.min.js`, `*.min.mjs`, `*.min.cjs`, `*.min.css`, such as the pdf.js
  workers under `public/`) or a font (`.ttf`, `.otf`, `.woff`, `.woff2`,
  `.eot`), where digit runs are code or glyph data; every other rule still
  reads those files.
- `term`: a plaintext term, matched case-insensitively.

`scanTree(root, files, opts)` scans a list of paths relative to `root` and
returns `{findings, errors}`. Each file is read as UTF-8 and passed to
`scanText` with the same `opts` (`hashes` and `terms`; without `hashes` it
loads `terms.json`, or `opts.termsFile`, through `loadHashes`); each finding is
`{path, line, rule}`, without the matched text. Some paths are never read and
add one `{path, error}` entry instead:

- an absolute path (`absolute path`);
- a path that resolves outside `root`, such as `../x` or `a/../../x`
  (`outside root`);
- a file that cannot be read: missing, a directory, or a read error (the
  error code, such as `ENOENT` or `EISDIR`).

`formatResults({findings, errors})` returns one line per finding,
`path:line rule`, then one per error, `path: error: <reason>`. The lines never
include the matched text, so they are safe to print in a log.

## Running it

From the repository root:

```
PRIVATE_SCAN_TERMS='first term,second term' node scripts/privacy-scan/scan.js
```

`npm run scan:private` runs the same command. The CLI scans every file from
`git ls-files` with the hashes in `terms.json` (a JSON list of lowercase hex
SHA-256 hashes of lowercase terms, next to `scan.js`; none when the file is
missing) and the comma-separated plaintext terms in `PRIVATE_SCAN_TERMS`
(none when it is unset), leaves out every hit `known-hits.json` lists, and
prints one `path:line rule` or `path: error: <reason>` line per result, then
one `file: stale: rule` line per listed hit that no longer occurs. The output
never echoes the matched text, only the path, line number and rule name.

To scan another folder, such as a built public tree, pass `--root`:

```
node scripts/privacy-scan/scan.js --root ../public-tree
```

It scans every file under that folder (leaving out `.git`) instead of
`git ls-files`, and does not apply `known-hits.json`, whose paths are the
repository's.

Exit codes: `0` when there are no unlisted findings, no errors and no stale
known hits, `1` otherwise.

### In the public tree

`terms.json` and `known-hits.json` stay in the private repository: the
hashes would let anyone confirm a guess, and the known hits say where the
terms still occur. Without `terms.json` the CLI prints one
`terms.json: note: ...` line, checks no hashed term or email, and still runs
the phone rule and the terms in `PRIVATE_SCAN_TERMS`; without
`known-hits.json` there are no known hits. In a folder that is not a git
checkout of its own (a tree the publish script built, before its first
commit) it prints a note and scans every file there except `.git`,
`node_modules`, `.next` and `coverage`. A note line never changes the exit
code.

`main({root, files, termsFile, knownHitsFile, args, env, log})` is the same
run as a function, for tests: it defaults to the repository root,
`git ls-files`, `terms.json`, `known-hits.json` (none when `root` or
`--root` is given), `process.env` and `console.log`, reads `--root <dir>`
from `args`, and returns the exit code.

## Known hits

`known-hits.json` lists the hits the tree still has today as
`{file, rule, count}`, never the matched text. `checkKnownHits(findings,
known)` returns `{unlisted, stale}`: every hit of a file and rule with no
entry, or with more hits than its count, is unlisted, and an entry whose file
and rule no longer hit is stale. The jest tree test and the CLI fail on
either. When you clear a hit, lower or remove its entry. Requiring `scan.js` runs nothing;
the CLI runs only under `require.main === module`.

## Known limits

- An address with a single-label domain (`alice@private`) is not read as an
  email, so the email rule does not check it, even when that domain's hash is
  in the set.
- The email rule needs the address's whole domain to hash into the set. An
  address on a subdomain (`bob@mail.private.example`) is caught only by the
  word rule. Only ASCII addresses are read as emails.
- Adjacent-word pairs are checked only across spaces. Two words split by
  punctuation (`Alice, Private`) or by an email's separators are not checked
  as a pair.
- The phone rule skips a digit run inside a longer hex or alphanumeric token
  (`deadbeef4083214567cafe`) and a 3-3-4 run inside an international or longer
  number, so a real number written that way is missed.
- `scanTree` does not resolve symlinks: the root check looks at the path as
  written, so a link inside `root` that points outside it is still read.
- `scanTree` reads every file as UTF-8, binary files too, so text inside a
  binary (a PDF, a font) may be garbled and missed. A phone number inside a
  binary, minified vendor or font file is never reported.
- There is no file skip list (`package-lock.json`, `node_modules`) and no
  check for Office lock files or `supabase/.temp`; the caller chooses which
  files to pass, and the CLI scans everything `git ls-files` lists. A skip list and the lock-file checks are follow-ups.
- `terms.json` holds only the hashes of the production domain, its Vercel
  host, the GitHub handle and the Vercel team slug. Names, emails and
  addresses of people are never committed, hashed or not; whoever runs the
  scan supplies them in `PRIVATE_SCAN_TERMS`.
- The jest suite that scans the whole tree with the private terms
  (`tests/privacy/trackedTreeScan.test.js`, in the private repository only)
  uses the `hashed-term` and `email` rules only, not `phone`, and skips
  binary files and the private automation's config and decision notes.
