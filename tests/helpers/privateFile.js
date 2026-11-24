const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/**
 * A file some test cases read that is not in every copy of this tree: the
 * published tree leaves a few files out. privateFile(rel), with rel relative
 * to the repository root, returns {path, present, it, test}: path is the
 * absolute path, present whether it exists here, and it and test run a case
 * only when it does. Where it does not, the case is skipped visibly, with the
 * reason at the end of its name, and every other case in the file still runs.
 * Read the file only inside such a case.
 */
function privateFile(rel) {
  const file = path.join(ROOT, rel);
  const present = fs.existsSync(file);
  const reason = ` (skipped: ${rel} is not in this tree)`;
  const guard = (fn) => (present ? fn : (name, ...rest) => fn.skip(name + reason, ...rest));
  return { path: file, present, it: guard(it), test: guard(test) };
}

module.exports = { privateFile };
