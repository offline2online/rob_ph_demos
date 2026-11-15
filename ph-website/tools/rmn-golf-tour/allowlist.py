"""Writes the golf allow-list in snippets/ph-industry-enhancements/tour.php from SHA256SUMS (sha256 and size of each decoded file):
v2 (default) TOUR_ASSETS_RMN_V2 from tour-assets/rmn-golf/v2/SHA256SUMS; --version v1 TOUR_ASSETS_RMN from tour-assets/rmn-golf/SHA256SUMS.

    python3 allowlist.py [--version v1|v2] [--check]"""
import argparse, base64, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
ap = argparse.ArgumentParser(); ap.add_argument('--check', action='store_true'); ap.add_argument('--version', default='v2', choices=('v1', 'v2')); args = ap.parse_args()
V2 = args.version == 'v2'
assets = os.path.join(ROOT, 'tour-assets', 'rmn-golf', *(['v2'] if V2 else []))
CONST, MARK = ('TOUR_ASSETS_RMN_V2', 'rmn-golf v2 allow-list') if V2 else ('TOUR_ASSETS_RMN', 'rmn-golf allow-list')
rows = []
for line in open(os.path.join(assets, 'SHA256SUMS'), encoding='utf-8'):
    sha, name = line.split()
    size = len(base64.b64decode(open(os.path.join(assets, name + '.b64'), encoding='ascii').read()))
    rows.append(f"\t'{name}' => array( '{sha}', {size} ),")
php_path = os.path.join(ROOT, 'snippets', 'ph-industry-enhancements', 'tour.php')
php = open(php_path, encoding='utf-8').read()
block = f"const {CONST} = array(\n" + "\n".join(rows) + "\n);\n"
new, n = re.subn(r"const " + CONST + r" = array\(\n.*?\n?\);\n(?=// " + re.escape(MARK) + r": end)", lambda m: block, php, count=1, flags=re.S)
assert n == 1, CONST + ' block not found'
if args.check:
    print('allow-list is current' if new == php else 'allow-list is stale'); sys.exit(0 if new == php else 1)
open(php_path, 'w', encoding='utf-8').write(new)
print(len(rows), 'entries')
