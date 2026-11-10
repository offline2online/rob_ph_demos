"""Demo data for the retail media walkthrough: four convenience screen types, three slots per playlist,
slot 1 owned by Advertiser, slots 2 and 3 by Headquarters. Rebrands to Larkspur Convenience / Frostline Cold Drinks.
States: pre (no slots), predeal, draft (deal unassigned), assigned (deal on 4 slots, draft), live (deal live + bookings)."""
import json, copy

FULL = json.load(open('snap-live.json'))['routes']
DT = [  # id, name, description, w, h, orientation, playlist id, HQ labels
    ('landscape', 'Forecourt', 'Fuel pump and driveway screens', 1920, 1080, 'landscape', 'pl_landscape', ['Fuel and car wash', 'Coffee and food']),
    ('portrait', 'Shop Front', 'Entrance and window screens', 1080, 1920, 'portrait', 'pl_portrait', ["Today's deals", 'Store services']),
    ('cooler', 'Cooler Doors', 'Screens on the cold drink cooler doors', 1920, 600, 'landscape', 'pl_cooler', ['Cold drink deals', 'Meal deals']),
    ('pos', 'POS', 'Checkout screens', 1024, 768, 'landscape', 'pl_pos', ['Add-on offers', 'Loyalty app']),
]
NAME = {d[0]: d[1] for d in DT}
ADV_LABEL = 'Brand partner'
FROST_FROM, FROST_TO = '2026-12-01', '2026-12-31'  # the deal covers the whole of December
import datetime
def shift(v, days=27):  # the snapshot's booking windows (4-17 Nov) move to 1-14 Dec
    return (datetime.date.fromisoformat(v[:10]) + datetime.timedelta(days)).isoformat() + v[10:]
FROST_CPM = 150

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

