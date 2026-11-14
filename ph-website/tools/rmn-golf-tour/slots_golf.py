"""Demo data for the Run Your Own RMN (golf club) walkthrough, derived from the DSP Integration prototype's own snapshot
(dsp-integration/prototype/demo/api-snapshot.json). Six golf club screen types, three slots per playlist, slot 1 owned by
Advertiser, slots 2 and 3 by Headquarters. Fictional names only: Fernhollow Golf Club (the venue) sells to Corvane Golf.

    python3 slots_golf.py <api-snapshot.json> <out dir>

States written as <out>/golf-<state>.json: pre (no slots yet), predeal (slots, no deal), draft (deal saved, not on a slot),
assigned (deal on the six slots, still a draft), live (deal live + December bookings), dec (live, seen on 1 Dec 2026).
Same shape as tools/retail-media-tour/slots4.py, which made the convenience version."""
import copy, datetime, json, os, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'dsp-integration/prototype/demo/api-snapshot.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else '.'
FULL = json.load(open(SRC))['routes']

DT = [  # id, name, description, w, h, orientation, playlist id, HQ labels, screens in the club
    ('proshop', 'Pro Shop', 'Pro shop and check-in screens', 1080, 1920, 'portrait', 'pl_proshop', ['Lessons and fittings', 'Member offers'], 3),
    ('range', 'Driving Range', 'Driving range bay screens', 1920, 1080, 'landscape', 'pl_range', ['Range tokens', 'Coaching'], 12),
    ('tee', 'First Tee', "First tee and starter's hut screens", 1920, 1080, 'landscape', 'pl_tee', ['Course updates', 'Competitions'], 2),
    ('halfway', 'Halfway House', 'Halfway house counter screens', 1920, 1080, 'landscape', 'pl_halfway', ['Food and drink', 'Snack deals'], 2),
    ('locker', 'Locker Room', 'Locker room screens', 1080, 1920, 'portrait', 'pl_locker', ['Club news', 'Events'], 4),
    ('bar', 'Clubhouse Bar', 'Clubhouse bar screens', 1920, 1080, 'landscape', 'pl_bar', ['Bar menu', 'Functions'], 4),
]
VENUE = 'leisure.recreational_locations.golf_courses'
ADV_LABEL = 'Brand partner'
DEAL_FROM, DEAL_TO = '2026-12-01', '2026-12-31'  # the deal covers the whole of December
CPM = 150
CLUB_HOURS = 12  # the club's screens run 12 hours a day
KEEP_ADV = ('red-bull', 'monster-energy', 'nestle')
KEEP_CAMPAIGNS = {  # campaignId -> (name, display type, approval status)
    'c_demo_redbull_portrait': ('Corvane Season Ahead | New driver and Tour balls', 'proshop'),
    'c_demo_redbull_edition': ('Low-handicap Members | Free Tour ball sleeve', 'proshop'),
    'c_demo_nestle_kitkat': ('Northwind Foods — Halfway house snacks', 'halfway'),
    'c_dsp_nestle': ('Northwind Foods — Winter soups', 'bar'),
    'c_seed_monster-energy': ('Thunder Energy — Back nine boost', 'range'),
}
# Every advertiser in the prototype's seed is a real brand: each gets a fictional name, whether or not it is shown.
RENAME = [
    ('Red Bull', 'Corvane Golf'), ('Monster Energy', 'Thunder Energy'), ('Nestlé', 'Northwind Foods'),
    ('Arnott’s', 'Bramble Biscuits'), ('Bundaberg Brewed Drinks', 'Hollis Brewed Drinks'), ('Coca-Cola', 'Fizzwell'),
    ('Dare Iced Coffee', 'Daybreak Iced Coffee'), ('Frito-Lay', 'Crunchwell'), ('Frucor Suntory', 'Orchard Springs'),
    ('Gatorade', 'Rallyade'), ('Kellanova', 'Kestrel Foods'), ('Mars Wrigley', 'Saturn Confectionery'),
    ('Mondelez International', 'Meadow Lane Foods'), ('PepsiCo', 'Brightwater Beverages'), ('Smith’s Snackfood Co', 'Saltmarsh Snacks'),
    ('The Hershey Company', 'Hearthstone Chocolate'),
]
NAME = {d[0]: d[1] for d in DT}
OTHER_BRIEF = {  # the other advertisers' campaigns, given golf club products too
    'c_demo_nestle_kitkat': {'details': 'Northwind flapjacks and trail mix at the halfway house counter.', 'promotedProducts': ['Northwind flapjacks', 'Northwind trail mix'], 'targetAudiences': ['Golfers at the turn']},
    'c_dsp_nestle': {'details': 'Northwind winter soups in the clubhouse bar.', 'promotedProducts': ['Northwind winter soups'], 'targetAudiences': ['Members']},
    'c_seed_monster-energy': {'details': 'Thunder Energy for the back nine, on the driving range.', 'promotedProducts': ['Thunder Energy Tropical'], 'targetAudiences': ['Range users']},
}


