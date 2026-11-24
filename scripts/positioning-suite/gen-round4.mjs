/* Round-4 fixtures: handwriting photo, dropdown/radio AcroForm, glyph checkboxes,
   landscape form. Truth appended to positioning-truth.json. */
import { createRequire } from 'module';
import fs from 'fs';
const require_ = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require_('pdf-lib');
const sharp = (await import('sharp')).default;

const truth = JSON.parse(fs.readFileSync('positioning-truth.json', 'utf8'));

// ---- A. handwriting-photo.png (form-photo layout + handwritten answers) ----
{
  // Same geometry as form-photo.png (1275x1650): labels with ruled blanks; add
  // handwriting-style answers (italic, ink blue, slight tilt) inside the slots.
  const hand = (t, x, y, s = 34, rot = -2) =>
    `<text x="${x}" y="${y}" font-family="cursive, 'Comic Sans MS', serif" font-style="italic" font-size="${s}" fill="#1a2a6e" transform="rotate(${rot} ${x} ${y})">${t}</text>`;
  const svg = `<svg width="1275" height="1650" xmlns="http://www.w3.org/2000/svg">
  <rect width="1275" height="1650" fill="#f8f6f2"/>
  <text x="330" y="160" font-family="Arial" font-size="52" font-weight="bold" fill="#111">Volunteer Application</text>
  <text x="90" y="305" font-family="Arial" font-size="36" fill="#111">Full Name:</text>
  <line x1="280" y1="315" x2="900" y2="315" stroke="#333" stroke-width="3"/>
  ${hand('Tran Thi Mai', 320, 305, 38)}
  <text x="90" y="425" font-family="Arial" font-size="36" fill="#111">Email Address:</text>
  <line x1="330" y1="435" x2="900" y2="435" stroke="#333" stroke-width="3"/>
  ${hand('mai.tran88@example.com', 360, 426, 34, -1)}
  <text x="90" y="545" font-family="Arial" font-size="36" fill="#111">Phone Number:</text>
  <line x1="330" y1="555" x2="900" y2="555" stroke="#333" stroke-width="3"/>
  ${hand('(408) 555-2317', 370, 546, 36, 1)}
  <text x="90" y="665" font-family="Arial" font-size="36" fill="#111">Date of Birth:</text>
  <line x1="310" y1="675" x2="700" y2="675" stroke="#333" stroke-width="3"/>
  ${hand('03/12/1988', 350, 666, 36, -2)}
  <text x="90" y="900" font-family="Arial" font-size="34" fill="#111">Tell us why you want to volunteer with our organization:</text>
  ${hand('I want to help my community and', 120, 960, 33, -1)}
  ${hand('practice my English skills.', 120, 1015, 33, -1)}
  <text x="90" y="1405" font-family="Arial" font-size="36" fill="#111">Signature:</text>
  <line x1="270" y1="1415" x2="800" y2="1415" stroke="#333" stroke-width="3"/>
  ${hand('Tran T. Mai', 330, 1402, 44, -4)}
  <text x="850" y="1405" font-family="Arial" font-size="36" fill="#111">Date:</text>
  <line x1="940" y1="1415" x2="1180" y2="1415" stroke="#333" stroke-width="3"/>
  ${hand('07/30/26', 960, 1403, 34, 2)}
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile('handwriting-photo.png');
  const px = (x, y, w, h) => ({ x0: x / 12.75, x1: (x + w) / 12.75, yTop: y / 16.5, yBot: (y + h) / 16.5 });
  truth['handwriting-photo.png'] = {
    'Full Name': px(280, 270, 620, 45),
    'Email Address': px(330, 390, 570, 45),
    'Phone Number': px(330, 510, 570, 45),
    'Date of Birth': px(310, 630, 390, 45),
    'Signature': px(270, 1370, 530, 45),
    'Date': px(940, 1370, 240, 45),
  };
}

const W = 612, H = 792;
const pct = (x, y, w, h) => ({
  x0: (x / W) * 100, x1: ((x + w) / W) * 100,
  yTop: ((H - y - h) / H) * 100, yBot: ((H - y) / H) * 100,
});

// ---- B. acroform2-form.pdf (dropdown + radio group + checkboxes) ----
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const draw = (t, x, y, f = font, s = 12) => page.drawText(t, { x, y, size: s, font: f, color: rgb(0, 0, 0) });
  draw('Membership Enrollment', 200, 740, bold, 20);
  const form = doc.getForm();
  const t = {};

  draw('Member Name:', 50, 700);
  const nameF = form.createTextField('member_name');
  nameF.addToPage(page, { x: 160, y: 694, width: 300, height: 22 });
  t['member_name'] = pct(160, 694, 300, 22);

  draw('State:', 50, 660);
  const dd = form.createDropdown('state_select');
  dd.setOptions(['California', 'Texas', 'Washington', 'Florida']);
  dd.addToPage(page, { x: 160, y: 654, width: 140, height: 22 });
  t['state_select'] = pct(160, 654, 140, 22);

  draw('Membership Type:', 50, 610);
  const radio = form.createRadioGroup('membership_type');
  const opts = [['Individual', 180], ['Family', 300], ['Student', 420]];
  for (const [label, x] of opts) {
    radio.addOptionToPage(label, page, { x, y: 604, width: 16, height: 16 });
    draw(label, x + 22, 608);
    t[`membership_type_${label}`] = pct(x, 604, 16, 16);
  }

  draw('Send me updates by:', 50, 560);
  const cbE = form.createCheckBox('contact_email');
  cbE.addToPage(page, { x: 200, y: 554, width: 16, height: 16 });
  draw('Email', 222, 558);
  t['contact_email'] = pct(200, 554, 16, 16);
  const cbP = form.createCheckBox('contact_phone');
  cbP.addToPage(page, { x: 300, y: 554, width: 16, height: 16 });
  draw('Phone', 322, 558);
  t['contact_phone'] = pct(300, 554, 16, 16);

  fs.writeFileSync('acroform2-form.pdf', await doc.save());
  truth['acroform2-form.pdf'] = t;
}

// ---- C. checkbox-glyph-form.pdf (text-layer checkboxes: brackets + drawn rects) ----
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const draw = (t, x, y, f = font, s = 12) => page.drawText(t, { x, y, size: s, font: f, color: rgb(0, 0, 0) });
  draw('Patient Intake', 240, 740, bold, 20);
  const t = {};

  draw('Patient Name:', 50, 700);
  const lw = font.widthOfTextAtSize('Patient Name:', 12);
  draw('_'.repeat(40), 50 + lw + 8, 700);
  t['Patient Name'] = pct(50 + lw + 8, 698, 280, 16);

  // Bracket checkboxes IN the text layer
  draw('Marital Status:', 50, 650);
  const items = [['Single', 180], ['Married', 300], ['Divorced', 430]];
  for (const [label, x] of items) {
    draw('[  ]', x, 650);
    draw(label, x + 28, 650);
    t[`marital_${label}`] = pct(x - 4, 644, 30, 20);
  }

  // Drawn-rectangle checkboxes (graphics only; labels in text layer)
  draw('Preferred Contact:', 50, 600);
  const rects = [['Email', 200], ['Phone', 320], ['Text Message', 440]];
  for (const [label, x] of rects) {
    page.drawRectangle({ x, y: 594, width: 14, height: 14, borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
    draw(label, x + 20, 598);
    t[`contact_${label.replace(' ', '')}`] = pct(x - 4, 590, 24, 22);
  }

  fs.writeFileSync('checkbox-glyph-form.pdf', await doc.save());
  truth['checkbox-glyph-form.pdf'] = t;
}

// ---- D. landscape-form.pdf (792x612) ----
{
  const LW = 792, LH = 612;
  const lpct = (x, y, w, h) => ({
    x0: (x / LW) * 100, x1: ((x + w) / LW) * 100,
    yTop: ((LH - y - h) / LH) * 100, yBot: ((LH - y) / LH) * 100,
  });
  const doc = await PDFDocument.create();
  const page = doc.addPage([LW, LH]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const draw = (t, x, y, f = font, s = 12) => page.drawText(t, { x, y, size: s, font: f, color: rgb(0, 0, 0) });
  draw('Equipment Checkout Log (Landscape)', 250, 560, bold, 18);
  const t = {};
  const rows = [['Borrower Name:', 500], ['Equipment Description:', 460], ['Checkout Date:', 420]];
  for (const [label, y] of rows) {
    draw(label, 60, y);
    const lw2 = font.widthOfTextAtSize(label, 12);
    const usX = 60 + lw2 + 8;
    draw('_'.repeat(Math.floor((500 - usX) / font.widthOfTextAtSize('_', 12))), usX, y);
    t[label.replace(':', '')] = lpct(usX, y - 2, 500 - usX, 16);
  }
  draw('Supervisor Signature:', 60, 120);
  const sw = font.widthOfTextAtSize('Supervisor Signature:', 12);
  draw('_'.repeat(30), 60 + sw + 8, 120);
  t['Supervisor Signature'] = lpct(60 + sw + 8, 115, 210, 20);
  draw('Return Date:', 480, 120);
  const rw = font.widthOfTextAtSize('Return Date:', 12);
  draw('_'.repeat(16), 480 + rw + 8, 120);
  t['Return Date'] = lpct(480 + rw + 8, 118, 120, 16);
  fs.writeFileSync('landscape-form.pdf', await doc.save());
  truth['landscape-form.pdf'] = t;
}

fs.writeFileSync('positioning-truth.json', JSON.stringify(truth, null, 1));
console.log('round-4 fixtures ready:', Object.keys(truth));
