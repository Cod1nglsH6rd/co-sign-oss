globalThis.DOMMatrix = class { constructor() {} };
globalThis.Path2D = class { constructor() {} };
globalThis.ImageData = class { constructor() {} };
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
import fs from 'fs';
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require_('pdf-lib');
const sharp = (await import('sharp')).default;

const truth = JSON.parse(fs.readFileSync('positioning-truth.json'));

// ---- I-9 page 1 truth (widget rects) ----
// Optional: download i-9.pdf from uscis.gov (browser fetch; curl is Akamai-blocked).
if (fs.existsSync('i-9.pdf')) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync('i-9.pdf')), isEvalSupported: false, disableFontFace: true }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const annots = await page.getAnnotations();
  const t = {};
  let i = 0;
  for (const a of annots) {
    if (!a.fieldName || !a.rect) continue;
    const [x0, y0, x1, y1] = a.rect;
    t[`w${i++}_${a.fieldName.slice(-40)}`] = { page: 1, x0: x0 / vp.width * 100, x1: x1 / vp.width * 100, yTop: (vp.height - y1) / vp.height * 100, yBot: (vp.height - y0) / vp.height * 100 };
  }
  truth['i-9.pdf'] = t;
  console.log('i-9 p1 widgets:', i);
}

// ---- degraded photos ----
{
  const src = fs.readFileSync('form-photo.png');
  const W = 1275, H = 1650, deg = 7, rad = deg * Math.PI / 180;
  await sharp(src).rotate(deg, { background: '#ffffff' }).png().toFile('photo-skew.png');
  const meta = await sharp('photo-skew.png').metadata();
  // transform truth rect corners through the same rotation (about center, then recenter in the grown canvas)
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const rot = (xPct, yPct) => {
    const x = xPct / 100 * W - W / 2, y = yPct / 100 * H - H / 2;
    const nx = x * cos - y * sin + meta.width / 2, ny = x * sin + y * cos + meta.height / 2;
    return [nx / meta.width * 100, ny / meta.height * 100];
  };
  const t = {};
  for (const [k, r] of Object.entries(truth['form-photo.png'])) {
    const corners = [rot(r.x0, r.yTop), rot(r.x1, r.yTop), rot(r.x0, r.yBot), rot(r.x1, r.yBot)];
    t[k] = { x0: Math.min(...corners.map(c => c[0])), x1: Math.max(...corners.map(c => c[0])), yTop: Math.min(...corners.map(c => c[1])), yBot: Math.max(...corners.map(c => c[1])) };
  }
  truth['photo-skew.png'] = t;

  const shadow = Buffer.from(`<svg width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="black" stop-opacity="0.35"/><stop offset="45%" stop-color="black" stop-opacity="0.05"/><stop offset="100%" stop-color="black" stop-opacity="0.35"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`);
  await sharp(src).composite([{ input: shadow }]).modulate({ brightness: 0.9 }).jpeg({ quality: 78 }).toFile('photo-shadow.jpg');
  truth['photo-shadow.jpg'] = truth['form-photo.png'];

  await sharp(src).resize({ width: 700 }).jpeg({ quality: 70 }).toFile('photo-lowres.jpg');
  truth['photo-lowres.jpg'] = truth['form-photo.png'];

  // 3-page "scanned" PDF from the photo
  const pdf = await PDFDocument.create();
  const png = await pdf.embedPng(src);
  for (let p = 0; p < 3; p++) {
    const pg = pdf.addPage([612, 792]);
    pg.drawImage(png, { x: 0, y: 0, width: 612, height: 792 });
  }
  fs.writeFileSync('scanned-3page.pdf', await pdf.save());
  const t3 = {};
  for (const [k, r] of Object.entries(truth['form-photo.png'])) {
    for (let p = 1; p <= 3; p++) t3[`p${p} ${k}`] = { ...r, page: p };
  }
  truth['scanned-3page.pdf'] = t3;
}

// ---- comb-field form ----
{
  const W = 612, H = 792;
  const pct = (x, y, w, h) => ({ x0: x / W * 100, x1: (x + w) / W * 100, yTop: (H - y - h) / H * 100, yBot: (H - y) / H * 100 });
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText('Benefits Enrollment', { x: 220, y: 745, size: 18, font: bold });
  const t = {};
  page.drawText('Applicant Name:', { x: 50, y: 690, size: 12, font });
  page.drawText('_'.repeat(40), { x: 150, y: 690, size: 12, font });
  t['Applicant Name'] = pct(150, 688, 260, 16);
  // comb SSN: 9 boxes
  page.drawText('Social Security Number:', { x: 50, y: 640, size: 12, font });
  let cx = 195;
  for (let i = 0; i < 9; i++) {
    page.drawRectangle({ x: cx, y: 630, width: 22, height: 26, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 });
    cx += 26;
  }
  t['Social Security Number'] = pct(195, 630, 9 * 26, 26);
  page.drawText('Date of Birth:', { x: 50, y: 580, size: 12, font });
  cx = 145;
  for (let i = 0; i < 8; i++) {
    page.drawRectangle({ x: cx, y: 570, width: 22, height: 26, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 });
    cx += 26;
  }
  t['Date of Birth'] = pct(145, 570, 8 * 26, 26);
  page.drawText('Signature:', { x: 50, y: 150, size: 12, font });
  page.drawText('_'.repeat(30), { x: 120, y: 150, size: 12, font });
  t['Signature'] = pct(120, 145, 210, 20);
  fs.writeFileSync('comb-form.pdf', await doc.save());
  truth['comb-form.pdf'] = t;
}

