#!/usr/bin/env python3
"""Score detected field positions against ground truth.

Inputs (same directory):
  positioning-truth.json   { file: { truthKey: {x0,x1,yTop,yBot,page?} } }
  detected-fields.json     { file: [ {field_name, field_type, position} ] }

Matching:
  - Files whose truth keys look like "w<N>_<name>" (widget-rect truth for real
    AcroForm docs whose field names differ from AI labels) are scored by
    rect-nearest greedy matching: hit when the detected box center is within
    WIDGET_TOL of the widget center.
  - Everything else matches by name in two passes — exact containment first,
    then token overlap — so "Landlord Name" can't steal "Landlord Signature".
    Hit = detected box CENTER inside the truth rect expanded by the margins.

Vision-path files (photos/scans) get relaxed margins.
"""
import json
import re
import sys

WIDGET_TOL = 1.5
VISION = re.compile(r'\.(png|jpe?g)$|scanned', re.I)


def norm(s):
    return re.sub(r'[^a-z0-9]', '', str(s).lower())


def center(p):
    return (p['x'] + p.get('width', 15) / 2, p['y'] + p.get('height', 3) / 2)


def score_widgets(fname, tmap, dets):
    pairs = []
    for tk, r in tmap.items():
        tc = ((r['x0'] + r['x1']) / 2, (r['yTop'] + r['yBot']) / 2)
        tpage = r.get('page', 1)
        for i, d in enumerate(dets):
            p = d.get('position')
            if not p or p.get('page', 1) != tpage:
                continue
            c = center(p)
            pairs.append((abs(c[0] - tc[0]) + abs(c[1] - tc[1]), tk, i))
    pairs.sort()
    usedT, usedD = set(), set()
    hits = 0
    for dist, tk, i in pairs:
        if tk in usedT or i in usedD:
            continue
        usedT.add(tk)
        usedD.add(i)
        if dist <= WIDGET_TOL:
            hits += 1
        else:
            print(f"  MISS {tk[:50]:50s} nearest center-dist {dist:.1f}%")
    for tk in tmap:
        if tk not in usedT:
            print(f"  MISS(unmatched) {tk[:60]}")
    print(f"  --> {hits}/{len(tmap)} widget-exact (center within {WIDGET_TOL}%)")
    return hits, len(tmap)


def score_names(fname, tmap, dets, MX, MY):
    used = set()
    match = {}
    for strict in (True, False):
        for tkey, rect in tmap.items():
            if tkey in match:
                continue
            base = re.sub(r'^p\d+ | row$', '', tkey)
            tn = norm(base)
            twords = set(re.findall(r'[a-z]+', base.lower()))
            tpage = rect.get('page', 1)
            for i, d in enumerate(dets):
                if i in used or not d.get('position'):
                    continue
                if d['position'].get('page', 1) != tpage:
                    continue
                dn = norm(d['field_name'])
                dwords = set(re.findall(r'[a-z]+', d['field_name'].lower()))
                ok = (tn in dn or dn in tn) if strict else \
                    len(twords & dwords) >= max(1, len(twords) - 1)
                if ok:
                    match[tkey] = (i, d)
                    used.add(i)
                    break
    nhit = 0
    for tkey, rect in tmap.items():
        best = match.get(tkey)
        if not best:
            print(f"  MISS(name) {tkey}")
            continue
        p = best[1]['position']
        cx, cy = center(p)
        ok = (rect['x0'] - MX) <= cx <= (rect['x1'] + MX) and \
             (rect['yTop'] - MY) <= cy <= (rect['yBot'] + MY)
        nhit += ok
        mark = 'HIT ' if ok else 'MISS'
        print(f"  {mark} {tkey:26s} det=({cx:5.1f},{cy:5.1f}) "
              f"truth x[{rect['x0']:.0f}-{rect['x1']:.0f}] y[{rect['yTop']:.1f}-{rect['yBot']:.1f}] "
              f"src={p.get('source')} as '{best[1]['field_name']}'")
    print(f"  --> {nhit}/{len(tmap)}")
    return nhit, len(tmap)


def main():
    truth = json.load(open('positioning-truth.json'))
    fields = json.load(open('detected-fields.json'))
    overall = []
    only = sys.argv[1:]
    for fname, tmap in truth.items():
        if only and fname not in only:
            continue
        dets = fields.get(fname)
        if dets is None or not tmap:
            continue
        print(f"\n=== {fname} ({len(dets)} detected / {len(tmap)} truth) ===")
        if all(re.match(r'w\d+_', k) for k in tmap):
            h, t = score_widgets(fname, tmap, dets)
        elif VISION.search(fname):
            h, t = score_names(fname, tmap, dets, 4.0, 3.0)
        else:
            h, t = score_names(fname, tmap, dets, 3.0, 1.8)
        overall.append((fname, h, t))

    print("\n===== SUMMARY =====")
    th = sum(h for _, h, _ in overall)
    tt = sum(t for _, _, t in overall)
    for fname, h, t in overall:
        print(f"  {fname:28s} {h}/{t}")
    if tt:
        print(f"  TOTAL {th}/{tt} = {th / tt * 100:.0f}%")


if __name__ == '__main__':
    main()