def shift(v, days=27):  # the snapshot's booking windows (4-17 Nov) move to 1-14 Dec
    return (datetime.date.fromisoformat(v[:10]) + datetime.timedelta(days)).isoformat() + v[10:]


def hq(label):
    return {'label': label, 'owner': 'internal', 'partnerIds': [], 'advertisers': [], 'listMode': None, 'storeScope': None, 'quota': None}


def recompute(bs):
    ws = [w for p in bs['positions'] for w in p['windows']]
    bk = [w for w in ws if w.get('booking')]
    t = bs.setdefault('totals', {})
    t['bookedWindows'] = len(bk); t['sellableWindows'] = len([w for w in ws if w.get('status') != 'unavailable'])
    t['bookedRevenue'] = round(sum((w['booking'].get('bookedRevenue') or 0) for w in bk), 2)
    for g in bs.get('byPricingType', []):
        g['bookedWindows'] = len([w for w in bk if w['booking'].get('pricingType') == g['pricingType']])
        g['bookedRevenue'] = round(sum((w['booking'].get('bookedRevenue') or 0) for w in bk if w['booking'].get('pricingType') == g['pricingType']), 2)
    tmpl = (bs.get('revenue') or [{}])[0]
    rev = []
    for (did, name, *_r) in DT:
        pw = [w for p in bs['positions'] if p['displayTypeId'] == did for w in p['windows']]
        if not pw: continue
        b2 = [w for w in pw if w.get('booking')]
        r = copy.deepcopy(tmpl); r['displayTypeId'] = did; r['displayTypeName'] = name
        r['bookedWindows'] = len(b2); r['sellableWindows'] = len([w for w in pw if w.get('status') != 'unavailable'])
        r['bookedRevenue'] = round(sum((w['booking'].get('bookedRevenue') or 0) for w in b2), 2)
        r['bookedViews'] = sum((w['booking'].get('assumedViews') or 0) for w in b2)
        av = [w for w in pw if w.get('status') == 'available']
        r['availableWindows'] = len(av); r['availableViews'] = sum((w.get('assumedViews') or 0) for w in av)
        r['totalViews'] = r['bookedViews'] + r['availableViews']
        r['availableValue'] = round(r['availableViews'] * 0.1, 2)
        r['billedRevenue'] = 0
        rev.append(r)
    bs['revenue'] = rev
    for k in ('bookedViews', 'totalViews', 'availableViews', 'availableValue'):
        t[k] = round(sum(r.get(k, 0) or 0 for r in rev), 2)
    t['availableWindows'] = sum(r['availableWindows'] for r in rev)


