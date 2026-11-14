"""Writes TOUR_ASSETS_RMN in snippets/ph-industry-enhancements/tour.php from tour-assets/rmn-golf/SHA256SUMS (sha256 and size of each decoded file).

    python3 allowlist.py [--check]"""
import argparse, base64, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
ap = argparse.ArgumentParser(); ap.add_argument('--check', action='store_true'); args = ap.parse_args()
assets = os.path.join(ROOT, 'tour-assets', 'rmn-golf')
rows = []
for line in open(os.path.join(assets, 'SHA256SUMS'), encoding='utf-8'):
    sha, name = line.split()
    size = len(base64.b64decode(open(os.path.join(assets, name + '.b64'), encoding='ascii').read()))
    rows.append(f"\t'{name}' => array( '{sha}', {size} ),")
php_path = os.path.join(ROOT, 'snippets', 'ph-industry-enhancements', 'tour.php')
php = open(php_path, encoding='utf-8').read()
block = "const TOUR_ASSETS_RMN = array(\n" + "\n".join(rows) + "\n);\n"
new, n = re.subn(r"const TOUR_ASSETS_RMN = array\(\n.*?\n?\);\n(?=// rmn-golf allow-list: end)", lambda m: block, php, count=1, flags=re.S)
assert n == 1, 'TOUR_ASSETS_RMN block not found'
if args.check:
    print('allow-list is current' if new == php else 'allow-list is stale'); sys.exit(0 if new == php else 1)
open(php_path, 'w', encoding='utf-8').write(new)
print(len(rows), 'entries')
