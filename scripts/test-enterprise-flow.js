#!/usr/bin/env node

/**
 * End-to-End Test Script for Enterprise Fill Session Flow
 *
 * Tests the complete flow:
 *   1. Client creates a fill session for an existing document
 *   2. Customer loads the session via token
 *   3. Customer fills field values
 *   4. Customer submits signature
 *   5. Customer completes the session
 *   6. Client lists sessions for the document
 *
 * Prerequisites:
 *   - App running at BASE_URL (default: http://localhost:3000)
 *   - Supabase configured with migrations applied
 *   - At least one document with extracted fields in the database
 *
 * Usage:
 *   node scripts/test-enterprise-flow.js [documentId] [userJwt]
 *
 * Or with env vars:
 *   TEST_DOCUMENT_ID=... TEST_USER_JWT=... node scripts/test-enterprise-flow.js
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DOCUMENT_ID = process.argv[2] || process.env.TEST_DOCUMENT_ID;
const USER_JWT = process.argv[3] || process.env.TEST_USER_JWT;

async function request(method, path, body, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);

  console.log(`\n${method} ${path}`);
  const res = await fetch(url, opts);
  const data = await res.json();
  console.log(`  Status: ${res.status}`);
  console.log(`  Response:`, JSON.stringify(data, null, 2).slice(0, 500));

  if (!res.ok) {
    console.error(`  ERROR: ${data.error || 'Unknown error'}`);
  }
  return { status: res.status, data };
}

async function main() {
  console.log('===========================================');
  console.log('  Cô Sign Enterprise Flow — E2E Test');
  console.log('===========================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Document ID: ${DOCUMENT_ID || '(not set)'}`);
  console.log(`User JWT: ${USER_JWT ? '***' + USER_JWT.slice(-8) : '(not set)'}`);

  if (!DOCUMENT_ID || !USER_JWT) {
    console.error('\nMissing required params. Usage:');
    console.error('  node scripts/test-enterprise-flow.js <documentId> <userJwt>');
    console.error('  or set TEST_DOCUMENT_ID and TEST_USER_JWT env vars');
    process.exit(1);
  }

  const authHeaders = { Authorization: `Bearer ${USER_JWT}` };

  // ============ STEP 1: Create Fill Session ============
  console.log('\n\n--- STEP 1: Create Fill Session ---');
  const { status: s1, data: d1 } = await request('POST', '/api/sessions/create', {
    documentId: DOCUMENT_ID,
    recipientEmail: 'test-customer@example.com',
    recipientName: 'Test Customer',
    assignedRole: null,
    fieldFilter: null,
    requireSignature: false,
    expiresInDays: 7,
    sendMethod: 'link',
  }, authHeaders);

  if (s1 !== 201) {
    console.error('FAILED: Could not create session');
    process.exit(1);
  }

  const token = d1.session.token;
  const sessionId = d1.session.id;
  console.log(`  Session ID: ${sessionId}`);
  console.log(`  Token: ${token.slice(0, 8)}...`);
  console.log(`  Share URL: ${d1.session.shareUrl}`);

  // ============ STEP 2: Load Session as Customer ============
  console.log('\n\n--- STEP 2: Load Session (Customer) ---');
  const { status: s2, data: d2 } = await request('GET', `/api/sessions/${token}`);

  if (s2 !== 200) {
    console.error('FAILED: Could not load session');
    process.exit(1);
  }

  console.log(`  Document: ${d2.session.documentName}`);
  console.log(`  Fields: ${d2.fields.length}`);
  console.log(`  Status: ${d2.session.status}`);

  const fieldIds = d2.fields.map(f => f.id);
  const firstFieldId = fieldIds[0];
  const signatureField = d2.fields.find(f => f.fieldType === 'signature');

  // ============ STEP 3: Change Language ============
  console.log('\n\n--- STEP 3: Change Language to Vietnamese ---');
  await request('PUT', `/api/sessions/${token}/language`, { language: 'vi' });

  // ============ STEP 4: Fill Fields ============
  console.log('\n\n--- STEP 4: Fill Fields ---');
  const testValues = {};
  d2.fields.forEach((f, i) => {
    if (f.fieldType === 'signature') return;
    if (f.fieldType === 'checkbox') {
      testValues[f.id] = 'true';
    } else if (f.fieldType === 'email') {
      testValues[f.id] = 'test@example.com';
    } else if (f.fieldType === 'date') {
      testValues[f.id] = '2026-03-11';
    } else if (f.fieldType === 'tel') {
      testValues[f.id] = '555-0123';
    } else {
      testValues[f.id] = `Test Value ${i + 1}`;
    }
  });

  const { status: s4, data: d4 } = await request('PUT', `/api/sessions/${token}/fill`, {
    fieldValues: testValues,
    saveAsDraft: false,
  });

  if (s4 !== 200) {
    console.error('FAILED: Could not fill fields');
    process.exit(1);
  }

  console.log(`  Saved: ${d4.savedCount} fields`);
  console.log(`  Progress: ${d4.fillProgress.filled}/${d4.fillProgress.total}`);

  // ============ STEP 5: Submit Signature (if applicable) ============
  if (signatureField) {
    console.log('\n\n--- STEP 5: Submit Signature ---');
    // Minimal 1x1 PNG as test signature
    const testSignature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await request('POST', `/api/sessions/${token}/sign`, {
      fieldId: signatureField.id,
      signatureDataUrl: testSignature,
    });
  } else {
    console.log('\n\n--- STEP 5: (No signature field, skipping) ---');
  }

  // ============ STEP 6: Complete Session ============
  console.log('\n\n--- STEP 6: Complete Session ---');
  const { status: s6, data: d6 } = await request('POST', `/api/sessions/${token}/complete`, {
    generatePdf: true,
  });

  if (s6 === 200 && d6.success) {
    console.log(`  Status: ${d6.status}`);
    console.log(`  Completed at: ${d6.completedAt}`);
    console.log(`  Filled PDF: ${d6.filledPdfUrl || '(generation may have failed)'}`);
  } else {
    console.warn('  Complete may have failed:', d6.error);
    if (d6.missingFields) {
      console.warn('  Missing fields:', d6.missingFields.map(f => f.fieldName).join(', '));
    }
  }

  // ============ STEP 7: Client Lists Sessions ============
  console.log('\n\n--- STEP 7: Client Lists Sessions ---');
  const { status: s7, data: d7 } = await request('GET', `/api/documents/${DOCUMENT_ID}/sessions`, null, authHeaders);

  if (s7 === 200) {
    console.log(`  Total sessions: ${d7.total}`);
    d7.sessions.forEach(s => {
      console.log(`  - ${s.recipientName || s.recipientEmail}: ${s.status} (${s.fillProgress.filled}/${s.fillProgress.total} filled)`);
    });
  }

  // ============ STEP 8: Verify completed session is read-only ============
  console.log('\n\n--- STEP 8: Verify Completed Session is Read-Only ---');
  const { status: s8 } = await request('PUT', `/api/sessions/${token}/fill`, {
    fieldValues: { [firstFieldId]: 'Should fail' },
  });
  console.log(`  Attempt to fill completed session: ${s8 === 403 ? 'BLOCKED (correct)' : `UNEXPECTED ${s8}`}`);

  // ============ SUMMARY ============
  console.log('\n\n===========================================');
  console.log('  TEST SUMMARY');
  console.log('===========================================');
  console.log(`  Create session:     ${s1 === 201 ? 'PASS' : 'FAIL'}`);
  console.log(`  Load session:       ${s2 === 200 ? 'PASS' : 'FAIL'}`);
  console.log(`  Fill fields:        ${s4 === 200 ? 'PASS' : 'FAIL'}`);
  console.log(`  Complete session:   ${s6 === 200 ? 'PASS' : 'FAIL'}`);
  console.log(`  List sessions:      ${s7 === 200 ? 'PASS' : 'FAIL'}`);
  console.log(`  Read-only check:    ${s8 === 403 ? 'PASS' : 'FAIL'}`);
  console.log('===========================================\n');
}

main().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