def lite(has_deal):
    """The prototype's snapshot cut down to three fictional advertisers and their five campaigns; HQ campaigns and every other brand removed."""
    R = copy.deepcopy(FULL)
    R['/admin/v1/advertisers']['items'] = [a for a in R['/admin/v1/advertisers']['items'] if a['advertiserId'] in KEEP_ADV]
    R['/admin/v1/campaigns']['items'] = [c for c in R['/admin/v1/campaigns']['items'] if c['campaignId'] in KEEP_CAMPAIGNS]
    for k in list(R):
        if k.startswith('/admin/v1/campaigns/c_') and k.split('/')[4] not in KEEP_CAMPAIGNS:
            del R[k]
        if k.startswith('/admin/v1/booking-schedule?campaignId=') and k.split('=')[1] not in KEEP_CAMPAIGNS:
            del R[k]
        elif 'advertiserId=' in k and k.split('advertiserId=')[1].split('&')[0] not in KEEP_ADV:
            del R[k]
    R['/admin/v1/buyers-lists']['items'] = [b for b in R['/admin/v1/buyers-lists']['items'] if has_deal and b['id'] == 'bl_demo_direct_redbull']
    for key, v in R.items():
        if isinstance(v, dict) and 'dsps' in v:
            for d in v['dsps']:
                d['advertisers'] = [a for a in d.get('advertisers', []) if a['advertiserId'] in KEEP_ADV]
        if isinstance(v, dict) and 'directAdvertisers' in v:
            v['directAdvertisers'] = [a for a in v['directAdvertisers'] if a['advertiserId'] in KEEP_ADV]
    for p in R['/admin/v1/partners']['items']:
        p['seats'] = [s for s in p.get('seats', []) if s.get('name') == 'Nestlé']
        p['advertiserWhitelist'] = [s['id'] for s in p['seats']]
    return R


