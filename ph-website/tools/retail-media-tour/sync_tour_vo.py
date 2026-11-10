"""Copies the voiceover manifest into tour.html (the `const CLIPS = {...}` line of the retail media voiceover module).

Run after build_voiceover.py whenever a line changes:
    python3 sync_tour_vo.py [--manifest ../../tour-assets/retail-media/vo/manifest.json] [--tour ../../snippets/ph-industry-enhancements/tour/tour.html]
Then regenerate tour-page.php (tools/build-tour.mjs) and update TOUR_PAGE_SHA256, as for any tour.html change."""
import argparse, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--manifest', default=os.path.join(HERE, '..', '..', 'tour-assets', 'retail-media', 'vo', 'manifest.json'))
ap.add_argument('--tour', default=os.path.join(HERE, '..', '..', 'snippets', 'ph-industry-enhancements', 'tour', 'tour.html'))
args = ap.parse_args()

man = json.load(open(args.manifest, encoding='utf-8'))
data = {k: [{'file': l['file'], 'text': l['text'], 'duration': l['duration'], 'cue': l.get('cue')} for l in v] for k, v in man.items()}
html = open(args.tour, encoding='utf-8').read()
new, n = re.subn(r'(  const CLIPS = )\{.*?\}(, BASE = window\.PH_TOUR_VO)', lambda m: m.group(1) + json.dumps(data, ensure_ascii=False) + m.group(2), html, count=1, flags=re.S)
assert n == 1, 'CLIPS line not found in tour.html'
open(args.tour, 'w', encoding='utf-8').write(new)
print('CLIPS updated:', sum(len(v) for v in data.values()), 'lines in', len(data), 'steps')