def transform(D, state):
    R = D['routes']
    deal_on = state in ('assigned', 'live')
    has_deal = state in ('draft', 'assigned', 'live')
    # ---------- display types and playlists ----------
    src_dt = {x['id']: x for x in FULL['/admin/v1/display-types']['items']}
    dts = []
    # the four brand partner slots start blank (newly opened); the deal is the only thing ever assigned to them
    def adv_slot(did):
        d = {'label': ADV_LABEL, 'owner': 'advertiser', 'partnerIds': [], 'advertisers': [], 'listMode': 'deal' if deal_on else None, 'storeScope': None, 'quota': None}
        if deal_on: d.update({'buyersListId': 'bl_demo_direct_redbull', 'buyersListIds': ['bl_demo_direct_redbull']})
        return d
    slot1 = {did: adv_slot(did) for (did, *_r) in DT}
    for (did, name, desc, w, h, orient, plid, hql) in DT:
        x = copy.deepcopy(src_dt['portrait' if orient == 'portrait' else 'landscape'])
        x['id'] = did; x['name'] = name; x['description'] = desc
        x['displayCanvasSize'] = {'width': w, 'height': h}
        x['defaultPlaylistId'] = plid
        x['multiZone'] = {'enabled': False, 'zones': []}
        x['phExtensions'] = {'slots': [slot1[did], hq(hql[0]), hq(hql[1])], 'venue': {'openOohVenueType': 'retail.convenience', 'orientation': orient, 'loopLengthSec': 45}}
        x['playlistSettings']['maximumCampaignsPlayedInRotation'] = 3
        if state == 'pre':
            x['playlistSettings']['maximumCampaignsPlayedInRotation'] = None
            x['phExtensions']['slots'] = []
        dts.append(x)
    R['/admin/v1/display-types']['items'] = dts
    R['/admin/v1/playlists']['items'] = [{'id': plid, 'name': f'{name} Playlist', 'autoCreatedFor': did, 'playlistSettings': {},
        'assignments': [{'displayTypeId': did, 'displayTypeName': name, 'zoneId': None, 'zoneName': None}]} for (did, name, _d, _w, _h, _o, plid, _l) in DT]
    # ---------- available inventory ----------
    ai = R['/admin/v1/available-inventory']
    lite = {(x['displayTypeId'], x['slot']): x for x in ai['items']}
    full_ai = {(x['displayTypeId'], x['slot']): x for x in FULL['/admin/v1/available-inventory']['items']}
    src_ai = {'landscape': lite[('landscape', 4)], 'portrait': lite[('landscape', 2)], 'cooler': lite[('portrait', 3)], 'pos': full_ai[('portrait', 1)]}
    items = []
    for (did, name, desc, w, h, orient, plid, _l) in DT:
        x = copy.deepcopy(src_ai[did])
        x.update({'displayTypeId': did, 'displayTypeName': name, 'displayTypeDescription': desc, 'displayTypeOrientation': orient,
                  'playlistName': f'{name} Playlist', 'playlistId': plid, 'slot': 1, 'zoneSlot': 1, 'position': ADV_LABEL,
                  'slotCount': 3, 'inGlobalDeal': False, 'globalDealSuppressedBy': None})
        a = x['assignedTo']
        names, ids = (['Volt Energy direct'], ['bl_demo_direct_redbull']) if deal_on else ([], [])
        a['partnerIds'] = []; a['partnerNames'] = []; a['advertisers'] = []
        a['buyersListNames'] = names; a['buyersListIds'] = ids
        a['buyersListId'] = ids[0] if ids else None; a['buyersListName'] = names[0] if names else None
        a['openAuction'] = False
        x['floorCpm'] = 100; x['floorCpmOverride'] = None
        oh = min(24, x.get('openHoursPerDay') or 24)
        x['playsPerWindow'] = int(86400 * (oh / 24) // (15 * 3))
        x['_views'] = round(x['playsPerWindow'] * x['displayCount'] * x['vacdPerPlay'])
        items.append(x)
    VIEWS = {x['displayTypeId']: x.pop('_views') for x in items}
    ai['items'] = [] if state == 'pre' else items
    ai['playlistDisplayTypes'] = {plid: [{'id': did, 'name': name, 'description': desc, 'storeZone': None}] for (did, name, desc, _w, _h, _o, plid, _l) in DT}
    # ---------- booking schedules ----------
    for key, v in R.items():
        if not (key.startswith('/admin/v1/booking-schedule') and isinstance(v, dict) and 'positions' in v):
            continue
        cur = {p['positionId']: p for p in v['positions']}
        fullv = FULL.get(key) or {}
        fpos = {p['positionId']: p for p in fullv.get('positions', [])}
        volt_tpl = None
        for p in list(cur.values()) + list(fpos.values()):
            for w in p['windows']:
                b = w.get('booking')
                if b and b.get('advertiserId') == 'red-bull' and not volt_tpl: volt_tpl = copy.deepcopy(b)
        src = {'landscape': cur.get('landscape.s4') or fpos.get('landscape.s4'), 'portrait': cur.get('landscape.s2') or fpos.get('landscape.s2'),
               'cooler': cur.get('portrait.s3') or fpos.get('portrait.s3'), 'pos': cur.get('portrait.s3') or fpos.get('portrait.s3')}
        pos = []
        for (did, name, desc, w, h, orient, plid, _l) in DT:
            s = src[did]
            if not s: continue
            p = copy.deepcopy(s)
            p.update({'positionId': f'{did}.s1', 'displayTypeId': did, 'displayTypeName': name, 'slot': 1, 'zoneSlot': 1, 'slotLabel': ADV_LABEL})
            p['assignment'] = 'deal'
            p['realTime'] = False
            p['partnerNames'] = []
            for k, win in enumerate(p['windows']):
                win['start'] = shift(win['start'])
                if win.get('end'): win['end'] = shift(win['end'])
                if win.get('assumedViews') is not None:
                    win['assumedViews'] = VIEWS[did]
                    if win.get('booking'):
                        win['booking']['assumedViews'] = VIEWS[did]
                        win['booking']['bookedRevenue'] = round(VIEWS[did] * (win['booking'].get('cpm') or 0) / 1000, 2)
                b = win.get('booking')
                day = win['start'][:10]
                keep = False  # newly opened slots: nothing booked before the Frostline deal
                if not keep and b: win['booking'] = None; win['status'] = 'available'
                if keep and b.get('advertiserId') == 'monster-energy':  # open auction clears default and localised only
                    b['layers'] = {**(b.get('layers') or {}), 'personalised': False}
                    if b.get('approval'): b['approval']['personalised'] = {'approved': 0, 'submitted': 0}
                    b['personalisedTriggers'] = None
                if deal_on and state == 'live' and FROST_FROM <= day <= FROST_TO and volt_tpl:
                    nb = copy.deepcopy(volt_tpl)
                    views = VIEWS[did]; win['assumedViews'] = views
                    nb.update({'reservationId': f'res_frostline_{did}_{k}', 'campaignId': 'c_demo_redbull_portrait', 'cpm': FROST_CPM,
                               'assumedViews': views, 'bookedRevenue': round(views * FROST_CPM / 1000, 2), 'pricingType': 'personalised',
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
        recompute(v)
    # ---------- deals ----------
    R['/admin/v1/buyers-lists']['items'] = [b for b in R['/admin/v1/buyers-lists']['items'] if b['id'] != 'bl_demo_pg_nestle']
    bls = R['/admin/v1/buyers-lists']['items']
    for b in bls:
        if b['id'] == 'bl_demo_pg_nestle':
            b['activeTo'] = '2026-11-08T23:59:59.999Z'
            fc = [x for x in items if x['displayTypeId'] == 'landscape'][0]
            pg = int(round(fc['playsPerWindow'] * fc['displayCount'] * 5 * 0.9))
            b['committedPlays'] = pg; b['effectiveCommittedPlays'] = {'min': pg, 'max': pg, 'source': 'buyer'}
            b['description'] = "Northwind Foods buys five days on the Forecourt brand partner slot through its Google DSP seat: a guaranteed deal at a fixed CPM, with no auction."
            sl = b['assignedSlots'][0]
            sl.update({'positionId': 'landscape.s1', 'label': f'Forecourt — {ADV_LABEL}', 'displayTypeName': 'Forecourt', 'slot': 1, 'zoneSlot': 1,
                       'position': ADV_LABEL, 'playlistName': 'Forecourt Playlist'})
        if b['id'] == 'bl_demo_direct_redbull':
            b['description'] = 'Volt Energy books the retailer directly, with no DSP: brand partner slots on all four screen types at a fixed CPM.'
            b['activeFrom'] = FROST_FROM + 'T00:00:00.000Z'; b['activeTo'] = FROST_TO + 'T23:59:59.999Z'
            b['floorCpm'] = FROST_CPM; b['effectiveRateCpm'] = {'min': FROST_CPM, 'max': FROST_CPM, 'source': 'buyer'}
            tpl = b['assignedSlots'][0] if b.get('assignedSlots') else None
            slots, plays = [], 0
            for x in items:
                s = copy.deepcopy(tpl) if tpl else {}
                s.update({'positionId': f"{x['displayTypeId']}.s1", 'label': f"{x['displayTypeName']} — {ADV_LABEL}", 'displayTypeName': x['displayTypeName'],
                          'slot': 1, 'zoneName': None, 'zoneSlot': 1, 'description': x['displayTypeDescription'], 'storeZone': None, 'position': ADV_LABEL,
                          'playlistName': x['playlistName'], 'orientation': x['displayTypeOrientation'], 'displayCount': x['displayCount'],
                          'windowHours': 24, 'playsPerWindow': x['playsPerWindow'], 'vacdPerPlay': x['vacdPerPlay']})
                slots.append(s); plays += x['playsPerWindow'] * x['displayCount'] * 31
            committed = int(round(plays * 0.9))  # forecast plays over the 30-day flight less the 10% guarantee buffer
            b['assignedSlots'] = slots if deal_on else []
            b['committedPlays'] = committed if deal_on else None
            b['effectiveCommittedPlays'] = {'min': committed, 'max': committed, 'source': 'buyer'} if deal_on else None
            b['status'] = 'shared' if state == 'live' else 'draft'
            if state != 'live': b['sharedAt'] = None
    for a in R['/admin/v1/advertisers']['items']:
        a['approvalRequired'] = True  # every advertiser's campaigns go to the retailer for approval
        if a['advertiserId'] == 'red-bull': a['campaigns'] = {'draft': 0, 'awaiting_approval': 0, 'approved': 0, 'rejected': 0}  # Frostline has no campaigns until it signs in
        if a['advertiserId'] == 'red-bull': a['buyersListCount'] = 1 if has_deal else 0
        if a['advertiserId'] == 'nestle': a['buyersListCount'] = 0
    # ---------- campaigns ----------
    dmap = {'c_demo_redbull_portrait': 'cooler', 'c_demo_redbull_edition': 'cooler', 'c_seed_monster-energy': 'portrait', 'c_demo_nestle_kitkat': 'landscape', 'c_seed_nestle': 'landscape'}
    for c in R['/admin/v1/campaigns']['items']:
        if c['campaignId'] in dmap: c['displayTypeId'] = dmap[c['campaignId']]
        if c['campaignId'] == 'c_demo_redbull_portrait':
            c['brief'].update({'details': "Summer campaign for Frostline Cold Drinks on the retailer's forecourt, shop front, cooler door and POS screens. Creative leads with the refresh and points shoppers to the coolers.",
                               'objective': 'Drive Sales', 'promotedProducts': ['Frostline Cola', 'Frostline Iced Tea'], 'targetAudiences': ['Drivers', 'Lunchtime shoppers']})
        if c['campaignId'] == 'c_demo_redbull_edition':
            c['brief'].update({'details': 'A free upsize on every Frostline for Loyalty Gold members who buy cold drinks, shown only to them, in real time.',
                               'objective': 'Drive Sales', 'promotedProducts': ['Frostline Cola', 'Frostline Iced Tea'], 'targetAudiences': ['Loyalty Gold']})
            c['pricingType'] = 'personalised'; c['localisedVariables'] = []; c['localisedRuleLines'] = []
            c['personalisedVariables'] = ['Audience / Segments', 'Purchase History']
            c['personalisedRuleLines'] = ['Audience / Segments is Loyalty Gold', 'Purchase History includes Cold drinks']
    for cid in ('c_demo_redbull_portrait', 'c_demo_redbull_edition'):
        ap = R.get(f'/admin/v1/campaigns/{cid}/approval')
        if not ap: continue
        ap['canvas'] = {'width': 1920, 'height': 600}
        for ch in ap.get('checks', []):
            if ch['name'] == 'dimensions': ch['detail'] = '1920×600 matches the canvas'
            if ch['name'] == 'aspect_ratio': ch['detail'] = '3.20 matches the canvas'
        if cid == 'c_demo_redbull_edition':
            ap['targetingSummary'] = 'Default\nGold members (personalised): Audience / Segments is Loyalty Gold AND Purchase History includes Cold drinks'
    # ---------- rebrand ----------
    s = json.dumps(D, ensure_ascii=False)
    for a, b in [('Volt Energy — Charge at the chiller', 'Frostline Summer | Ice-cold refresh'),
                 ('Volt Energy — Summer Edition', 'Gold Members | Free Frostline upsize'),
                 ('Volt Energy — Summer Energy', 'Frostline Summer | Ice-cold refresh'),
                 ('Volt Energy Summer Edition 250ml', 'Frostline Cola 600ml'), ('Volt Energy 250ml', 'Frostline Cola 600ml'),
                 ('Volt Energy direct', 'Frostline direct'), ('Volt Energy', 'Frostline Cold Drinks'),
                 ('on the chiller screen.', 'on the cooler door screens.'), ('"menu_board"', '"landscape"')]:
        s = s.replace(a, b)
    return json.loads(s)

if __name__ == '__main__':
    for st, src in [('pre', 'predeal'), ('predeal', 'predeal'), ('draft', 'draft'), ('assigned', 'draft'), ('live', 'live'), ('dec', 'live')]:
        D = json.load(open(f'snap-lite-{src}.json'))
        out = transform(D, 'live' if st == 'dec' else st)
        if st == 'dec': out['capturedAt'] = '2026-12-01T03:00:00.000Z'  # the shopper journey happens in December
        json.dump(out, open(f'snap4-{st}.json', 'w'), ensure_ascii=False)
    for st in ['predeal', 'assigned', 'live', 'dec']:
        R = json.load(open(f'snap4-{st}.json'))['routes']
        print(st, [(x['name'], [(s['label'], s['owner']) for s in x['phExtensions']['slots']]) for x in R['/admin/v1/display-types']['items']][:1])
        print('  AI', [(x['playlistName'], x['slot'], x['assignedTo']['buyersListNames'], x['assignedTo']['partnerIds'], x['assignedTo']['openAuction']) for x in R['/admin/v1/available-inventory']['items']])
        print('  deals', [(b['name'], b['status'], len(b.get('assignedSlots') or []), b.get('committedPlays'), b['activeFrom'][:10], b['activeTo'][:10]) for b in R['/admin/v1/buyers-lists']['items']])
        bs = R['/admin/v1/booking-schedule']
        print('  BS', [(p['positionId'], ''.join('F' if (w.get('booking') or {}).get('advertiserId') == 'red-bull' else 'N' if (w.get('booking') or {}).get('advertiserId') == 'nestle' else 'T' if w.get('booking') else '.' for w in p['windows'])) for p in bs['positions']], bs['totals'])
        print('  adv', [a['name'] for a in R['/admin/v1/advertisers']['items']])