// ---- lease template (2 pages, prose + inline blanks + signature block) ----
{
  const W = 612, H = 792;
  const pct = (x, y, w, h) => ({ x0: x / W * 100, x1: (x + w) / W * 100, yTop: (H - y - h) / H * 100, yBot: (H - y) / H * 100 });
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const p1 = doc.addPage([W, H]);
  const t = {};
  p1.drawText('RESIDENTIAL LEASE AGREEMENT', { x: 160, y: 740, size: 16, font: bold });
  p1.drawText('This Lease Agreement is entered into on', { x: 50, y: 700, size: 11, font });
  p1.drawText('_'.repeat(18), { x: 233, y: 700, size: 11, font });
  t['Lease Date'] = { ...pct(233, 698, 95, 14), page: 1 };
  p1.drawText('between the Landlord,', { x: 335, y: 700, size: 11, font });
  p1.drawText('_'.repeat(30), { x: 50, y: 680, size: 11, font });
  t['Landlord Name'] = { ...pct(50, 678, 158, 14), page: 1 };
  p1.drawText(', and the Tenant,', { x: 210, y: 680, size: 11, font });
  p1.drawText('_'.repeat(30), { x: 292, y: 680, size: 11, font });
  t['Tenant Name'] = { ...pct(292, 678, 158, 14), page: 1 };
  p1.drawText('1. PREMISES. The Landlord leases to the Tenant the property located at:', { x: 50, y: 640, size: 11, font });
  p1.drawText('_'.repeat(70), { x: 50, y: 620, size: 11, font });
  t['Property Address'] = { ...pct(50, 618, 368, 14), page: 1 };
  p1.drawText('2. TERM. The lease term begins on', { x: 50, y: 580, size: 11, font });
  p1.drawText('_'.repeat(16), { x: 213, y: 580, size: 11, font });
  t['Start Date'] = { ...pct(213, 578, 84, 14), page: 1 };
  p1.drawText('and ends on', { x: 302, y: 580, size: 11, font });
  p1.drawText('_'.repeat(16), { x: 360, y: 580, size: 11, font });
  t['End Date'] = { ...pct(360, 578, 84, 14), page: 1 };
  p1.drawText('3. RENT. Tenant shall pay monthly rent of $', { x: 50, y: 540, size: 11, font });
  p1.drawText('_'.repeat(12), { x: 253, y: 540, size: 11, font });
  t['Monthly Rent'] = { ...pct(253, 538, 63, 14), page: 1 };
  p1.drawText('due on the first day of each month.', { x: 320, y: 540, size: 11, font });
  const prose = 'The Tenant agrees to maintain the premises in good condition, to not disturb neighbors, and to comply with all applicable laws and regulations. The Landlord shall be responsible for structural repairs and shall provide 24 hours notice before entering the premises except in emergencies.';
  let y = 500; const words = prose.split(' '); let line = '';
  for (const w of words) {
    if (font.widthOfTextAtSize(line + ' ' + w, 11) > 500) { p1.drawText(line, { x: 50, y, size: 11, font }); y -= 16; line = w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) p1.drawText(line, { x: 50, y, size: 11, font });
  const p2 = doc.addPage([W, H]);
  p2.drawText('IN WITNESS WHEREOF, the parties have executed this Agreement.', { x: 50, y: 700, size: 11, font });
  p2.drawText('Landlord Signature:', { x: 50, y: 640, size: 11, font });
  p2.drawText('_'.repeat(28), { x: 145, y: 640, size: 11, font });
  t['Landlord Signature'] = { ...pct(145, 635, 148, 18), page: 2 };
  p2.drawText('Date:', { x: 320, y: 640, size: 11, font });
  p2.drawText('_'.repeat(14), { x: 348, y: 640, size: 11, font });
  t['Landlord Sign Date'] = { ...pct(348, 638, 74, 14), page: 2 };
  p2.drawText('Tenant Signature:', { x: 50, y: 590, size: 11, font });
  p2.drawText('_'.repeat(28), { x: 137, y: 590, size: 11, font });
  t['Tenant Signature'] = { ...pct(137, 585, 148, 18), page: 2 };
  p2.drawText('Date:', { x: 320, y: 590, size: 11, font });
  p2.drawText('_'.repeat(14), { x: 348, y: 590, size: 11, font });
  t['Tenant Sign Date'] = { ...pct(348, 588, 74, 14), page: 2 };
  fs.writeFileSync('lease.pdf', await doc.save());
  truth['lease.pdf'] = t;
}

fs.writeFileSync('positioning-truth.json', JSON.stringify(truth, null, 1));
console.log('round-3 fixtures ready:', Object.keys(truth));
