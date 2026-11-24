/**
 * Helpers for the end-to-end run (docker compose with compose.e2e.yml on top).
 *
 * makeFormPdf() makes a one-page form labelled 'Full name' and 'Signature'.
 * readSetupCode(output) finds the setup code in `docker compose logs app`.
 * waitForHealth(url, fetchFn, {timeoutMs, intervalMs}) asks until url is ok.
 * randomPassword() makes a fresh password for each run, so none is kept here.
 * checkSignedPdf(bytes, {sha256, bytes, original}) lists what is wrong with a
 * downloaded signed PDF; an empty list means nothing is.
 * writeHandoff(file, data) and readHandoff(file) carry what the second phase
 * (tests/e2e/siteAddress.e2e.js) needs from the first, the owner's and a
 * member's address and password among them, from one process to the next:
 * written once (never over a file already there), readable by this user
 * only, and deleted as soon as it is read. Neither prints anything.
 */

const crypto = require('crypto');
const fs = require('fs');
const { PDFDocument, StandardFonts } = require('pdf-lib');

async function makeFormPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Full name', { x: 72, y: 700, size: 14, font });
  page.drawLine({ start: { x: 72, y: 680 }, end: { x: 400, y: 680 } });
  page.drawText('Signature', { x: 72, y: 600, size: 14, font });
  page.drawLine({ start: { x: 72, y: 580 }, end: { x: 400, y: 580 } });
  return doc.save();
}

function readSetupCode(output) {
  const matches = [...String(output || '').matchAll(/Setup code: ([0-9a-f]{32})/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

async function waitForHealth(url, fetchFn, { timeoutMs = 120000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no answer';
  for (;;) {
    try {
      const res = await fetchFn(url);
      if (res.ok) return res;
      last = `status ${res.status}`;
    } catch (error) {
      last = error.message;
    }
    if (Date.now() >= deadline) throw new Error(`${url} not healthy after ${timeoutMs} ms (${last})`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function randomPassword() {
  return crypto.randomBytes(18).toString('base64url');
}

async function pageCount(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

async function checkSignedPdf(bytes, { sha256, bytes: size, original }) {
  const data = Buffer.from(bytes);
  const problems = [];
  const isPdf = data.subarray(0, 5).toString('latin1') === '%PDF-';
  if (!isPdf) problems.push('not a PDF');
  if (crypto.createHash('sha256').update(data).digest('hex') !== String(sha256).toLowerCase()) {
    problems.push('wrong fingerprint (sha256)');
  }
  if (data.length !== size) problems.push(`wrong size: ${data.length} bytes, expected ${size}`);
  if (isPdf) {
    let pages = null;
    try {
      pages = await pageCount(data);
    } catch (error) {
      problems.push(`won't load: ${error.message}`);
    }
    if (pages !== null) {
      const originalPages = await pageCount(original);
      if (pages !== originalPages) problems.push(`page count differs: ${pages}, original has ${originalPages}`);
    }
  }
  if (data.equals(Buffer.from(original))) problems.push('identical to the original');
  return problems;
}

function writeHandoff(file, data) {
  if (!file) throw new Error('No file to hand the second phase its data');
  fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
}

function readHandoff(file) {
  if (!file) throw new Error('No handoff file: set COSIGN_E2E_HANDOFF to the file the first phase wrote');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`The first phase left no handoff file (${error.code || 'unreadable'})`);
  }
  fs.unlinkSync(file);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The handoff file is not JSON');
  }
}

module.exports = {
  makeFormPdf, readSetupCode, waitForHealth, randomPassword, checkSignedPdf, writeHandoff, readHandoff,
};
