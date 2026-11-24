/**
 * Env-sync checker, part one: find the env vars source files read.
 *
 * collectEnvReads(files) takes [{path, text}] and returns
 * {reads: [{name, file, line}], unresolved: [{file, line, expr}]}.
 *
 * A read is process.env.NAME, process.env['NAME'], process.env["NAME"] or a
 * key of `const { A, B: b } = process.env`. NEXT_PUBLIC_* names count like
 * any other. Writes (`=`, `+=`, `??=` and the like, `++`, `--`) and
 * `delete process.env.X` (parenthesised or not) are not reads.
 * process.env[IDENT], where IDENT is a plain identifier that
 * stringConstants(text) lists for the same file, is a read of that constant's
 * value, at the line of the process.env read; the declaration itself is not
 * a read. Any other process.env[expr] (an imported or `let` identifier, a
 * const set to a non-literal, a member such as cfg.priceEnv) goes in
 * unresolved with its expression text; it is never dropped. Constants are
 * not followed across files.
 *
 * process.env[v], where v is the loop variable of `for (const v of ARR)` or
 * the first parameter of an `ARR.forEach((v) => ...)`, `ARR.forEach(v =>
 * ...)` or `ARR.forEach(function (v) {...})` callback that holds the read, is
 * one read per element of ARR, all at the line of the process.env read, when
 * stringArrays(text) lists ARR. The innermost such loop over v wins over a
 * same-named string constant.
 *
 * Comments, string literals, the text parts of template literals and regex
 * literals are blanked out before the scan, so process.env written there is
 * not counted; code inside `${...}` still is.
 *
 * Known limits. This is a guard that .env.example lists what this
 * repository's code reads, not a JavaScript parser. Shapes it may misread,
 * none of which occur in this repository:
 * - a regex literal right after a closing parenthesis, as in
 *   `if (on) /process\.env\.X/.test(s)`, is taken for a division, so
 *   process.env inside it is counted;
 * - JSX text holding a lone quote or backtick, or a `//` or `/*`, is taken
 *   for the start of a string or comment and can hide reads after it;
 * - an unclosed block comment or template literal hides the rest of the
 *   file;
 * - destructuring is only seen in the plain `{ ... } = process.env` form
 *   with no nested braces; `{ A: { B } } = process.env`, a spread
 *   `...rest`, or process.env passed through another variable is not
 *   followed;
 * - stringConstants only sees identifiers made of ASCII letters, digits, `_`
 *   and `$`, so `const café = 'X'` or a `\u`-escaped identifier is not listed;
 * - in stringConstants, a nested destructuring such as
 *   `const { a: { b } } = x` ends the reading of that const statement, so
 *   its names and any later declarators in it are not seen, and a value
 *   carried on by a next line that starts with `++`, `--`, `!` or `~` is
 *   taken to end at the line break;
 * - a loop variable is matched by name only: a parameter or `const` of the
 *   same name declared again inside the loop body still counts as the loop
 *   variable, and a for...of body without braces is taken to end at the
 *   first `;` or line break;
 * - stringArrays does not see changes made to an array after its
 *   declaration, such as `ARR.push('X')`.
 */

