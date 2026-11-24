/* Clean "photographed form" fixture (1275x1650) used as the base for the
   degraded variants in gen-round3/gen-round5. Run before gen-round3.mjs. */
const sharp = (await import('sharp')).default;

const svg = `<svg width="1275" height="1650" xmlns="http://www.w3.org/2000/svg">
  <rect width="1275" height="1650" fill="#f8f6f2"/>
  <text x="330" y="160" font-family="Arial" font-size="52" font-weight="bold" fill="#111">Volunteer Application</text>
  <text x="90" y="305" font-family="Arial" font-size="36" fill="#111">Full Name:</text>
  <line x1="280" y1="315" x2="900" y2="315" stroke="#333" stroke-width="3"/>
  <text x="90" y="425" font-family="Arial" font-size="36" fill="#111">Email Address:</text>
  <line x1="330" y1="435" x2="900" y2="435" stroke="#333" stroke-width="3"/>
  <text x="90" y="545" font-family="Arial" font-size="36" fill="#111">Phone Number:</text>
  <line x1="330" y1="555" x2="900" y2="555" stroke="#333" stroke-width="3"/>
  <text x="90" y="665" font-family="Arial" font-size="36" fill="#111">Date of Birth:</text>
  <line x1="310" y1="675" x2="700" y2="675" stroke="#333" stroke-width="3"/>
  <text x="90" y="900" font-family="Arial" font-size="34" fill="#111">Tell us why you want to volunteer with our organization:</text>
  <text x="90" y="1405" font-family="Arial" font-size="36" fill="#111">Signature:</text>
  <line x1="270" y1="1415" x2="800" y2="1415" stroke="#333" stroke-width="3"/>
  <text x="850" y="1405" font-family="Arial" font-size="36" fill="#111">Date:</text>
  <line x1="940" y1="1415" x2="1180" y2="1415" stroke="#333" stroke-width="3"/>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile('form-photo.png');
console.log('form-photo.png written');