def transform(state):
    R = lite(state in ('draft', 'assigned', 'live'))
    deal_on = state in ('assigned', 'live')
    has_deal = state in ('draft', 'assigned', 'live')
    # ---------- display types and playlists ----------
    src_dt = {x['id']: x for x in FULL['/admin/v1/display-types']['items']}

    def adv_slot():
        d = {'label': ADV_LABEL, 'owner': 'advertiser', 'partnerIds': [], 'advertisers': [], 'listMode': 'deal' if deal_on else None, 'storeScope': None, 'quota': None}
        if deal_on: d.update({'buyersListId': 'bl_demo_direct_redbull', 'buyersListIds': ['bl_demo_direct_redbull']})
        return d
    dts = []
    for (did, name, desc, w, h, orient, plid, hql, n) in DT:
        x = copy.deepcopy(src_dt['portrait' if orient == 'portrait' else 'landscape'])
        x['id'] = did; x['name'] = name; x['description'] = desc
        x['displayCanvasSize'] = {'width': w, 'height': h}
        x['defaultPlaylistId'] = plid
        x['multiZone'] = {'enabled': False, 'zones': []}
        x['phExtensions'] = {'slots': [adv_slot(), hq(hql[0]), hq(hql[1])], 'venue': {'openOohVenueType': VENUE, 'orientation': orient, 'loopLengthSec': 45}}
        x['playlistSettings']['maximumCampaignsPlayedInRotation'] = 3
        if state == 'pre':
            x['playlistSettings']['maximumCampaignsPlayedInRotation'] = None
            x['phExtensions']['slots'] = []
        dts.append(x)
    R['/admin/v1/display-types']['items'] = dts
    R['/admin/v1/playlists']['items'] = [{'id': plid, 'name': f'{name} Playlist', 'autoCreatedFor': did, 'playlistSettings': {},
        'assignments': [{'displayTypeId': did, 'displayTypeName': name, 'zoneId': None, 'zoneName': None}]} for (did, name, _d, _w, _h, _o, plid, _l, _n) in DT]
    # ---------- available inventory ----------
    ai = R['/admin/v1/available-inventory']
    tpl = {(x['displayTypeId'], x['slot']): x for x in FULL['/admin/v1/available-inventory']['items']}
    items = []
    for (did, name, desc, w, h, orient, plid, _l, n) in DT:
        x = copy.deepcopy(tpl[('portrait', 1)] if orient == 'portrait' else tpl[('landscape', 2)])
        x.update({'displayTypeId': did, 'displayTypeName': name, 'displayTypeDescription': desc, 'displayTypeOrientation': orient,
                  'playlistName': f'{name} Playlist', 'playlistId': plid, 'slot': 1, 'zoneSlot': 1, 'position': ADV_LABEL,
                  'slotCount': 3, 'inGlobalDeal': False, 'globalDealSuppressedBy': None, 'displayCount': n,
                  'openHoursPerDay': CLUB_HOURS, 'operatingTimes': '06:30–18:30', 'unassigned': False, 'unsellableReason': None, 'salesLocked': False})
        a = x['assignedTo']
        names, ids = (['Corvane direct'], ['bl_demo_direct_redbull']) if deal_on else ([], [])
        a['partnerIds'] = []; a['partnerNames'] = []; a['advertisers'] = []
        a['buyersListNames'] = names; a['buyersListIds'] = ids
        a['buyersListId'] = ids[0] if ids else None; a['buyersListName'] = names[0] if names else None
        a['openAuction'] = False
        x['floorCpm'] = 100; x['floorCpmOverride'] = None
        x['playsPerWindow'] = int(86400 * (CLUB_HOURS / 24) // (15 * 3))
        x['_views'] = round(x['playsPerWindow'] * n * x['vacdPerPlay'])
        items.append(x)
    VIEWS = {x['displayTypeId']: x.pop('_views') for x in items}
    ai['items'] = [] if state == 'pre' else items
    ai['playlistDisplayTypes'] = {plid: [{'id': did, 'name': name, 'description': desc, 'storeZone': None}] for (did, name, desc, _w, _h, _o, plid, _l, _n) in DT}
    # ---------- booking schedules ----------
    dtn = {d[0]: d[8] for d in DT}
    for key, v in R.items():
        if not (key.startswith('/admin/v1/booking-schedule') and isinstance(v, dict) and 'positions' in v):
            continue
        fpos = {p['positionId']: p for p in FULL['/admin/v1/booking-schedule']['positions']}
        cor_tpl = None
        for p in fpos.values():
            for w in p['windows']:
                b = w.get('booking')
                if b and b.get('advertiserId') == 'red-bull' and not cor_tpl: cor_tpl = copy.deepcopy(b)
        pos = []
        for (did, name, desc, w, h, orient, plid, _l, n) in DT:
            p = copy.deepcopy(fpos['portrait.s3' if orient == 'portrait' else 'landscape.s2'])
            p.update({'positionId': f'{did}.s1', 'displayTypeId': did, 'displayTypeName': name, 'slot': 1, 'zoneSlot': 1, 'slotLabel': ADV_LABEL,
                      'displayCount': dtn[did], 'assignment': 'deal', 'realTime': False, 'partnerNames': []})
            for k, win in enumerate(p['windows']):
                win['start'] = shift(win['start'])
                if win.get('end'): win['end'] = shift(win['end'])
                win['assumedViews'] = VIEWS[did]
                win['booking'] = None; win['status'] = 'available'  # newly opened slots: nothing booked before the Corvane deal
                day = win['start'][:10]
                if deal_on and state == 'live' and DEAL_FROM <= day <= DEAL_TO and cor_tpl:
                    nb = copy.deepcopy(cor_tpl)
                    nb.update({'reservationId': f'res_corvane_{did}_{k}', 'campaignId': 'c_demo_redbull_portrait', 'cpm': CPM,
                               'assumedViews': VIEWS[did], 'bookedRevenue': round(VIEWS[did] * CPM / 1000, 2), 'pricingType': 'personalised',
                               'layers': {'default': True, 'localised': False, 'personalised': True}})
                    ap = nb.get('approval') or {}
                    ap['localised'] = {'approved': 0, 'submitted': 0}; ap['personalised'] = {'approved': 1, 'submitted': 1}
                    nb['approval'] = ap
                    win['booking'] = nb; win['status'] = 'booked'
            pos.append(p)
        v['positions'] = pos
        v['windows'] = [{**w, 'start': shift(w['start']), 'end': shift(w['end'])} for w in v.get('windows', [])]
        if 'dsps' in v:
            for d in v['dsps']:
                d['advertisers'] = []
        if 'directAdvertisers' in v:
            v['directAdvertisers'] = [a for a in v['directAdvertisers'] if a['advertiserId'] == 'red-bull']
        recompute(v)
    # ---------- the deal ----------
    for b in R['/admin/v1/buyers-lists']['items']:
        b['name'] = 'Corvane direct'
        b['description'] = 'Corvane Golf books the club directly, with no DSP: brand partner slots on all six screen types at a fixed CPM.'
        b['activeFrom'] = DEAL_FROM + 'T00:00:00.000Z'; b['activeTo'] = DEAL_TO + 'T23:59:59.999Z'
        b['floorCpm'] = CPM; b['effectiveRateCpm'] = {'min': CPM, 'max': CPM, 'source': 'buyer'}
        t = b['assignedSlots'][0]
        slots, plays = [], 0
        for x in items:
            s = copy.deepcopy(t)
            s.update({'positionId': f"{x['displayTypeId']}.s1", 'label': f"{x['displayTypeName']} — {ADV_LABEL}", 'displayTypeName': x['displayTypeName'],
                      'slot': 1, 'zoneName': None, 'zoneSlot': 1, 'description': x['displayTypeDescription'], 'storeZone': None, 'position': ADV_LABEL,
                      'playlistName': x['playlistName'], 'orientation': x['displayTypeOrientation'], 'displayCount': x['displayCount'],
                      'windowHours': 24, 'playsPerWindow': x['playsPerWindow'], 'vacdPerPlay': x['vacdPerPlay']})
            slots.append(s); plays += x['playsPerWindow'] * x['displayCount'] * 31
        committed = int(round(plays * 0.9))  # forecast plays over the 31-day flight less the 10% guarantee buffer
        b['_forecastPlays'] = plays
        b['assignedSlots'] = slots if deal_on else []
        b['committedPlays'] = committed if deal_on else None
        b['effectiveCommittedPlays'] = {'min': committed, 'max': committed, 'source': 'buyer'} if deal_on else None
        b['status'] = 'shared' if state == 'live' else 'draft'
        if state != 'live': b['sharedAt'] = None
    for a in R['/admin/v1/advertisers']['items']:
        a['approvalRequired'] = True  # every advertiser's campaigns go to the club for approval
        if a['advertiserId'] == 'red-bull':
            a['campaigns'] = {'draft': 0, 'awaiting_approval': 0, 'approved': 0, 'rejected': 0}  # Corvane has no campaigns until it signs in
            a['buyersListCount'] = 1 if has_deal else 0
            a['bookings'] = 0
        if a['advertiserId'] == 'nestle':
            a['buyersListCount'] = 0; a['campaigns'] = {'draft': 0, 'awaiting_approval': 0, 'approved': 2, 'rejected': 0}
        if a['advertiserId'] == 'monster-energy':
            a['campaigns'] = {'draft': 0, 'awaiting_approval': 0, 'approved': 1, 'rejected': 0}
    # ---------- campaigns ----------
    for c in R['/admin/v1/campaigns']['items']:
        nm, did = KEEP_CAMPAIGNS[c['campaignId']]
        c['name'] = nm; c['displayTypeId'] = did
        if not isinstance(c.get('brief'), dict): c['brief'] = {}
        br = c['brief']
        br.update(OTHER_BRIEF.get(c['campaignId'], {}))
        if br.get('landingPageUrl'): br['landingPageUrl'] = 'https://example.com'
        if c['campaignId'] == 'c_demo_redbull_portrait':
            br.update({'details': "Season-ahead campaign for Corvane Golf on the club's pro shop, driving range, first tee, halfway house, locker room and clubhouse bar screens. Creative leads with the new Corvane driver and Corvane Tour balls.",
                       'objective': 'Drive Sales', 'promotedProducts': ['Corvane driver', 'Corvane Tour balls'], 'targetAudiences': ['Members', 'Visiting golfers']})
        if c['campaignId'] == 'c_demo_redbull_edition':
            br.update({'details': 'A free sleeve of Corvane Tour balls with any driver fitting, for low-handicap members who buy golf balls, shown only to them, in real time.',
                       'objective': 'Drive Sales', 'promotedProducts': ['Corvane driver', 'Corvane Tour balls'], 'targetAudiences': ['Low-handicap members']})
            c['pricingType'] = 'personalised'; c['localisedVariables'] = []; c['localisedRuleLines'] = []
            c['personalisedVariables'] = ['Audience / Segments', 'Purchase History']
            c['personalisedRuleLines'] = ['Audience / Segments is Low-handicap members', 'Purchase History includes Golf balls']
        if c['campaignId'] == 'c_demo_redbull_portrait':
            c['pricingType'] = 'scheduled' if c.get('pricingType') == 'localised' else c.get('pricingType')
    canv = {d[0]: (d[3], d[4]) for d in DT}
    for cid, (nm, did) in KEEP_CAMPAIGNS.items():
        ap = R.get(f'/admin/v1/campaigns/{cid}/approval')
        if not ap: continue
        ap['campaignName'] = nm
        w, h = canv[did]
        ap['canvas'] = {'width': w, 'height': h}
        for ch in ap.get('checks', []):
            if ch['name'] == 'dimensions': ch['detail'] = f'{w}×{h} matches the canvas'
            if ch['name'] == 'aspect_ratio': ch['detail'] = f'{w / h:.2f} matches the canvas'
        if cid == 'c_demo_redbull_edition':
            ap['status'] = 'awaiting_approval'
            ap['targetingSummary'] = 'Default\nLow-handicap members (personalised): Audience / Segments is Low-handicap members AND Purchase History includes Golf balls'
        elif cid == 'c_demo_redbull_portrait':
            ap['targetingSummary'] = 'Default'
    # ---------- rebrand ----------
    s = json.dumps(R, ensure_ascii=False)
    for a, b in RENAME:
        s = s.replace(a, b)
    s = s.replace('Corvane Golf direct', 'Corvane direct')
    return {'capturedAt': '2026-11-20T03:00:00.000Z', 'routes': json.loads(s)}


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for st in ['pre', 'predeal', 'draft', 'assigned', 'live', 'dec']:
        out = transform('live' if st == 'dec' else st)
        if st == 'dec': out['capturedAt'] = '2026-12-01T03:00:00.000Z'  # the member's round happens in December
        json.dump(out, open(os.path.join(OUT, f'golf-{st}.json'), 'w'), ensure_ascii=False)
    R = json.load(open(os.path.join(OUT, 'golf-dec.json')))['routes']
    bs = R['/admin/v1/booking-schedule']
    print('totals', json.dumps(bs['totals']))
    for r in bs['revenue']:
        print('  ', r['displayTypeName'], r['bookedWindows'], '/', r['sellableWindows'], 'views', r['bookedViews'], 'USD', r['bookedRevenue'])
    for b in json.load(open(os.path.join(OUT, 'golf-assigned.json')))['routes']['/admin/v1/buyers-lists']['items']:
        print('deal', b['name'], b['status'], len(b['assignedSlots']), 'forecast', b['_forecastPlays'], 'committed', b['committedPlays'])
    for x in R['/admin/v1/available-inventory']['items']:
        print('  AI', x['playlistName'], x['displayCount'], x['playsPerWindow'], x['vacdPerPlay'])
