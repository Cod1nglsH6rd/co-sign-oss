/**
 * Deep analysis of PDF content - raw dump
 */

const { PDFDocument } = require('pdf-lib');
const fs = require('fs');

async function analyzePdf(pdfPath) {
  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  
  console.log('=== PDF Raw Content Analysis ===\n');
  
  const pages = pdfDoc.getPages();

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const { width, height } = page.getSize();
    console.log(`\n=== Page ${pageIdx + 1}: ${width}x${height} ===`);

    // Get raw content
    try {
      const contents = page.node.Contents();
      if (contents) {
        const contentArray = Array.isArray(contents) ? contents : [contents];
        
        let allContent = '';
        for (const stream of contentArray) {
          try {
            // Try to decode - might be compressed
            const decoded = stream.getString();
            allContent += decoded + '\n';
          } catch (e) {
            // Try raw bytes
            try {
              const { decode } = require('zlib');
              const bytes = stream.readBytes();
              const decompressed = decode(bytes);
              allContent += decompressed.toString('utf8') + '\n';
            } catch (e2) {
              console.log('Could not decode stream:', e2.message);
            }
          }
        }
        
        console.log('\n--- Raw content (first 3000 chars) ---');
        console.log(allContent.substring(0, 3000));
        
        // Check if compressed
        console.log('\n--- Analysis ---');
        console.log('Content length:', allContent.length);
        console.log('Has re (rect):', allContent.includes('re'));
        console.log('Has Tf (font):', allContent.includes('Tf'));
        console.log('Has Tj (text):', allContent.includes('Tj'));
        console.log('Has BT/ET (begin/end text):', allContent.includes('BT') && allContent.includes('ET'));
        
      }
    } catch (e) {
      console.log('Error:', e.message);
    }
  }
}

const USAGE = 'Usage: node scripts/check-pdf-fields.js <file.pdf>';

// Run directly: a path is required (no default; the old one pointed at one person's laptop).
function main(argv) {
  const pdfPath = (argv[2] || '').trim();
  if (!pdfPath) {
    console.error(USAGE);
    return 1;
  }
  analyzePdf(pdfPath).catch(console.error);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = { main, USAGE };