const ENV = /(?<![\w$.])process\s*\.\s*env(?![\w$])/g;
const DOT = /^\s*\??\.\s*([A-Za-z_$][\w$]*)/;
// An assignment operator after the member: =, +=, ||=, ??= and so on, not == or ===.
const WRITE_AFTER = /^\s*(?:(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?!=)|\+\+|--)/;
const WRITE_BEFORE = /(?:\+\+|--|(?<![\w$])delete[\s(]*)$/;
const DESTRUCTURE = /\{([^{}]*)\}\s*=\s*$/;
const LITERAL = /^(['"`])([^'"`\\$]*)\1$/;
const KEY = /^\s*([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")/;
const IDENT = /^[A-Za-z_$][\w$]*$/;
// After these, a slash starts a regex literal rather than a division. `<` is
// left out so a JSX closing tag `</a>` is not read as a regex.
const REGEX_AFTER_PUNCT = '(,=:[!&|?{};+-*%>~^';
const REGEX_AFTER_WORD = /^(?:return|typeof|case|do|else|in|of|new|delete|void|throw|instanceof|yield|await)$/;

function blank(chars, from, to) {
  for (let i = from; i < to; i += 1) if (chars[i] !== '\n') chars[i] = ' ';
}

// The text with comments and literal contents replaced by spaces; newlines and
// offsets are kept, so an index into the result is an index into the text.
function maskCode(text) {
  const chars = text.split('');
  const braces = []; // one open-brace count per `${` we are inside
  let prev = ''; // last code character that is not whitespace
  let i = 0;

  function scanTemplate(start) {
    let j = start;
    while (j < text.length && text[j] !== '`') {
      if (text[j] === '\\') j += 2;
      else if (text[j] === '$' && text[j + 1] === '{') {
        blank(chars, start, j);
        braces.push(0);
        prev = '{';
        return j + 2;
      } else j += 1;
    }
    blank(chars, start, j);
    prev = '`';
    return j + 1;
  }

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      let j = i;
      while (j < text.length && text[j] !== '\n') j += 1;
      blank(chars, i, j);
      i = j;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const j = end === -1 ? text.length : end + 2;
      blank(chars, i, j);
      i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      blank(chars, i + 1, Math.min(j, text.length));
      prev = c;
      i = j + 1;
    } else if (c === '`') {
      i = scanTemplate(i + 1);
    } else if (c === '/' && (prev === '' || REGEX_AFTER_PUNCT.includes(prev) || REGEX_AFTER_WORD.test(/[\w$]*$/.exec(text.slice(0, i).trimEnd())[0]))) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== '\n' && (inClass || text[j] !== '/')) {
        if (text[j] === '\\') j += 1;
        else if (text[j] === '[') inClass = true;
        else if (text[j] === ']') inClass = false;
        j += 1;
      }
      if (text[j] === '/') {
        blank(chars, i + 1, j);
        prev = '/';
        i = j + 1;
      } else {
        prev = '/';
        i += 1;
      }
    } else if (c === '}' && braces.length && braces[braces.length - 1] === 0) {
      braces.pop();
      i = scanTemplate(i + 1);
    } else {
      if (braces.length && c === '{') braces[braces.length - 1] += 1;
      if (braces.length && c === '}') braces[braces.length - 1] -= 1;
      if (!/\s/.test(c)) prev = c;
      i += 1;
    }
  }
  return chars.join('');
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

// Index just past the bracket that closes the one at open, or -1.
function closeBracket(code, open, pair = '[]') {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === pair[0]) depth += 1;
    else if (code[i] === pair[1] && --depth === 0) return i + 1;
  }
  return -1;
}

