/* Generate ground-truth positioning test PDFs (612x792) + expected boxes (% coords, y from top). */
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');

const W = 612, H = 792;
const pct = (x, y, w, h) => ({
  x0: (x / W) * 100, x1: ((x + w) / W) * 100,
  yTop: ((H - y - h) / H) * 100, yBot: ((H - y) / H) * 100,
});

(async () => {
  const truth = {};

  // ---------- A. underscore-form.pdf ----------
  {
    const doc = await PDFDocument.create();
    const page = doc.addPage([W, H]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const draw = (t, x, y, f = font, s = 12) => page.drawText(t, { x, y, size: s, font: f, color: rgb(0, 0, 0) });
    draw('Volunteer Application', 200, 740, bold, 20);
    const rows = [
      ['Full Name:', 700], ['Email Address:', 660], ['Phone Number:', 620], ['Date of Birth:', 580],
    ];
    const t = {};
    for (const [label, y] of rows) {
      draw(label, 50, y);
      const lw = font.widthOfTextAtSize(label, 12);
      const usX = 50 + lw + 8;
      const usLen = Math.floor((400 - usX) / font.widthOfTextAtSize('_', 12));
      draw('_'.repeat(usLen), usX, y);
      t[label.replace(':', '')] = pct(usX, y - 2, 400 - usX, 16);
    }
    // two-column row
    draw('City:', 50, 540);
    draw('_'.repeat(24), 50 + font.widthOfTextAtSize('City:', 12) + 6, 540);
    t['City'] = pct(50 + font.widthOfTextAtSize('City:', 12) + 6, 538, 160, 16);
    draw('State:', 330, 540);
    draw('_'.repeat(20), 330 + font.widthOfTextAtSize('State:', 12) + 6, 540);
    t['State'] = pct(330 + font.widthOfTextAtSize('State:', 12) + 6, 538, 140, 16);
    // free paragraph + signature block
    draw('Tell us why you want to volunteer with our organization below.', 50, 480, font, 11);
    draw('Signature:', 50, 150);
    draw('_'.repeat(30), 50 + font.widthOfTextAtSize('Signature:', 12) + 6, 150);
    t['Signature'] = pct(50 + font.widthOfTextAtSize('Signature:', 12) + 6, 145, 210, 20);
    draw('Date:', 380, 150);
    draw('_'.repeat(15), 380 + font.widthOfTextAtSize('Date:', 12) + 6, 150);
    t['Date'] = pct(380 + font.widthOfTextAtSize('Date:', 12) + 6, 148, 110, 16);
    fs.writeFileSync('underscore-form.pdf', await doc.save());
    truth['underscore-form.pdf'] = t;
  }

  // ---------- B. labelvalue-form.pdf (filled invoice style) ----------
  {
    const doc = await PDFDocument.create();
    const page = doc.addPage([W, H]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const draw = (t, x, y, f = font, s = 11) => page.drawText(t, { x, y, size: s, font: f, color: rgb(0, 0, 0) });
    draw('SERVICE STATEMENT', 220, 740, bold, 18);
    const t = {};
    const pairs = [
      ['STATEMENT #', 'ST-2077-0415', 690],
      ['ISSUE DATE', '03/15/2077', 668],
      ['ACCOUNT ID', 'AC-99881-X', 646],
    ];
    for (const [label, value, y] of pairs) {
      draw(label, 320, y, bold, 10);
      const vw = font.widthOfTextAtSize(value, 11);
      draw(value, 540 - vw, y);
      t[label] = pct(540 - vw, y - 2, vw, 15);
    }
    draw('CUSTOMER', 50, 690, bold, 10);
    draw('Nguyen Van Minh', 50, 672);
    t['CUSTOMER'] = pct(50, 670, font.widthOfTextAtSize('Nguyen Van Minh', 11), 15);
    draw('Total amount due: $245.00 by 04/01/2077. Thank you for your business.', 50, 560, font, 11);
    fs.writeFileSync('labelvalue-form.pdf', await doc.save());
    truth['labelvalue-form.pdf'] = t;
  }

  // ---------- fw2.pdf AcroForm ground truth (widget rects) ----------
  // Optional: drop a real fw2.pdf next to this script to include it.
  if (fs.existsSync('fw2.pdf')) {
    const bytes = fs.readFileSync('fw2.pdf');
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const page = doc.getPages()[0];
    const { width: pw, height: ph } = page.getSize();
    const form = doc.getForm();
    const t = {};
    for (const f of form.getFields()) {
      const widgets = f.acroField.getWidgets();
      if (!widgets.length) continue;
      const r = widgets[0].getRectangle();
      t[f.getName()] = {
        x0: (r.x / pw) * 100, x1: ((r.x + r.width) / pw) * 100,
        yTop: ((ph - r.y - r.height) / ph) * 100, yBot: ((ph - r.y) / ph) * 100,
      };
    }
    truth['fw2.pdf'] = t;
    console.log('fw2 widgets:', Object.keys(t).length, 'page', pw, 'x', ph);
  }

  // ---------- form-photo.png ground truth (from the SVG geometry, 1275x1650) ----------
  {
    const px = (x, y, w, h) => ({ x0: x / 12.75, x1: (x + w) / 12.75, yTop: y / 16.5, yBot: (y + h) / 16.5 });
    truth['form-photo.png'] = {
      'Full Name': px(280, 270, 620, 45),
      'Email Address': px(330, 390, 570, 45),
      'Phone Number': px(330, 510, 570, 45),
      'Date of Birth': px(310, 630, 390, 45),
      'Signature': px(270, 1370, 530, 45),
      'Date': px(940, 1370, 240, 45),
    };
  }

  fs.writeFileSync('positioning-truth.json', JSON.stringify(truth, null, 1));
  console.log('generated', Object.keys(truth));
})();
