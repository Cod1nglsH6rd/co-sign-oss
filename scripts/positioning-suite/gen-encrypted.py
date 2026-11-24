#!/usr/bin/env python3
"""Encrypted-PDF fixtures (scenario 1.9). Requires: pip install pypdf.

encrypted-user.pdf  — user password required to open; the pipeline must FAIL
                      with the encrypted_pdf error, never complete empty.
encrypted-owner.pdf — owner password only (opens without a password); the
                      pipeline must process it normally (score vs the
                      underscore-form truth).
"""
import json

from pypdf import PdfReader, PdfWriter

for src, out, user_pw, owner_pw in [
    ('underscore-form.pdf', 'encrypted-user.pdf', 'test123', 'test123'),
    ('underscore-form.pdf', 'encrypted-owner.pdf', '', 'ownersecret'),
]:
    r = PdfReader(src)
    w = PdfWriter()
    for p in r.pages:
        w.add_page(p)
    w.encrypt(user_password=user_pw, owner_password=owner_pw, algorithm='AES-128')
    with open(out, 'wb') as f:
        w.write(f)
    print('wrote', out)

# The owner-only file opens without a password and must score like its source.
truth = json.load(open('positioning-truth.json'))
truth['encrypted-owner.pdf'] = truth['underscore-form.pdf']
json.dump(truth, open('positioning-truth.json', 'w'), indent=1)
print('truth: encrypted-owner.pdf -> underscore-form.pdf slots')
