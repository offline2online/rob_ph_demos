"""Copies the golf voiceover manifest into tour.html (the `const CLIPS_GOLF = {...};` line). Run after building the voiceover:
    python3 sync_tour_vo.py --manifest <vo dir>/manifest.json
Then regenerate tour-page.php (tools/build-tour.mjs) and update TOUR_PAGE_SHA256, as for any tour.html change."""
import argparse, json, os, re, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--manifest', default=os.path.join(HERE, 'vo-manifest.json'))
ap.add_argument('--tour', default=os.path.join(HERE, '..', '..', 'snippets', 'ph-industry-enhancements', 'tour', 'tour.html'))
args = ap.parse_args()
man = json.load(open(args.manifest, encoding='utf-8'))
data = {k: [{'file': l['file'], 'text': l['text'], 'duration': l['duration'], 'cue': l.get('cue')} for l in v] for k, v in man.items()}
html = open(args.tour, encoding='utf-8').read()
new, n = re.subn(r'^const CLIPS_GOLF = \{.*?\};$', lambda m: 'const CLIPS_GOLF = ' + json.dumps(data, ensure_ascii=False) + ';', html, count=1, flags=re.S | re.M)
assert n == 1, 'CLIPS_GOLF line not found in tour.html'
open(args.tour, 'w', encoding='utf-8').write(new)
if os.path.abspath(args.manifest) != os.path.abspath(os.path.join(HERE, 'vo-manifest.json')):
    shutil.copy(args.manifest, os.path.join(HERE, 'vo-manifest.json'))   # kept in the repo with the script, for the next build
print('CLIPS_GOLF updated:', sum(len(v) for v in data.values()), 'lines in', len(data), 'steps')
