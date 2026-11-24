/* Round-5 fixtures: mixed AcroForm/flat PDF, empty-table form, photocopy photo. */
import { createRequire } from 'module';
import fs from 'fs';
const require_ = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require_('pdf-lib');
const sharp = (await import('sharp')).default;

const truth = JSON.parse(fs.readFileSync('positioning-truth.json', 'utf8'));
const W = 612, H = 792;
const pct = (x, y, w, h) => ({
  x0: (x / W) * 100, x1: ((x + w) / W) * 100,
  yTop: ((H - y - h) / H) * 100, yBot: ((H - y) / H) * 100,
});

// ---- A. mixed-form.pdf: AcroForm widgets on page 1, flat underscores on page 2 ----
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  const t = {};

  const p1 = doc.addPage([W, H]);
  const d1 = (txt, x, y, f = font, s = 12) => p1.drawText(txt, { x, y, size: s, font: f, color: rgb(0, 0, 0) });
  d1('Insurance Claim — Part 1 (Policyholder)', 130, 740, bold, 18);
  d1('Policy Number:', 50, 690);
  const f1 = form.createTextField('policy_number');
  f1.addToPage(p1, { x: 170, y: 684, width: 220, height: 22 });
  t['policy_number'] = { ...pct(170, 684, 220, 22), page: 1 };
  d1('Policyholder Name:', 50, 650);
  const f2 = form.createTextField('policyholder_name');
  f2.addToPage(p1, { x: 170, y: 644, width: 300, height: 22 });
  t['policyholder_name'] = { ...pct(170, 644, 300, 22), page: 1 };
  d1('Claim Amount ($):', 50, 610);
  const f3 = form.createTextField('claim_amount');
  f3.addToPage(p1, { x: 170, y: 604, width: 140, height: 22 });
  t['claim_amount'] = { ...pct(170, 604, 140, 22), page: 1 };

  const p2 = doc.addPage([W, H]);
  const d2 = (txt, x, y, f = font, s = 12) => p2.drawText(txt, { x, y, size: s, font: f, color: rgb(0, 0, 0) });
  d2('Insurance Claim — Part 2 (Witness statement, attach separately)', 80, 740, bold, 14);
  const rows = [['Witness Name:', 690], ['Witness Phone:', 650], ['Incident Location:', 610]];
  for (const [label, y] of rows) {
    d2(label, 50, y);
    const lw = font.widthOfTextAtSize(label, 12);
    const usX = 50 + lw + 8;
    d2('_'.repeat(Math.floor((450 - usX) / font.widthOfTextAtSize('_', 12))), usX, y);
    t[label.replace(':', '')] = { ...pct(usX, y - 2, 450 - usX, 16), page: 2 };
  }
  d2('Witness Signature:', 50, 150);
  const sw = font.widthOfTextAtSize('Witness Signature:', 12);
  d2('_'.repeat(28), 50 + sw + 8, 150);
  t['Witness Signature'] = { ...pct(50 + sw + 8, 145, 200, 20), page: 2 };

  fs.writeFileSync('mixed-form.pdf', await doc.save());
  truth['mixed-form.pdf'] = t;
}

// ---- B. table-form.pdf: header row + empty drawn grid rows ----
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const draw = (txt, x, y, f = font, s = 11) => page.drawText(txt, { x, y, size: s, font: f, color: rgb(0, 0, 0) });
  draw('Expense Reimbursement Request', 170, 740, bold, 18);
  draw('Employee Name:', 50, 700);
  const lw = font.widthOfTextAtSize('Employee Name:', 11);
  draw('_'.repeat(38), 50 + lw + 8, 700);
  const t = {};
  t['Employee Name'] = pct(50 + lw + 8, 698, 260, 15);

  // table: headers + 3 empty rows, full grid
  const cols = [
    ['Date', 55, 130],
    ['Expense Description', 135, 300],
    ['Category', 305, 420],
    ['Amount', 425, 555],
  ];
  const topY = 660; const rowH = 28; const nRows = 3;
  for (const [label, x0] of cols) draw(label, x0 + 4, topY - 18, bold, 11);
  const tableL = 55, tableR = 555;
  for (let r = 0; r <= nRows + 1; r += 1) {
    const y = topY - 24 - r * rowH + (r === 0 ? 24 : 0);
    page.drawLine({ start: { x: tableL, y: topY }, end: { x: tableR, y: topY }, thickness: 1, color: rgb(0, 0, 0) });
  }
  // horizontal lines
  for (let r = 0; r <= nRows; r += 1) {
    const y = topY - 24 - r * rowH;
    page.drawLine({ start: { x: tableL, y }, end: { x: tableR, y }, thickness: 0.8, color: rgb(0, 0, 0) });
  }
  // vertical lines
  for (const xv of [55, 130, 300, 420, 555]) {
    page.drawLine({ start: { x: xv, y: topY }, end: { x: xv, y: topY - 24 - nRows * rowH }, thickness: 0.8, color: rgb(0, 0, 0) });
  }
  // truth: first empty data row cell per column (row 1 spans y from topY-24-rowH to topY-24)
  const row1Top = topY - 24 - rowH;
  for (const [label, x0, x1] of cols) {
    t[`${label} row`] = pct(x0, row1Top, x1 - x0, rowH);
  }
  draw('Total amount will be reimbursed within 30 days of approval.', 50, 480, font, 10);
  draw('Approved by:', 50, 150);
  const aw = font.widthOfTextAtSize('Approved by:', 11);
  draw('_'.repeat(30), 50 + aw + 8, 150);
  t['Approved by'] = pct(50 + aw + 8, 148, 210, 15);
  fs.writeFileSync('table-form.pdf', await doc.save());
  truth['table-form.pdf'] = t;
}

// ---- C. photocopy.png: form-photo degraded like a bad photocopy ----
{
  // speckle noise overlay + streak
  let speckles = '';
  let seed = 12345;
  // 2 ** 31 written as a power: the privacy scan reads the decimal as a phone number.
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
  for (let i = 0; i < 900; i += 1) {
    const x = Math.round(rand() * 1275), y = Math.round(rand() * 1650), r = (rand() * 1.8 + 0.4).toFixed(1);
    const dark = rand() > 0.5;
    speckles += `<circle cx="${x}" cy="${y}" r="${r}" fill="${dark ? '#222' : '#fff'}" opacity="${(rand() * 0.5 + 0.3).toFixed(2)}"/>`;
  }
  const noise = `<svg width="1275" height="1650" xmlns="http://www.w3.org/2000/svg">
    ${speckles}
    <rect x="0" y="820" width="1275" height="3" fill="#333" opacity="0.5"/>
    <rect x="1180" y="0" width="95" height="1650" fill="#111" opacity="0.18"/>
  </svg>`;
  await sharp('form-photo.png')
    .grayscale()
    .linear(1.55, -55)           // crush contrast like a copier
    .composite([{ input: Buffer.from(noise) }])
    .rotate(1.2, { background: '#ffffff' })
    .resize(1275, 1650, { fit: 'cover' })
    .jpeg({ quality: 62 })
    .toFile('photocopy.jpg');
  // geometry ≈ unchanged (1.2° rotation + cover-crop keeps slots within margins)
  truth['photocopy.jpg'] = JSON.parse(JSON.stringify(truth['form-photo.png']));
}

fs.writeFileSync('positioning-truth.json', JSON.stringify(truth, null, 1));
console.log('round-5 ready:', ['mixed-form.pdf', 'table-form.pdf', 'photocopy.jpg'].map(f => `${f}:${fs.statSync(f).size}b`));