const FOR_OF = /(?<![\w$.])for\s*\(\s*const\s+([A-Za-z_$][\w$]*)\s+of\s+([A-Za-z_$][\w$]*)\s*\)\s*/g;
const FOR_EACH = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*forEach\s*\(/g;
const CALLBACK = /\s*(?:\(\s*([A-Za-z_$][\w$]*)\s*[,)]|([A-Za-z_$][\w$]*)\s*=>|function\s*(?:[A-Za-z_$][\w$]*\s*)?\(\s*([A-Za-z_$][\w$]*)\s*[,)])/y;

// The loops in the masked code that bind a name to the elements of a named
// array: [{name, array, from, to}], where from..to is the body's span.
function findLoops(code) {
  const loops = [];
  for (const m of code.matchAll(FOR_OF)) {
    const from = m.index + m[0].length;
    let to;
    if (code[from] === '{') to = closeBracket(code, from, '{}');
    else {
      const stop = /[;\n]/.exec(code.slice(from));
      to = stop ? from + stop.index : code.length;
    }
    if (to !== -1) loops.push({ name: m[1], array: m[2], from, to });
  }
  for (const m of code.matchAll(FOR_EACH)) {
    const open = m.index + m[0].length - 1;
    CALLBACK.lastIndex = open + 1;
    const head = CALLBACK.exec(code);
    const to = closeBracket(code, open, '()');
    if (head && to !== -1) loops.push({ name: head[1] || head[2] || head[3], array: m[1], from: open, to });
  }
  return loops;
}

// The values of the array run over by the innermost loop over ident that
// holds index, or undefined.
function loopValues(loops, arrays, ident, index) {
  let best = null;
  for (const loop of loops) {
    if (loop.name === ident && loop.from <= index && index < loop.to && (!best || loop.from > best.from)) best = loop;
  }
  return best ? arrays.get(best.array) : undefined;
}

function scanFile({ path, text }) {
  const code = maskCode(text);
  const found = [];
  let constants = null; // stringConstants(text), read on first need
  let loops = null; // findLoops(code), read on first need
  let arrays = null; // stringArrays(text), read on first need
  for (const m of code.matchAll(ENV)) {
    const start = m.index;
    const after = start + m[0].length;
    const rest = code.slice(after);
    const dot = DOT.exec(rest);
    const bracket = /^\s*(\?\.\s*)?\[/.exec(rest);
    if (dot || bracket) {
      let end;
      let entry;
      if (dot) {
        end = after + dot[0].length;
        entry = { at: start, read: { name: dot[1] } };
      } else {
        const open = after + bracket[0].length - 1;
        end = closeBracket(code, open);
        if (end === -1) continue;
        const expr = text.slice(open + 1, end - 1).trim();
        const literal = LITERAL.exec(expr);
        let names = literal ? [literal[2]] : undefined;
        if (!literal && IDENT.test(expr)) {
          loops = loops || findLoops(code);
          arrays = arrays || stringArrays(text);
          names = loopValues(loops, arrays, expr, start);
          if (!names) {
            constants = constants || stringConstants(text);
            names = constants.has(expr) ? [constants.get(expr)] : undefined;
          }
        }
        entry = names ? { at: start, names } : { at: start, expr };
      }
      if (WRITE_AFTER.test(code.slice(end)) || WRITE_BEFORE.test(code.slice(0, start))) continue;
      if (entry.names) found.push(...entry.names.map((name) => ({ at: start, read: { name } })));
      else found.push(entry);
      continue;
    }
    const destructure = DESTRUCTURE.exec(code.slice(0, start));
    if (!destructure) continue;
    // Split the masked code, so commas in comments and string defaults do not
    // split keys; a quoted key's name is read back from the text at its offset.
    let offset = destructure.index + 1;
    for (const part of destructure[1].split(',')) {
      const key = KEY.exec(part);
      if (key) {
        const at = offset + key[0].length - key[1].length;
        const name = text.slice(at, at + key[1].length).replace(/^['"]|['"]$/g, '');
        found.push({ at, read: { name } });
      }
      offset += part.length + 1;
    }
  }
  found.sort((a, b) => a.at - b.at);
  const reads = [];
  const unresolved = [];
  for (const f of found) {
    const line = lineAt(text, f.at);
    if (f.read) reads.push({ name: f.read.name, file: path, line });
    else unresolved.push({ file: path, line, expr: f.expr });
  }
  return { reads, unresolved };
}

function collectEnvReads(files) {
  const reads = [];
  const unresolved = [];
  for (const file of files) {
    const result = scanFile(file);
    reads.push(...result.reads);
    unresolved.push(...result.unresolved);
  }
  return { reads, unresolved };
}

/*
 * Part two: read .env.example and compare it with the reads.
 *
 * parseEnvExample(text) returns {entries: [{name, line, commented, comment}],
 * duplicates: [name]}. An entry is a `NAME=value` line or a commented
 * `# NAME=value` line; comment is the line directly above it when that line
 * is a comment and not itself an entry, else null. duplicates lists, once
 * each, the names that appear on more than one entry line.
 *
 * compareEnv(collected, example) takes collectEnvReads' result and
 * parseEnvExample's and returns sorted name lists
 * {missing, stale, duplicates, unresolved, badComments}: missing is read but
 * not listed, stale is listed but not read, unresolved is the collector's
 * list as it came, and badComments names entries whose comment is not
 * `# required|optional · <adapter> · <explanation>`.
 */

const ENTRY = /^\s*(#\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const ADAPTERS = ['supabase', 'anthropic', 'stripe', 'resend', 'upstash', 'sentry', 'vercel', 'none'];
const GOOD_COMMENT = new RegExp(`^#\\s*(?:required|optional)\\s*·\\s*(?:${ADAPTERS.join('|')})\\s*·\\s*\\S`);

function parseEnvExample(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  const seen = new Set();
  const duplicates = new Set();
  lines.forEach((raw, i) => {
    const m = ENTRY.exec(raw);
    if (!m) return;
    const name = m[2];
    const above = i > 0 ? lines[i - 1].trim() : '';
    const comment = above.startsWith('#') && !ENTRY.test(above) ? above : null;
    entries.push({ name, line: i + 1, commented: Boolean(m[1]), comment });
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  });
  return { entries, duplicates: [...duplicates].sort() };
}

function compareEnv(collected, example) {
  const read = new Set(collected.reads.map((r) => r.name));
  const listed = new Set(example.entries.map((e) => e.name));
  const badComments = new Set(
    example.entries.filter((e) => !e.comment || !GOOD_COMMENT.test(e.comment)).map((e) => e.name),
  );
  return {
    missing: [...read].filter((n) => !listed.has(n)).sort(),
    stale: [...listed].filter((n) => !read.has(n)).sort(),
    duplicates: example.duplicates,
    unresolved: collected.unresolved,
    badComments: [...badComments].sort(),
  };
}

/*
 * Part three: a file's same-file string constants.
 *
 * stringConstants(text) returns a Map from identifier to string value for
 * every `const IDENT = 'LITERAL'` in the text, with single, double or plain
 * backtick quotes (no `${}`). Declarations are found in maskCode's output and
 * the value is read back from the text at the same offsets, so a declaration
 * inside a comment, string or template text is not found. The value is the
 * text between the quotes as written; escapes are not decoded. Every
 * declarator of `const A = 'x', B = 'y'` is read. let and var are not looked
 * at. An identifier is left out when any of its const declarations in the
 * file, in any scope (a destructuring included), is set to anything but a
 * lone literal, or when two of them have different values; the same value
 * declared twice is kept.
 */

const CONST_WORD = /(?<![\w$.])const(?![\w$])/g;
const DECLARATOR = /\s*([A-Za-z_$][\w$]*)\s*=(?!=)/y;
const PATTERN = /\s*(?:\{([^{}[\]]*)\}|\[([^{}[\]]*)\])\s*=(?!=)/y;
const BOUND_NAME = /([A-Za-z_$][\w$]*)\s*$/;
// In masked code a literal's contents are spaces; a template keeps its
// newlines, and `${` stays visible.
const LONE_LITERAL = /^(?:'[ ]*'|"[ ]*"|`[ \n]*`)$/;
// A value goes on past a line break when its line ends with one of these, or
// when the next line starts with an operator, `.`, `(`, `[`, `in` or
// `instanceof`. `/` is left out: a line ending in one ends a regex literal.
const GOES_ON_AFTER = '=+-*%&|^!~?:<>,.';
const GOES_ON_BEFORE = /\s*(?:[.?+\-*/%&|^:<>=,([]|in(?![\w$])|instanceof(?![\w$]))/y;

// Where the value that starts at `from` in the masked code ends: at a comma
// that leads to the next declarator (more), or where the statement ends.
// Template text is blank in masked code, so the only `{` in it opens a `${`.
function valueEnd(code, from) {
  const templates = []; // the depth at which each open template's text sits
  let depth = 0;
  let last = '';
  for (let i = from; i < code.length; i += 1) {
    const c = code[i];
    const inText = templates.length > 0 && templates[templates.length - 1] === depth;
    if (c === '`') {
      if (inText) templates.pop();
      else templates.push(depth);
    } else if (inText) {
      if (c === '{') depth += 1;
    } else if ('([{'.includes(c)) {
      depth += 1;
    } else if (')]}'.includes(c)) {
      depth -= 1;
      if (depth < 0) return { end: i, more: false };
    } else if (depth === 0 && (c === ';' || c === ',')) {
      return { end: i, more: c === ',' };
    } else if (depth === 0 && c === '\n' && last && !GOES_ON_AFTER.includes(last)) {
      GOES_ON_BEFORE.lastIndex = i + 1;
      if (!GOES_ON_BEFORE.test(code)) return { end: i, more: false };
    }
    if (!/\s/.test(c)) last = c;
  }
  return { end: code.length, more: false };
}

function stringConstants(text) {
  const code = maskCode(text);
  const values = new Map(); // null once a name cannot be listed
  const note = (name, value) => {
    values.set(name, values.has(name) && values.get(name) !== value ? null : value);
  };
  for (const m of code.matchAll(CONST_WORD)) {
    let at = m.index + m[0].length;
    for (;;) {
      DECLARATOR.lastIndex = at;
      const decl = DECLARATOR.exec(code);
      PATTERN.lastIndex = at;
      const pattern = decl ? null : PATTERN.exec(code);
      if (!decl && !pattern) break;
      const start = at + (decl || pattern)[0].length;
      const { end, more } = valueEnd(code, start);
      if (decl) {
        const raw = code.slice(start, end);
        const body = raw.trim();
        const from = start + raw.length - raw.trimStart().length;
        note(decl[1], LONE_LITERAL.test(body) ? text.slice(from + 1, from + body.length - 1) : null);
      } else {
        for (const part of (pattern[1] ?? pattern[2]).split(',')) {
          const bound = BOUND_NAME.exec(part.split('=')[0]);
          if (bound) note(bound[1], null);
        }
      }
      if (!more) break;
      at = end + 1;
    }
  }
  return new Map([...values].filter(([, value]) => value !== null));
}

/*
 * Part four: a file's same-file string arrays.
 *
 * stringArrays(text) returns a Map from identifier to its list of values for
 * every `const IDENT = ['A', 'B']` whose value is that array alone and whose
 * elements are all lone string literals (a trailing comma is allowed), read
 * back from the text as stringConstants does. An empty array, or an
 * identifier declared with `const IDENT = [` more than once, is left out.
 */

const ARRAY_DECL = /(?<![\w$.])const\s+([A-Za-z_$][\w$]*)\s*=\s*(?=\[)/g;

function stringArrays(text) {
  const code = maskCode(text);
  const values = new Map(); // null once a name cannot be listed
  for (const m of code.matchAll(ARRAY_DECL)) {
    const open = m.index + m[0].length;
    const close = closeBracket(code, open);
    let list = null;
    if (close !== -1 && code.slice(open, valueEnd(code, open).end).trim() === code.slice(open, close)) {
      const parts = [];
      let offset = open + 1;
      for (const part of code.slice(open + 1, close - 1).split(',')) {
        parts.push({ part, offset });
        offset += part.length + 1;
      }
      if (parts.length > 1 && !parts[parts.length - 1].part.trim()) parts.pop();
      if (parts.every(({ part }) => LONE_LITERAL.test(part.trim()))) {
        list = parts.map(({ part, offset: at }) => {
          const from = at + part.length - part.trimStart().length;
          return text.slice(from + 1, from + part.trim().length - 1);
        });
      }
    }
    values.set(m[1], values.has(m[1]) ? null : list);
  }
  return new Map([...values].filter(([, value]) => value !== null));
}

module.exports = { collectEnvReads, parseEnvExample, compareEnv, stringConstants, stringArrays };
