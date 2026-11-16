"""Copies the network's figures (figures.json, written by slots_golf.py from the network.json seed) into tour.html as one line,
`const GNET = {...};`, which the golf tour's captions read: per display type, the clubs that have it, its screens across the network,
its viewers per play and its booked views and revenue; the network's screen total, club sizes, the deal's reach and Fernhollow's
screens. Run after slots_golf.py:
    python3 sync_tour_figures.py [--check]
Then regenerate tour-page.php (tools/build-tour.mjs) and update TOUR_PAGE_SHA256, as for any tour.html change."""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--check', action='store_true')
ap.add_argument('--tour', default=os.path.join(HERE, '..', '..', 'snippets', 'ph-industry-enhancements', 'tour', 'tour.html'))
args = ap.parse_args()
fig = json.load(open(os.path.join(HERE, 'figures.json'), encoding='utf-8'))
data = {'clubs': fig['clubs'], 'cpm': fig['cpm'], 'screens': fig['screens'], 'sizes': fig['clubsBySize'], 'deal': fig['deal'],
        'fern': {'name': fig['fernhollow']['name'], 'total': fig['fernhollow']['total'], 'screens': fig['fernhollow']['screens']},
        'types': [{k: t[k] for k in ('id', 'name', 'clubs', 'displayCount', 'vacdPerPlay', 'bookedWindows', 'bookedViews', 'bookedRevenue')} for t in fig['types']],
        'totals': fig['totals']}
line = 'const GNET = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';'
html = open(args.tour, encoding='utf-8').read()
new, n = re.subn(r'^const GNET = \{.*?\};$', lambda m: line, html, count=1, flags=re.M)
assert n == 1, 'GNET line not found in tour.html'
if args.check:
    print('GNET is current' if new == html else 'GNET is stale'); sys.exit(0 if new == html else 1)
open(args.tour, 'w', encoding='utf-8').write(new)
print('GNET updated:', data['screens'], 'screens at', data['clubs'], 'clubs')
