"""Packs the Run Your Own RMN walkthrough's screenshots and voiceover into the repo as base64 text, so a build session can carry them.

    python3 pack_assets.py --src <dir with img/*.jpg and vo/*.mp3> [--out ../../tour-assets/rmn-golf]

Writes <out>/<dir>/<file>.b64 (base64, 76-character lines) for every img/*.jpg and vo/*.mp3, removes .b64 files that no longer have a
source, and writes <out>/SHA256SUMS: the sha256 of every DECODED file (`<sha>  <dir>/<file>`, sorted). tour.php serves only the files in
that list (allowlist.py copies it into TOUR_ASSETS_RMN). Check a checkout with: python3 pack_assets.py --verify."""
import argparse, base64, hashlib, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--src')
ap.add_argument('--out', default=os.path.join(HERE, '..', '..', 'tour-assets', 'rmn-golf'))
ap.add_argument('--verify', action='store_true', help='decode every .b64 in --out and check it against SHA256SUMS')
args = ap.parse_args()

def sums_path(): return os.path.join(args.out, 'SHA256SUMS')

if args.verify:
    want = {}
    for line in open(sums_path(), encoding='utf-8'):
        sha, name = line.split()
        want[name] = sha
    bad = []
    for name, sha in want.items():
        raw = base64.b64decode(open(os.path.join(args.out, name + '.b64'), encoding='ascii').read(), validate=False)
        if hashlib.sha256(raw).hexdigest() != sha: bad.append(name)
    have = {os.path.join(d, f)[:-4] for d in ('img', 'vo') if os.path.isdir(os.path.join(args.out, d)) for f in os.listdir(os.path.join(args.out, d)) if f.endswith('.b64')}
    extra = sorted(have - set(want))
    print(f'{len(want)} files, {len(bad)} mismatched, {len(extra)} not in SHA256SUMS')
    sys.exit(1 if bad or extra else 0)

if not args.src: sys.exit('--src is required')
lines, keep = [], set()
for d, ext in (('img', '.jpg'), ('vo', '.mp3')):
    os.makedirs(os.path.join(args.out, d), exist_ok=True)
    for f in sorted(os.listdir(os.path.join(args.src, d))):
        if not f.endswith(ext): continue
        raw = open(os.path.join(args.src, d, f), 'rb').read()
        b = base64.b64encode(raw).decode('ascii')
        open(os.path.join(args.out, d, f + '.b64'), 'w', encoding='ascii').write('\n'.join(b[i:i + 76] for i in range(0, len(b), 76)) + '\n')
        lines.append(f'{hashlib.sha256(raw).hexdigest()}  {d}/{f}')
        keep.add(f'{d}/{f}.b64')
    for f in os.listdir(os.path.join(args.out, d)):
        if f.endswith('.b64') and f'{d}/{f}' not in keep: os.remove(os.path.join(args.out, d, f))
open(sums_path(), 'w', encoding='utf-8').write('\n'.join(sorted(lines, key=lambda l: l.split()[1])) + '\n')
print(len(lines), 'files packed')
