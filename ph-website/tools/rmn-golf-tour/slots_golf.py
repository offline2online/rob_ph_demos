"""Demo data for the Run Your Own RMN (golf club) walkthrough, derived from the DSP Integration prototype's own snapshot
(dsp-integration/prototype/demo/api-snapshot.json). Six golf club screen types, three slots per playlist, slot 1 owned by
Advertiser, slots 2 and 3 by Headquarters. Fictional names only: the Fairlinks Golf Network (100 connected golf clubs, one of them
Fernhollow Golf Club) sells to Corvane Golf. v2 (15 Nov 2026): display types and playlists are set once for the network, and every
view, play and revenue figure is for the whole network. v3 (15 Nov 2026): clubs differ in how many screens they have and have only
the display types they have screens for (network(), written to network.json), so each slot's displayCount is the number of screens
of that type across the network, and each display type has its own assumed viewers per play (vacdPerPlay). v4 (15 Nov 2026): every
club has 2 to 16 screens and its own mix of the six types, and no two neighbouring clubs have the same total.

    python3 slots_golf.py <api-snapshot.json> <out dir>

States written as <out>/golf-<state>.json: pre (no slots yet), predeal (slots, no deal), draft (deal saved, not on a slot),
assigned (deal on the six slots, still a draft), live (deal live + December bookings), dec (live, seen on 1 Dec 2026).
Same shape as tools/retail-media-tour/slots4.py, which made the convenience version."""
import copy, datetime, json, os, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'dsp-integration/prototype/demo/api-snapshot.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else '.'
FULL = json.load(open(SRC))['routes']

DT = [  # id, name, description (where the screen sits and who stands in front of it), w, h, orientation, playlist id, HQ labels,
        # assumed viewers per play (the display type's VAC-d per play: how many people a play of this position reaches)
    ('proshop', 'Pro Shop', 'Pro shop counter: members and visitors checking in and buying', 1080, 1920, 'portrait', 'pl_proshop', ['Lessons and fittings', 'Member offers'], 1.2),
    ('range', 'Driving Range', 'Range bays: players warming up before a round', 1920, 1080, 'landscape', 'pl_range', ['Range tokens', 'Coaching'], 0.8),
    ('tee', 'First Tee', "First tee and starter's hut: golfers about to tee off", 1920, 1080, 'landscape', 'pl_tee', ['Course updates', 'Competitions'], 2.4),
    ('halfway', 'Halfway House', 'Halfway house counter: golfers at the turn', 1920, 1080, 'landscape', 'pl_halfway', ['Food and drink', 'Snack deals'], 1.6),
    ('locker', 'Locker Room', 'Locker room: members changing before and after a round', 1080, 1920, 'portrait', 'pl_locker', ['Club news', 'Events'], 0.6),
    ('bar', 'Clubhouse Bar', 'Clubhouse bar: members and guests after the round', 1920, 1080, 'landscape', 'pl_bar', ['Bar menu', 'Functions'], 2.8),
]
TYPE_IDS = [d[0] for d in DT]
# ---------- the network seed (v4, 15 Nov 2026): every club is a different size, with its own mix of screen types ----------
# Each club only has the display types it has screens for. A screen's type is where it sits in the club. Every total in the tour
# (Stores / Branches, the per-type counts, the deal's reach, views and revenue) is derived from this list; nothing is hand-typed.
# v3 built the clubs from 13 fixed shapes, so neighbouring rows repeated the same totals; v4 draws each club's mix on its own.
SIZES = {  # screens per club -> how many clubs have that many (100 in all; no total covers more than 12 clubs)
    2: 7, 3: 9, 4: 9,                     # small: a quarter of the network
    5: 11, 6: 11, 7: 10, 8: 9, 9: 9,      # mid-size: half (Fernhollow is one of the nines)
    10: 6, 11: 5, 12: 5, 13: 4,           # large: a fifth
    14: 2, 15: 2, 16: 1,                  # a handful of flagships
}
TYPE_RANGE = {'proshop': (0, 3), 'range': (0, 4), 'tee': (0, 2), 'halfway': (0, 2), 'locker': (0, 2), 'bar': (1, 4)}  # screens per club
TYPE_WEIGHT = {'proshop': 3.0, 'range': 2.6, 'tee': 1.8, 'halfway': 1.2, 'locker': 1.0, 'bar': 2.4}  # how often a club adds one more of each
FERNHOLLOW = {'proshop': 2, 'range': 2, 'tee': 1, 'halfway': 1, 'locker': 1, 'bar': 2}  # 9 screens, all six types
STEMS = ['Fern', 'Quill', 'Wrenn', 'Marrow', 'Tansy', 'Corrie', 'Brisk', 'Hazle', 'Pellow', 'Sorrel']
ENDS = ['hollow', 'mead', 'wick', 'stow', 'combe', 'brae', 'holt', 'lea', 'ford', 'garth']
SEGMENTS = [["Members' club", 'Parkland'], ["Members' club", 'Heathland'], ['Pay and play', 'Parkland'], ["Members' club", 'Links'], ['Resort', 'Parkland']]


def club_mix(total, rnd):
    """One club's screens per type for a club of `total` screens: a Clubhouse Bar screen first, then one screen at a time to a type
    that still has room, weighted towards the pro shop, the range and the bar (TYPE_WEIGHT), within TYPE_RANGE."""
    per = {t: TYPE_RANGE[t][0] for t in TYPE_IDS}
    while sum(per.values()) < total:
        room = [t for t in TYPE_IDS if per[t] < TYPE_RANGE[t][1]]
        per[rnd.choices(room, [TYPE_WEIGHT[t] for t in room])[0]] += 1
    return per


def network():
    """The network's 100 clubs, Fernhollow Golf Club first (9 screens on all six types), the rest in a fixed shuffled order in which
    no two neighbouring clubs have the same number of screens (Stores / Branches lists them in this order)."""
    import random
    rnd = random.Random(15112026)
    names = [a + z + ' Golf Club' for a in STEMS for z in ENDS]
    totals = [n for n, k in SIZES.items() for _ in range(k)]
    assert len(names) == 100 and len(totals) == 100, (len(names), len(totals))
    totals.remove(sum(FERNHOLLOW.values()))
    rnd.shuffle(totals)
    mixes = [FERNHOLLOW] + [club_mix(n, rnd) for n in totals]
    for i in range(1, len(mixes)):  # no two neighbours share a total: swap in the next later club that fits between its neighbours
        if sum(mixes[i].values()) != sum(mixes[i - 1].values()): continue
        for j in range(i + 1, len(mixes)):
            nj = sum(mixes[j].values())
            if nj != sum(mixes[i - 1].values()) and (i + 1 >= len(mixes) or nj != sum(mixes[i + 1].values())) \
                    and sum(mixes[i].values()) != sum(mixes[j - 1].values()) and (j + 1 >= len(mixes) or sum(mixes[i].values()) != sum(mixes[j + 1].values())):
                mixes[i], mixes[j] = mixes[j], mixes[i]; break
    clubs = []
    for i, (nm, per) in enumerate(zip(names, mixes)):
        clubs.append({'code': f'FGN-{i + 1:03d}', 'name': nm, 'screens': {k: v for k, v in per.items() if v}, 'total': sum(per.values()),
                      'staff': 2 + (i * 7) % 9 + sum(per.values()) // 3, 'segments': SEGMENTS[i % len(SEGMENTS)]})
    return clubs


CLUB_LIST = network()
SCREENS = {t: sum(c['screens'].get(t, 0) for c in CLUB_LIST) for t in TYPE_IDS}   # screens of each type across the network
CLUBS_WITH = {t: sum(1 for c in CLUB_LIST if c['screens'].get(t)) for t in TYPE_IDS}  # clubs that have that type
VENUE = 'leisure.recreational_locations.golf_courses'
ADV_LABEL = 'Brand partner'
DEAL_FROM, DEAL_TO = '2026-12-01', '2026-12-31'  # the deal covers the whole of December
CPM = 150
CLUBS = len(CLUB_LIST)  # the network's connected golf clubs (network.json; stores.html lists them)
CLUB_HOURS = 12  # the club's screens run 12 hours a day
KEEP_ADV = ('red-bull',)  # Corvane only: Run Your Own RMN sells direct deals, so the seed has no DSP-synced advertisers (15 Nov 2026)
KEEP_CAMPAIGNS = {  # campaignId -> (name, display type, approval status)
    'c_demo_redbull_portrait': ('Corvane Season Ahead | New driver and Tour balls', 'proshop'),
    'c_demo_redbull_edition': ('Low-handicap Members | Free Tour ball sleeve', 'proshop'),
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
            v['dsps'] = []  # no DSP is connected to the network
        if isinstance(v, dict) and 'directAdvertisers' in v:
            v['directAdvertisers'] = [a for a in v['directAdvertisers'] if a['advertiserId'] in KEEP_ADV]
    R['/admin/v1/partners']['items'] = []  # no DSP is connected to the network
    for k in [k for k in R if 'partnerId=' in k]:
        del R[k]
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
                  'slotCount': 3, 'inGlobalDeal': False, 'globalDealSuppressedBy': None, 'displayCount': SCREENS[did],
                  'openHoursPerDay': CLUB_HOURS, 'operatingTimes': '06:30–18:30', 'unassigned': False, 'unsellableReason': None, 'salesLocked': False})
        a = x['assignedTo']
        names, ids = (['Corvane direct'], ['bl_demo_direct_redbull']) if deal_on else ([], [])
        a['partnerIds'] = []; a['partnerNames'] = []; a['advertisers'] = []
        a['buyersListNames'] = names; a['buyersListIds'] = ids
        a['buyersListId'] = ids[0] if ids else None; a['buyersListName'] = names[0] if names else None
        a['openAuction'] = False
        x['floorCpm'] = 100; x['floorCpmOverride'] = None
        x['playsPerWindow'] = int(86400 * (CLUB_HOURS / 24) // (15 * 3))
        x['vacdPerPlay'] = n  # this position's assumed viewers per play (the display type's own VAC-d)
        x['_views'] = round(x['playsPerWindow'] * x['displayCount'] * x['vacdPerPlay'])  # the whole network: every screen of this type, at every club that has one
        items.append(x)
    VIEWS = {x['displayTypeId']: x.pop('_views') for x in items}
    ai['items'] = [] if state == 'pre' else items
    ai['playlistDisplayTypes'] = {plid: [{'id': did, 'name': name, 'description': desc, 'storeZone': None}] for (did, name, desc, _w, _h, _o, plid, _l, _n) in DT}
    # ---------- booking schedules ----------
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
                      'displayCount': SCREENS[did], 'assignment': 'deal', 'realTime': False, 'partnerNames': []})
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
            v['dsps'] = []
        if 'directAdvertisers' in v:
            v['directAdvertisers'] = [a for a in v['directAdvertisers'] if a['advertiserId'] == 'red-bull']
        recompute(v)
    # ---------- the deal ----------
    for b in R['/admin/v1/buyers-lists']['items']:
        b['name'] = 'Corvane direct'
        b['description'] = 'Corvane Golf books the network directly: brand partner slot 1 on all six display types, on every matching screen across the network, at a fixed CPM.'
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
        a['approvalRequired'] = True  # every advertiser's campaigns go to the network for approval
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
        c['source'] = 'api'  # Corvane's own login, not a DSP (the prototype's sources are hq, api and dsp)
        if not isinstance(c.get('brief'), dict): c['brief'] = {}
        br = c['brief']
        br.update(OTHER_BRIEF.get(c['campaignId'], {}))
        if br.get('landingPageUrl'): br['landingPageUrl'] = 'https://example.com'
        if c['campaignId'] == 'c_demo_redbull_portrait':
            br.update({'details': "Season-ahead campaign for Corvane Golf on the network's pro shop, driving range, first tee, halfway house, locker room and clubhouse bar screens, on every matching screen across the network. Creative leads with the new Corvane driver and Corvane Tour balls.",
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
    # network.json and figures.json (kept beside this script): the seed, and the figures the tour quotes, which tests/tour.test.mjs
    # recomputes from the seed (screens per type = the sum over the clubs; views = plays per window x screens x viewers per play; revenue
    # = views x CPM / 1,000). sync_tour_figures.py copies figures.json into tour.html (const GNET).
    here = os.path.dirname(os.path.abspath(__file__))
    json.dump({'about': 'The Fairlinks Golf Network seed (v4): 100 fictional clubs of 2 to 16 screens, each with its own mix of the display types it has screens for. Written by slots_golf.py; read by stores.html, the tour figures and the tests.',
               'types': [{'id': d[0], 'name': d[1]} for d in DT], 'clubs': CLUB_LIST}, open(os.path.join(here, 'network.json'), 'w'), indent=1, ensure_ascii=False)
    open(os.path.join(here, 'network.json'), 'a').write('\n')
    deal = json.load(open(os.path.join(OUT, 'golf-assigned.json')))['routes']['/admin/v1/buyers-lists']['items'][0]
    sizes = sorted({c['total'] for c in CLUB_LIST})
    fig = {'clubs': CLUBS, 'cpm': CPM, 'from': '2026-12-01', 'to': '2026-12-14', 'screens': sum(SCREENS.values()),
           'clubsBySize': {str(n): sum(1 for c in CLUB_LIST if c['total'] == n) for n in sizes},
           'fernhollow': next(c for c in CLUB_LIST if c['name'] == 'Fernhollow Golf Club'),
           'deal': {'screens': sum(s['displayCount'] for s in deal['assignedSlots']), 'clubs': sum(1 for c in CLUB_LIST if c['screens']),
                    'forecastPlays': deal['_forecastPlays'], 'committedPlays': deal['committedPlays']},
           'types': [
        {'id': x['displayTypeId'], 'name': x['displayTypeName'], 'audience': x['displayTypeDescription'], 'clubs': CLUBS_WITH[x['displayTypeId']], 'displayCount': x['displayCount'],
         'playsPerWindow': x['playsPerWindow'], 'vacdPerPlay': x['vacdPerPlay'],
         'bookedWindows': next(r['bookedWindows'] for r in bs['revenue'] if r['displayTypeName'] == x['displayTypeName']),
         'bookedViews': next(r['bookedViews'] for r in bs['revenue'] if r['displayTypeName'] == x['displayTypeName']),
         'bookedRevenue': next(r['bookedRevenue'] for r in bs['revenue'] if r['displayTypeName'] == x['displayTypeName'])} for x in R['/admin/v1/available-inventory']['items']],
        'totals': {k: bs['totals'][k] for k in ('bookedWindows', 'bookedViews', 'bookedRevenue')}}
    json.dump(fig, open(os.path.join(here, 'figures.json'), 'w'), indent=1, ensure_ascii=False)
    open(os.path.join(here, 'figures.json'), 'a').write('\n')
