"""Builds the retail media walkthrough into the shared tour source (tour.html from main).
Retailer screens are real DSP Integration prototype screenshots (img/*.jpg, 1600x950, the stage ratio);
PH Core campaign screens, the phone and the four-screen scene reuse the existing tour code.
Writes tour/tour-rm.html (full document) and tourart/index.html (review build for an artifact)."""
import json, re, os, sys

SRC = '../tour-main2.html'
HOT = json.load(open('steps5/hot.json'))
HOT['16b-booking-flight#rows'] = [275, 376, 1307, 368]
HOT['22-booking-revenue#total'] = [275, 890, 1307, 40]
_pop = HOT.get('16-booking-schedule#pop'); HOT['16-booking-schedule#top'] = [_pop[0], _pop[1], _pop[2], 140]
HOT['P1-display-types#list'] = [524, 212, 260, 342]  # all four display type cards, POS included
HOT['09-deal-live#row'][2] = 1058
HOT['07a-blank#deal'][2] = 1058
t = open(SRC, encoding='utf-8').read()

def rep(old, new, count=1):
    global t
    n = t.count(old)
    assert n >= 1, f'not found: {old[:90]!r}'
    if count == 1:
        assert n == 1, f'{n} matches: {old[:90]!r}'
    t = t.replace(old, new)

# ---------- detection, flows, data ----------
rep('const IS_CONV = /^\\/industries\\/convenience\\/tour(\\/|$)/.test(location.pathname);',
    'const IS_CONV = /^\\/industries\\/convenience\\/tour(\\/|$)/.test(location.pathname);\n'
    'const IS_RM = /^\\/industries\\/retail-media\\/tour(\\/|$)/.test(location.pathname) || window.PH_TOUR_IND === "retail-media" || /[?&]ind=retail-media(&|$)/.test(location.search);\n'
    '/* Screenshots and voiceover: on the live site tour.php serves them same-origin (sha-pinned); anywhere else (the train preview) they load from the pinned assets tag on GitHub. */\n'
    'const RM_ASSETS = window.PH_TOUR_ASSETS || (/^\\/industries\\/retail-media\\/tour(\\/|$)/.test(location.pathname) ? "/industries/retail-media/tour/assets/v1/" : "https://raw.githubusercontent.com/offline2online/rob_ph_demos/tour-assets-retail-media-v1/ph-website/tour-assets/retail-media/");\n'
    'const RM_IMG = window.PH_TOUR_IMG || RM_ASSETS + "img/";')
rep('const FLOWS = [', 'const FLOWS = IS_RM ? [\n  ["Retailer setup", true, "Playlists · direct deal"], ["Advertiser creates by talking", true, "Voice brief · targeting"], ["Shopper journey & outcome", true, "Forecourt to POS · bookings"]\n] : [')
RM_IND = r'''const IND = {
  /* Retail media: a fictional convenience retailer (the visitor's company replaces the name) sells its screens to a fictional
     cold drinks brand. adv is the advertiser's campaign, p3 its Gold members version. Deal and dates match the prototype screens. */
  "retail-media": {
    brand: "Larkspur Convenience", color: "#14507A", accent: "#F2A900", stores: 9, rows: [], thumbs: ["snow", "bolt", "snow", "bolt"],
    deal: "PH-Y86K9QMUH4",
    adv: {
      brand: "Frostline Cold Drinks", color: "#0A5C99", accent: "#E0393E",
      rows: [
        ["SCHEDULED", "Frostline Iced Tea | Back to school", "Lunchtime shoppers", ["tv"]],
        ["TARGETED", "Frostline Zero | Summer launch", "Soft drink buyers", ["tv"]]
      ],
      get brief() { return `Summer campaign for Frostline Cold Drinks on our direct deal with ${B()}: ice-cold Frostline Cola and Iced Tea on the forecourt, shop front, cooler door and POS screens, from 1 to 31 December, aimed at drivers and lunchtime shoppers.`; },
      name: "Frostline Summer | Ice-cold refresh",
      details: "Summer campaign for Frostline Cold Drinks on the retailer's forecourt, shop front, cooler door and POS screens. Creative leads with the refresh and points shoppers to the coolers.",
      products: ["Frostline Cola", "Frostline Iced Tea"], audience: ["Drivers", "Lunchtime shoppers"], objective: "Drive Sales",
      headline: "Stay ice cold this summer", sub: "Grab a Frostline on your way through*", legal: "*While stocks last. Participating stores only.",
      big: "ICE COLD", bigSub: "FROSTLINE SUMMER*", change: "Make the background brighter for daytime forecourts"
    },
    p3: { name: "Gold Members | Free Frostline upsize", details: "A free upsize on every Frostline for Loyalty Gold members who buy cold drinks, shown only to them, in real time.", headline: "Gold members get more", sub: "A free upsize on every Frostline*", big: "FREE UPSIZE", bigSub: "GOLD MEMBER BONUS*",
      legal: "*Loyalty Gold members only. While stocks last. Participating stores only.", audience: ["Loyalty Gold"] }
  },'''
rep('const IND = {', RM_IND)
rep('const IND_FROM_PATH = IS_CONV ? "convenience" :', 'const IND_FROM_PATH = IS_RM ? "retail-media" : IS_CONV ? "convenience" :')
rep('(S.ind === "pharmacy" ? "Pharmacy" : S.ind === "convenience"', '(IS_RM ? "Retail Media" : S.ind === "pharmacy" ? "Pharmacy" : S.ind === "convenience"')
rep('const INDLABEL = S.ind === "pharmacy"', 'const INDLABEL = IS_RM ? "retail media" : S.ind === "pharmacy"')
rep('const D = () => S.flow === 2 ? { ...IND[S.ind], ...IND[S.ind].p3 } : IND[S.ind];\nconst B = () => S.brand || D().brand;\nconst C = () => S.color || D().color;',
    'const RMI = () => IND["retail-media"];\n'
    'const D = () => IS_RM ? (S.flow === 0 ? RMI() : (S.flow === 2 || S.p3) ? { ...RMI(), ...RMI().adv, ...RMI().p3 } : { ...RMI(), ...RMI().adv }) : S.flow === 2 ? { ...IND[S.ind], ...IND[S.ind].p3 } : IND[S.ind];\n'
    '/* In retail media B and C are always the retailer (HQ Admin, loyalty app); ADV is the advertiser whose creative is drawn. */\n'
    'const B = () => S.brand || (IS_RM ? RMI().brand : D().brand);\n'
    'const C = () => S.color || (IS_RM ? RMI().color : D().color);\n'
    'const ADV = () => RMI().adv;\n'
    'const AB = () => IS_RM ? ADV().brand : B();')
rep('<circle cx="31" cy="9" r="5" fill="${D().accent}"/>', '<circle cx="31" cy="9" r="5" fill="${IS_RM ? RMI().accent : D().accent}"/>')
# a cold drinks illustration for the advertiser's creative
rep('function illo(x, y, s, a, dark) {\n', '''function illo(x, y, s, a, dark) {
  if (S.ind === "retail-media") return `<g transform="translate(${x} ${y + 6 * s}) scale(${s})">
    <circle cx="150" cy="80" r="76" fill="${a}" opacity=".22"/><ellipse cx="120" cy="230" rx="88" ry="9" fill="#000" opacity=".18"/>
    <path d="M96 14h40v26c0 10 22 22 22 46v128c0 10-8 16-16 16h-52c-8 0-16-6-16-16V86c0-24 22-36 22-46z" fill="#ffffff"/>
    <rect x="96" y="6" width="40" height="14" rx="4" fill="${a}"/><rect x="74" y="112" width="84" height="62" fill="${a}"/>
    <text x="116" y="150" text-anchor="middle" font-family="Roboto,Arial" font-weight="900" font-size="17" fill="#fff">ICE</text>
    <path d="M190 120l10 18M200 112l-4 22M214 128l-18 6" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity=".85"/>
    <path d="M40 150l10 18M50 142l-4 22M64 158l-18 6" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity=".6"/></g>`;
''')
# art(), thumbSVG(), promoHTML() draw the advertiser's brand in retail media
m = re.search(r'function art\(kind, variant, bright = S.bright, opts = \{\}\) \{.*?\n\}\nfunction thumbSVG', t, re.S)
body = m.group(0)
nb = body.replace('const d = D(), c = C(), a = d.accent;', 'const d = D(), c = IS_RM ? ADV().color : C(), a = IS_RM ? ADV().accent : d.accent;').replace('B()', 'AB()')
t = t.replace(body, nb)
rep('const c = C(), a = D().accent, ic = {', 'const c = IS_RM ? ADV().color : C(), a = IS_RM ? ADV().accent : D().accent, ic = {')
m = re.search(r'function thumbSVG\(kind\) \{.*?\n\}', t, re.S); t = t.replace(m.group(0), m.group(0).replace('initials(B())', 'initials(AB())'))
m = re.search(r'function promoHTML\(which\) \{.*?\n\}', t, re.S)
t = t.replace(m.group(0), m.group(0).replace('const d = D(), c = C(), a = d.accent, ini = esc(initials(B()))', 'const d = D(), c = IS_RM ? ADV().color : C(), a = IS_RM ? ADV().accent : d.accent, ini = esc(initials(AB()))').replace('${esc(B())}</div>`;', '${esc(AB())}</div>`;'))
# header: the advertiser's login is shown in the HQ Admin header
rep('<span class="env"><span class="ms" style="font-size:15px">rocket_launch</span>Production<span class="ms" style="font-size:14px">edit</span></span>',
    '${IS_RM && S.flow === 1 ? `<span class="env"><span class="ms" style="font-size:15px">badge</span>Advertiser · ${esc(ADV().brand)}</span>` : `<span class="env"><span class="ms" style="font-size:15px">rocket_launch</span>Production<span class="ms" style="font-size:14px">edit</span></span>`}')
rep('<b>${rows.length + 22}</b> Campaigns', '<b>${IS_RM ? rows.length : rows.length + 22}</b> Campaigns')
rep('["tv","language","storefront"], true]', '(IS_RM ? ["tv"] : ["tv","language","storefront"]), true]')
# brief: the deal's screen types and the deal-ID picker
rep('const tps = IS_CONV ? [["directions_car","Forecourt screens",true]', 'const tps = (IS_CONV || IS_RM) ? [["directions_car","Forecourt screens",true]')
rep('${F(0,`<label><i>*</i>Campaign Name</label>',
    '${IS_RM ? `<div class="f" id="f5"><label><i>*</i>Deal ID</label><div class="in dsel"><span>${esc(RMI().deal)}</span><span class="ms">expand_more</span></div></div>` : ""}${F(0,`<label><i>*</i>Campaign Name</label>')
rep('tip(q("#f1"),"Campaign brief",',
    'if (IS_RM) { tip(q("#f5"),"Deal ID, pre-selected","Frostline\'s deal with the retailer is pre-selected, and the drop-down lists only Frostline\'s own deals. Every campaign created on it is automatically associated with the slots assigned to that deal: slot 1 on Forecourt, Shop Front, Cooler Doors and POS.",3); await wait(5200,id); hideTip(); } tip(q("#f1"),"Campaign brief",')
rep('''tip(t,"Touchpoints",IS_CONV ? "Forecourt, shop front, cooler door and POS screens switched on from the brief." : "Digital signage, website and store sites switched on from the brief.",3); await wait(2800,id); hideTip(); } },''',
    '''tip(t,"Touchpoints",IS_RM ? "Only the deal's screen types, from the slots assigned to the deal: forecourt, shop front, cooler door and POS screens." : IS_CONV ? "Forecourt, shop front, cooler door and POS screens switched on from the brief." : "Digital signage, website and store sites switched on from the brief.",3); await wait(2800,id); hideTip(); } },''')
rep('<div class="assets">${IS_CONV ? `', '<div class="assets">${(IS_CONV || IS_RM) ? `')
rep('[3,IS_CONV ? "pos" : "store"]]) { setAsset(k,kind); await wait(560,id); }', '[3,(IS_CONV || IS_RM) ? "pos" : "store"]]) { setAsset(k,kind); await wait(560,id); }')
rep('tip(q("#ap0"),"Assets for every touchpoint",IS_CONV ?', 'tip(q("#ap0"),"Assets for every touchpoint",IS_RM ? "Creative for each screen type: forecourt, shop front, cooler doors and POS. Results from the approved, running campaign feed the agent\'s future campaigns in a closed loop." : IS_CONV ?')
rep('s:"Happy with the brief? Generate Storyboard & Copy writes the headline, sub-headline and legal copy from the brief and your brand guidelines.",', 's: IS_RM ? "Happy with the brief? The AI agent writes the headline, sub-headline and legal copy from the brief and the agreed brand guidelines: Frostline\'s, the retailer\'s, or an agreed variation of the two." : "Happy with the brief? Generate Storyboard & Copy writes the headline, sub-headline and legal copy from the brief and your brand guidelines.",')
rep('"Generating the preview","First and last frames are built from the storyboard, optimised on what has performed best in past campaigns."', '"Generating the preview",IS_RM ? "The AI agent builds the frames from the agreed brand guidelines, whether the advertiser\'s, the retailer\'s or an agreed variation of the two, optimised on what has performed best in past campaigns." : "First and last frames are built from the storyboard, optimised on what has performed best in past campaigns."')
rep('return shell(detailTop("Targeting", true, null)', 'return shell(detailTop("Targeting", !IS_RM, null)')
# targeting values are drop-downs in retail media: the retailer controls every value
rep('<span class="sel w4" id="s${id}d">${last}</span>', '<span class="sel w4" id="s${id}d">${last}${IS_RM ? `<span class="ms dchev">expand_more</span>` : ""}</span>')
rep('function detailTop(tab, on, cta) {', 'function rmStatusHTML() { return `<span class="muted">Status</span><span class="sd" style="background:${S.rmSent ? "#faad14" : "#bfbfbf"}"></span><b id="stt">${S.rmSent ? "Awaiting approval" : "Draft"}</b><span class="sfa ${S.rmSent ? "sent" : ""}" id="sfa"><span class="ms">${S.rmSent ? "hourglass_top" : "send"}</span>${S.rmSent ? "Sent for approval" : "Send for approval"}</span>`; }\nfunction detailTop(tab, on, cta) {')
rep('<div class="status"><span class="muted">Status</span><span class="sd" style="background:${on?"#52c41a":"#ff4d4f"}"></span><b id="stt">${on?"Activated - Running":"Not Activated"}</b><span class="sw ${on?"on":""}" id="sw"></span></div>', '<div class="status">${IS_RM && S.flow === 1 && !S.rmApproved ? rmStatusHTML() : `<span class="muted">Status</span><span class="sd" style="background:${on?"#52c41a":"#ff4d4f"}"></span><b id="stt">${on?"Activated - Running":"Not Activated"}</b><span class="sw ${on?"on":""}" id="sw"></span>`}</div>')
# persona and data aliases
rep('<div class="ph-date">Friday 6 November</div>', '<div class="ph-date">${IS_RM ? "Tuesday 8 December" : "Friday 6 November"}</div>')
rep('<b>Welcome to pump 4, ${p.person}</b>', '<b>Welcome to ${IS_RM ? esc(p.store) : "pump 4"}, ${p.person}</b>')
rep('const P3 = () => PERS[S.ind];', '''PERS["retail-media"] = { ...PERS.convenience, person: "Emma", reason: "Fuel and a cold drink", findAt: "at the coolers", email: "emma@example.com", look: ["#e0b49a","#6b3b1f","f"],
  ins: [["local_gas_station","Fuelling at pump 4"],["workspace_premium","Loyalty Gold"],["local_drink","Usually buys: cold drinks"],["sell","Offer shown: a free Frostline upsize"]],
  attrs: [["Location","Pump 4, Highway 9 Services","Pump check-in",0],["Check-in method","Loyalty app","Pump check-in",0],["Audience / Segments","Loyalty Gold","Retailer's loyalty program",1],["Purchase History","Cold drinks","Retailer's POS",1]],
  r2: ["Visitor / Customer Data","Purchase History","includes selected",["Cold drinks"]], r2mode: "tags", match: "Loyalty Gold and a cold drinks purchase history" };
LOC["retail-media"] = LOC.convenience;
const P3 = () => PERS[S.ind];''')
rep('.filter(x => (S.ind !== "pharmacy" && S.ind !== "convenience") ||', '.filter(x => (S.ind !== "pharmacy" && S.ind !== "convenience" && S.ind !== "retail-media") ||')

# ---------- the four-screen scene in retail media: three slots per rotation, slot 1 is the brand partner ----------
rep('''  const ad = (k, mode, i = 0) => {
    if (mode === "gen") { const g = GEN[k][i % 2]; return `<div class="cv-ad" style="background:${g[3]}"><span class="ms ic">${g[0]}</span><b>${g[1]}</b><small>${g[2]}</small></div>`; }
    const o = (mode === "cre" ? OFFER : PERS)[k];
    return `<div class="cv-ad ${mode}"><span class="tg"><span class="ms">${o.icon}</span>${esc(o.tag)}</span><b>${esc(o.head)}</b><small>${esc(o.sub)}</small>${cup}</div>`;
  };''', '''  if (IS_RM) {
    LOCS.splice(0, 4, { k: "fore", icon: "local_gas_station", name: "Forecourt", sub: "Fuel pumps" }, { k: "shop", icon: "storefront", name: "Shop Front", sub: "Entrance" },
      { k: "cool", icon: "kitchen", name: "Cooler Doors", sub: "Cold drinks" }, { k: "pos", icon: "point_of_sale", name: "POS", sub: "Checkout" });
    Object.assign(GEN, { fore: [["local_car_wash", "Car wash $8", "Fuel and car wash", "#27508f"], ["local_cafe", "Coffee + pastry $6", "Coffee and food", "#7a3b8f"]],
      shop: [["sell", "2 for $5 snacks", "Today's deals", "#1f6b5d"], ["propane_tank", "Gas bottle swap", "Store services", "#8a3a3a"]],
      cool: [["water_drop", "2 for $5 water", "Cold drink deals", "#2c4f9e"], ["lunch_dining", "Sandwich + drink $8", "Meal deals", "#5b3a8c"]],
      pos: [["add_shopping_cart", "Add a chocolate bar, $1", "Add-on offers", "#6a3d8f"], ["loyalty", "Earn double points", "Loyalty app", "#9a4a14"]] });
    Object.assign(OFFER, { fore: { icon: "ac_unit", tag: "Frostline", head: "Stay ice cold this summer", sub: "Frostline Cola, cold inside" },
      shop: { icon: "ac_unit", tag: "Frostline", head: "Stay ice cold this summer", sub: "Grab a Frostline on your way through" },
      cool: { icon: "ac_unit", tag: "Frostline", head: "Ice-cold Frostline", sub: "Cola and Iced Tea, right here" },
      pos: { icon: "ac_unit", tag: "Frostline", head: "Add an ice-cold Frostline", sub: "Cola and Iced Tea at the counter" } });
    Object.assign(PERS, { fore: { icon: "workspace_premium", tag: "Gold member · Pump 4", head: "Welcome back, Emma", sub: "A free Frostline upsize is waiting inside" },
      shop: { icon: "workspace_premium", tag: "Just for you", head: "Emma, your Gold upsize is waiting", sub: "Frostline is in the coolers, to your right" },
      cool: { icon: "workspace_premium", tag: "Gold member offer", head: "Free upsize on every Frostline", sub: "1.25L for the price of 600ml" },
      pos: { icon: "workspace_premium", tag: "Upsize applied", head: "Frostline Cola 1.25L", sub: "Emma, your Gold upsize saved you $2.00" } });
  }
  const bottle = `<svg class="cup" viewBox="0 0 120 90" aria-hidden="true"><ellipse cx="60" cy="84" rx="40" ry="5" fill="rgba(0,0,0,.25)"/><path d="M70 4h14v10c0 4 8 8 8 16v48c0 4-3 6-6 6H68c-3 0-6-2-6-6V30c0-8 8-12 8-16z" fill="#fff"/><rect x="62" y="40" width="30" height="22" fill="#E0393E"/><path d="M28 34l6 10M34 30l-2 14M42 38l-10 4" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/></svg>`;
  const ad = (k, mode, i = 0) => {
    const sl = IS_RM ? `<span class="sl">${mode === "gen" ? `Slot ${(i % 2) + 2} · ${esc(B())}` : "Slot 1 · Brand partner"}</span>` : "";
    if (mode === "gen") { const g = GEN[k][i % 2]; return `<div class="cv-ad" style="background:${g[3]}"><span class="ms ic">${g[0]}</span><b>${g[1]}</b><small>${g[2]}</small>${sl}</div>`; }
    const o = (mode === "cre" ? OFFER : PERS)[k];
    return `<div class="cv-ad ${mode}"><span class="tg"><span class="ms">${o.icon}</span>${esc(o.tag)}</span><b>${esc(o.head)}</b><small>${esc(o.sub)}</small>${IS_RM ? bottle : cup}${sl}</div>`;
  };''')
rep('const root = inner => `<div class="cv" style="--cva:${D().accent}">${inner}</div>`;', 'const root = inner => `<div class="cv${IS_RM ? " rm" : ""}" style="--cva:${D().accent}">${inner}</div>`;')
rep('const rotate = (i) => LOCS.forEach(l => setTile(l.k, "gen", i));', 'const rotate = (i) => LOCS.forEach(l => IS_RM && i % 3 === 0 ? setTile(l.k, "cre") : setTile(l.k, "gen", IS_RM ? (i % 3) - 1 : i));')
rep('<div class="cv-me" id="cvme" style="left:${CENTERS[0]}px"><i>S</i></div>', '<div class="cv-me" id="cvme" style="left:${CENTERS[0]}px"><i>${esc(P3().person[0])}</i></div>')
rep('const scene4 = (mode) => root(head("The shopper journey") + title("Sam\'s offer follows her through the shop") + stops() + row(mode || "cre", 0));',
    'const scene4 = (mode) => root(head("The shopper journey") + title(IS_RM ? "Emma\'s Frostline offer follows her through the shop" : "Sam\'s offer follows her through the shop") + stops() + row(mode || "cre", 0));')
RMSTEP = '''  const RMSTEP = {
    t: "Frostline's offer follows Emma", s: "Every screen rotates three campaigns: two for the retailer and the brand partner slot. Once Emma is recognised at pump 4, the brand partner slot plays Frostline's Gold version for her on every screen she passes.",
    enter() { screen.innerHTML = scene4("gen"); hideTip(); },
    async play(id) { await wait(900, id);
      for (let i = 1; i <= 3; i++) { rotate(i); await wait(1400, id); }
      tip(q("#cvrow"), "Three campaigns in every rotation", "Slots 2 and 3 play the retailer's own campaigns. Slot 1, the brand partner slot, plays Frostline's campaign.", 3); await wait(4000, id); hideTip();
      LOCS.forEach(l => setTile(l.k, "cre")); await wait(700, id);
      q("#cvtrack").insertAdjacentHTML("beforeend", `<div class="cv-rec" id="cvrec" style="left:${CENTERS[0]}px"><span class="ms">workspace_premium</span>Emma · Gold member recognised at pump 4</div>`);
      await visit(0, id, true);
      tip(q("#cvl-fore"), "Recognised at the pump", "Emma's loyalty app checks her in. When the brand partner slot comes round, the forecourt screen plays Frostline's Gold version for her.", 3); await wait(4200, id); hideTip();
      q("#cvrec").remove(); await visit(1, id);
      tip(q("#cvl-shop"), "At the shop front", "The same campaign, still speaking to a Gold member, points her to the coolers.", 3); await wait(3600, id); hideTip();
      await visit(2, id);
      tip(q("#cvl-cool"), "At the cooler doors", "Right where the drinks are: a free upsize on every Frostline.", 3); await wait(3600, id); hideTip();
      await visit(3, id);
      tip(q("#cvl-pos"), "At the POS", "The upsize is applied at the till. Everyone who isn't a Gold cold drinks buyer sees Frostline's default version.", 3); await wait(4200, id); hideTip(); } };
'''
rep('  const TEASE = [{ cap: "The offer follows a loyalty member from the pump to the till", async run(id) {', RMSTEP + '  const TEASE = [{ cap: "The offer follows a loyalty member from the pump to the till", async run(id) {')
rep('  return { STEP, TEASE };\n})();', '  return { STEP, TEASE, RMSTEP };\n})();')
rep('const TEASE = [{ cap: "The offer follows a loyalty member from the pump to the till", async run(id) {', 'const TEASE = [{ cap: IS_RM ? "One brand partner slot in every rotation, personalised for a loyalty member" : "The offer follows a loyalty member from the pump to the till", async run(id) {')

# ---------- retail media flows: real prototype screens for the retailer, PH Core screens for the advertiser ----------
VO_MAN = json.load(open('tourart/vo/manifest.json', encoding='utf-8'))
VO_DATA = {k: [{'file': l['file'], 'text': l['text'], 'duration': l['duration'], 'cue': l.get('cue')} for l in v] for k, v in VO_MAN.items()}
VO_CODE = r'''
/* ================= retail media voiceover =================
   Each step has one or more lines (vo/<step>-<line>-<hash>.mp3, built offline with Kokoro by build_voiceover.py), played
   through a single audio element so two lines can never overlap. A line without a cue starts the step or follows the
   line before it; a line with a cue starts when the tip with that title appears. If a cue comes while a line is still
   playing, the tour holds (S.voHold stops wait() counting) until the line ends, so words and screens stay in step.
   Off by default: it only turns on from the speaker button, and the choice is remembered. The current line is also the
   caption under the tour, timed the same way, so the tour reads the same with audio off. */
const VO = IS_RM ? (() => {
  const CLIPS = __VO__, BASE = window.PH_TOUR_VO || RM_ASSETS + "vo/", KEY = "ph_tour_voiceover", GAP = 160;
  const grp = document.getElementById("vogrp"), btn = document.getElementById("vo");
  let on = false; try { on = localStorage.getItem(KEY) === "on"; } catch (e) {}
  const a = new Audio(); a.preload = "auto";
  let st = null, tok = 0, stall = 0;
  const keyOf = (f = S.flow, i = S.step) => i < 0 ? null : `f${f + 1}-${String(i + 1).padStart(2, "0")}`;
  const log = (ev, x) => { if (window.PH_TOUR_VO_DEBUG) (window.__voLog = window.__voLog || []).push({ ev, t: Math.round(performance.now()), ...x }); };
  const warmed = new Set();
  const warm = () => { if (!on) return; for (let i = 0; i < 30; i++) (CLIPS[keyOf(S.flow, i)] || []).forEach(c => { if (!warmed.has(c.file)) { warmed.add(c.file); fetch(BASE + c.file).catch(() => warmed.delete(c.file)); } }); };
  const caption = t => { const el = document.getElementById("capS"); if (el && t) el.textContent = t; };
  const setHold = () => { S.voHold = !!(st && on && st.q.length); };
  function paint() {
    grp.hidden = false; btn.classList.toggle("on", on); btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", on ? "Turn voiceover off" : "Turn voiceover on");
    btn.innerHTML = `<span class="ms">${on ? "volume_up" : "volume_off"}</span>`;
  }
  function stop() { tok++; a.pause(); if (st) log("stop", { k: st.k }); st = null; S.voHold = false; }
  function step() {
    stop(); const k = keyOf(), lines = CLIPS[k];
    if (!lines) return;
    st = { k, lines, i: -1, busy: false, gap: false, q: [], t: tok };
    warm();
    if (!lines[0].cue) play(0);
  }
  function play(j) {
    const L = st.lines[j], t = st.t;
    st.i = j; st.busy = true; st.gap = false; stall = 0; setHold();
    caption(L.text); log("start", { k: st.k, j });
    if (on) {
      a.src = BASE + L.file;
      if (!S.paused && !document.hidden) a.play().catch(err => { log("blocked", { k: st && st.k, j, err: err.name }); if (st && st.t === t && st.i === j) timer(t, j, L.duration); });
    } else timer(t, j, L.duration);
  }
  function timer(t, j, secs) {   /* captions only: the line "plays" for its own length, pausing with the tour */
    let left = secs * 1000;
    const tick = () => { if (!st || st.t !== t || st.i !== j || !st.busy) return; if (!S.paused) left -= 100; if (left <= 0) finished(t, j); else setTimeout(tick, 100); };
    setTimeout(tick, 100);
  }
  function finished(t, j) {
    if (!st || st.t !== t || st.i !== j || !st.busy) return;
    st.busy = false; log("ended", { k: st.k, j });
    const chained = j + 1 < st.lines.length && !st.lines[j + 1].cue && !st.q.length ? j + 1 : null;
    const nx = chained != null ? chained : st.q.length ? st.q.shift() : null;
    if (nx == null) { setHold(); return; }
    st.gap = true;
    setTimeout(() => { if (st && st.t === t && st.gap) play(nx); }, on ? GAP : 0);
  }
  function cue(title) {
    if (!st) return;
    const from = Math.max(st.i, ...st.q) + 1;
    const j = st.lines.findIndex((L, x) => x >= from && L.cue === title);
    if (j < 0) return;
    log("cue", { k: st.k, j, title });
    if (on && (st.busy || st.gap)) { st.q.push(j); setHold(); log("hold", { k: st.k, j }); }   /* the screen waits for the line before it */
    else { st.q = []; st.busy = false; play(j); }   /* captions only: go straight to the cued line */
  }
  function sync() {
    if (!st || !st.busy || !on) return;
    if (S.paused || document.hidden) a.pause(); else a.play().catch(() => {});
  }
  async function done(id) {   /* hold the step until its last line has finished */
    while (on && st && (st.busy || st.gap || st.q.length)) await wait(100, id);
  }
  a.addEventListener("playing", () => st && log("playing", { k: st.k, j: st.i }));
  a.addEventListener("ended", () => st && finished(st.t, st.i));
  a.addEventListener("error", () => st && finished(st.t, st.i));
  setInterval(() => {   /* a line that stalls never blocks the tour */
    if (on && st && st.busy && !S.paused && !document.hidden && (a.paused || a.readyState < 3)) { if (++stall > 12) { log("stalled", { k: st.k, j: st.i }); finished(st.t, st.i); } }
    else stall = 0;
  }, 250);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pagehide", stop);
  btn.addEventListener("click", () => {
    on = !on; try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) {}
    log("toggle", { on }); paint();
    if (!st) return;
    if (on) { warm(); if (st.busy) play(st.i); }
    else { a.pause(); st.q = []; S.voHold = false; if (st.busy) finished(st.t, st.i); }
  });
  S.voCue = cue;
  paint();
  return { step, stop, sync, done, warm, get on() { return on; },
    text: (f, i) => { const k = keyOf(f, i); return st && st.k === k && st.i >= 0 ? st.lines[st.i].text : ((CLIPS[k] || [])[0] || {}).text; } };
})() : null;
'''.replace('__VO__', json.dumps(VO_DATA, ensure_ascii=False))
RM_CODE = r'''
/* ================= retail media: a convenience retailer sells its screens to a brand =================
   Retailer steps are screenshots of HQ Admin's retail media screens (img/*.jpg, 1600x950 = the stage at 0.8);
   HOT holds each screenshot's click target and the regions the tips point at. Advertiser steps reuse the PH Core campaign screens. */
const RM = IS_RM ? (() => {
  const SC = 0.8, HOT = __HOT__;
  const img = n => RM_IMG + n + ".jpg";
  Object.keys(HOT).filter(k => !k.includes("#")).forEach(n => { const i = new Image(); i.src = img(n); });
  /* The screenshots were taken with the demo retailer's logo (sidebar and header badge, same place on every screen).
     When the visitor's company or colour differs, both are redrawn over the screenshot in its own pixel space. */
  const brandOv = () => {
    const b = B(), c = C(); if (b === RMI().brand && c === RMI().color) return "";
    const w = b.trim().split(/\s+/), ini = esc(initials(b)), l2 = w.slice(1).join(" ");
    return `<div class="rm-ov" aria-hidden="true"><div class="rm-ovb"><span class="rm-ovm" style="background:${c}">${ini}</span><span class="rm-ovn"><b>${esc(w[0])}</b>${l2 ? `<small>${esc(l2)}</small>` : ""}</span></div><div class="rm-ova"><span class="rm-ovm sm" style="background:${c}">${ini}</span></div></div>`;
  };
  const show = n => { screen.innerHTML = `<div class="rm-shot"><img src="${img(n)}" alt="" draggable="false">${brandOv()}</div>`; hideTip(); };
  const hs = (key, pad = 0) => { const b = HOT[key], x = Math.max(0, b[0] - pad), y = Math.max(0, b[1] - pad), w = Math.min(1600 - x, b[2] + 2 * pad), h = Math.min(950 - y, b[3] + 2 * pad), id = "hs" + (++gid);
    screen.insertAdjacentHTML("beforeend", `<div class="rm-hs" id="${id}" style="left:${x * SC}px;top:${y * SC}px;width:${w * SC}px;height:${h * SC}px"></div>`); return q("#" + id); };
  const RET = () => esc(B());
  const toast = (msg) => { screen.insertAdjacentHTML("beforeend", `<div class="toast rm-toast"><span class="ms">check_circle</span>${msg}</div>`); };
  const login = (typed) => `<div class="rm-login"><div class="rl-bg" style="background-image:url('${RM_IMG}login-bg.jpg')"></div>
    <div class="rl-brand"><svg width="26" height="26" viewBox="0 0 40 40" aria-hidden="true"><rect x="2" y="2" width="7" height="30" fill="#169BC2"/><rect x="9" y="2" width="29" height="7" fill="#EF60A7"/><rect x="31" y="9" width="7" height="29" fill="#FE9226"/><rect x="2" y="31" width="29" height="7" fill="#60D838"/></svg><span>Personalisation<b>Hub</b></span></div>
    <div class="rl-card"><div class="rl-logo">${logoSVG(38)}<span>${RET()}</span></div><h3>Login to your platform</h3>
      <div class="rl-lab"><span><i>*</i>Email</span><span class="ms">info</span></div><div class="in" id="lem">${typed ? "alex@frostline-drinks.example" : "&nbsp;"}</div>
      <div class="rl-lab"><span><i>*</i>Password</span><span class="ms">info</span></div><div class="in" id="lpw">${typed ? "••••••••••" : "&nbsp;"}</div>
      <div class="rl-row"><span><span class="rl-cb"></span>Remember me</span><b>Forgot password?</b></div>
      <span class="rl-btn" id="lsign">Login</span>
      <div class="rl-pow">Powered by <svg width="15" height="15" viewBox="0 0 40 40" aria-hidden="true"><path d="M2 2h36v36H2z" fill="none" stroke="#9a9a9a" stroke-width="7"/></svg><span>Personalisation<b>Hub</b></span></div></div></div>`;
  /* only what the retailer has approved for advertisers appears in the targeting drop-downs */
  const RM_SRC = ["Store / Location Data", "Visitor / Customer Data"];
  const RM_ATTR = ["Audience / Segments", "Purchase History", "Visitor Type (Individual)"];
  const RM_PH = ["Cold drinks", "Hot drinks", "Snacks", "Meal deals", "Fuel"];
  const W = st => ({ ...st, enter() { S.p3 = false; S.rmSent = false; S.rmApproved = false; st.enter.call(this); } });

  const F1 = [
   { t: "The retailer's four screen types", s: "Platform Admin → Display Types: Forecourt (fuel pumps), Shop Front, Cooler Doors and POS. Each screen type has its own playlist.",
     enter() { show("P1-display-types"); },
     async play(id) { await wait(600, id); tip(hs("P1-display-types#list", 8), this.t, this.s, 1); await wait(3800, id); hideTip(); await click(hs("P1-display-types"), id); show("P2-playlists"); } },
   { t: "Three slots, slot 1 for advertisers", s: "Open the Forecourt playlist, set Maximum Campaigns Played In Rotation to 3, then change slot 1's owner from Headquarters to Advertiser.",
     enter() { show("P2-playlists"); },
     async play(id) { await wait(400, id); await click(hs("P2-playlists", 6), id);
       show("P2b-expanded"); await wait(400, id); const mx = hs("P2b-expanded"); tip(mx, "Three campaigns in rotation", "Open Maximum Campaigns Played In Rotation and choose 3.", 2); await wait(2400, id); hideTip(); await click(mx, id);
       show("P3-three-slots"); await wait(400, id); await click(hs("P3-three-slots"), id);
       show("P4a-slots"); await wait(400, id); tip(hs("P4a-slots#table", 8), "Three slots, all Headquarters", "The playlist now has three slots. Every new slot starts owned by Headquarters, for the retailer's own campaigns.", 2); await wait(3400, id); hideTip();
       const ow = hs("P4a-slots"); tip(ow, "Slot 1 goes to advertisers", "Open slot 1's Owner drop-down. Only slot 1 changes.", 2); await wait(2600, id); hideTip(); await click(ow, id);
       show("P4-owner"); await wait(400, id); const a = hs("P4-owner"); tip(a, "From Headquarters to Advertiser", "Choose Advertiser for slot 1.", 2); await wait(2200, id); hideTip(); await click(a, id);
       show("P5-forecourt"); await wait(500, id); tip(hs("P5-forecourt#slots", 8), "One advertiser slot in three", "Slot 1, Brand partner, is sold to advertisers. Slots 2 and 3 stay with Headquarters for the retailer's own campaigns.", 2); await wait(3600, id); hideTip(); } },
   { t: "The same on every screen type", s: "Shop Front, Cooler Doors and POS get the same three slots, slot 1 Advertiser. Then Save changes.",
     enter() { show("P5-forecourt"); },
     async play(id) { await wait(300, id); await click(hs("P5-forecourt", 6), id); show("P6-shopfront"); await wait(400, id);
       tip(hs("P6-shopfront#slots", 8), this.t, this.s, 3); await wait(2800, id); hideTip();
       await click(hs("P6-shopfront", 6), id); show("P7-coolers"); await wait(500, id);
       await click(hs("P7-coolers", 6), id); show("P8-pos"); await wait(500, id);
       await click(hs("P8-pos"), id);
       show("P9-saved"); await wait(500, id); tip(hs("P9-saved#badges", 8), "Four advertiser slots, ready to sell", "Every playlist reads 3 slots · 2 Headquarters · 1 Advertiser: one advertiser slot per screen type.", 3); await wait(3800, id); hideTip(); } },
   { t: "The advertiser is already set up", s: "Advertisers / Inventory lists Frostline Cold Drinks as a direct advertiser, next to the advertisers synced from DSPs.",
     enter() { show("P9-saved"); },
     async play(id) { await wait(400, id); await click(hs("P9-saved"), id); show("01-advertiser"); await wait(500, id); tip(hs("01-advertiser#row", 4), this.t, this.s, 5); await wait(3800, id); hideTip(); } },
   { t: "Create a direct deal", s: "Deal type Direct advertiser, one buyer (Frostline Cold Drinks), flight 9 Nov to 8 Dec, Fixed CPM USD 150. A direct deal is never sent to a DSP.",
     enter() { show("05-deals"); },
     async play(id) { await wait(500, id); const o = hs("05-deals"); tip(o, "Slots are sold through deals", "An advertiser never gets a slot by name. Open New deal and buyers list.", 6); await wait(3000, id); hideTip(); await click(o, id);
       show("06-new-deal"); await wait(500, id); tip(hs("06-new-deal#terms", 8), this.t, this.s, 6); await wait(4200, id); hideTip(); await click(hs("06-new-deal"), id); show("07a-blank"); toast("Deal saved as draft"); } },
   { t: "Put the deal on all four slots", s: "The four new brand partner slots start unassigned, not offered to any buyer. Open Assigned to on each one and choose Frostline direct.",
     enter() { show("07a-blank"); },
     async play(id) { await wait(500, id); tip(hs("07a-blank#cells", 6), this.t, this.s, 6); await wait(4000, id); hideTip();
       tip(hs("07a-blank#deal", 4), "The new deal, not on a slot yet", "Frostline direct is saved as a draft. Its Slots column reads Not assigned.", 6); await wait(3200, id); hideTip();
       await click(hs("07a-blank"), id); show("07-assign-slot"); await wait(400, id);
       tip(hs("07-assign-slot#menu", 4), "Choose the deal", "Assigned to lists DSPs for open auction, then deals and buyers lists. Choose Frostline direct.", 6); await wait(3200, id); hideTip();
       await click(hs("07-assign-slot"), id); show("07c1"); await wait(300, id);
       for (const [c, d, nx] of [["07c1", "07d2", "07c2"], ["07c2", "07d3", "07c3"], ["07c3", "07d4", "07b-assigned-all"]]) {
         await click(hs(c), id); show(d); await wait(250, id); await click(hs(d), id); show(nx); await wait(250, id); }
       tip(hs("07b-assigned-all#cells", 6), "All four brand partner slots", "Each slot is assigned to Frostline direct, and the deal now shows 4 slots. Save changes.", 6); await wait(3600, id); hideTip(); await click(hs("07b-assigned-all"), id); toast("Changes saved"); await wait(1200, id); } },
   { t: "Finalise and go live", s: "This is a direct buy, not a programmatic guaranteed deal: Frostline pays USD 150 CPM for the four slots across December. Finalise deal terms and the deal is live inside Personalisation Hub.",
     enter() { show("08-deal-finalise"); },
     async play(id) { await wait(500, id); tip(hs("08-deal-finalise#plays", 8), "Plays, for reference", "The forecast plays for the four slots across December, shown for reference. Committed plays matter for programmatic guaranteed deals; this direct buy is priced at a fixed CPM.", 7); await wait(4600, id); hideTip();
       tip(hs("08-deal-finalise"), this.t, this.s, 7); await wait(3200, id); hideTip(); await click(hs("08-deal-finalise"), id);
       show("09-deal-live"); await wait(500, id); tip(hs("09-deal-live#row", 4), "Live · direct, not sent to a DSP", "Every window from 1 to 31 December is reserved for Frostline on all four screen types.", 7); await wait(3800, id); hideTip(); } },
   { t: "Give Frostline its own login", s: "Company Settings → Add Users / Advertisers: the retailer adds Frostline's user with the Advertiser role. Frostline gets its own login credentials and can manage its own campaigns, or leave them to the retailer.",
     enter() { show("03-users"); },
     async play(id) { await wait(500, id); const a = hs("03-users"); tip(a, this.t, this.s, 8); await wait(4400, id); hideTip(); await click(a, id);
       show("04-add-user"); await wait(500, id); tip(hs("04-add-user#form", 8), "An Advertiser login for Frostline", "Alex Morgan, role Advertiser, linked to Frostline Cold Drinks (Direct). Alex sees and manages only Frostline's campaigns.", 8); await wait(4400, id); hideTip();
       const b = hs("04-add-user"); tip(b, "Send the invitation", "Alex gets an invitation email to set up Frostline's own login credentials.", 8); await wait(2800, id); hideTip(); await click(b, id);
       toast("Invitation sent to alex@frostline-drinks.example"); await wait(2000, id); if (VO) await VO.done(id); showEnd(); } }
  ];

  const F2 = [
   { t: "Frostline signs in with its own login", s: "Alex signs in with the login credentials the retailer gave Frostline. Frostline can manage its own campaigns here, or leave them to the retailer. Everything Alex sees is scoped to Frostline Cold Drinks.",
     enter() { S.p3 = false; S.rmSent = false; S.rmApproved = false; screen.innerHTML = login(false); hideTip(); },
     async play(id) { await wait(500, id); const e = q("#lem"); await click(e, id); tip(e, this.t, this.s, 1); await typeInto(e, "alex@frostline-drinks.example", id, reduce ? 999 : 40); await wait(4200, id); hideTip();
       const p = q("#lpw"); await click(p, id); await typeInto(p, "••••••••••", id, reduce ? 999 : 30); await click(q("#lsign"), id);
       paint(listScreen(false)); await wait(600, id); tip(q(".grid"), "Only Frostline's campaigns", "Campaigns shows Frostline's own campaigns and nothing of the retailer's or any other brand's.", 1); await wait(3400, id); hideTip(); } },
   ...STEPS.slice(0, 6).map(W),
   { t: "Target Loyalty Gold members", s: "Alex opens the Gold Members campaign's Targeting tab and adds rules exactly the way the retailer does: Audience / Segments includes Loyalty Gold.",
     enter() { S.p3 = true; S.rmSent = false; S.rmApproved = false; paint(briefScreen(6, false)); },
     async play(id) { const p = P3(), r = p.r1; await wait(500, id);
       tip(q("#ctitle"), "The Gold members version", `${D().name} is a second campaign on the same deal, only for Loyalty Gold members.`, 8); await wait(3600, id); hideTip();
       const tt = q('[data-tab="Targeting"]'); tip(tt, "Open the Targeting tab", "Targeting rules are set per campaign, on its Targeting tab.", 8); await wait(2400, id); hideTip(); await click(tt, id);
       paint(targetScreen([])); await wait(600, id);
       const tb = q("#addand"); await moveTo(tb, id); tip(tb, this.t, this.s, 8); await wait(3200, id); hideTip(); await click(tb, id);
       q("#rules").innerHTML = rulesHTML([[,,,[]]]); await focusRow(q("#rg0"), id);
       await pick(q("#s0a"), RM_SRC, r[0], id); setSel("#s0a", r[0]);
       await pick(q("#s0b"), RM_ATTR, r[1], id); setSel("#s0b", r[1]);
       await pick(q("#s0c"), OPS.seg, r[2], id); setSel("#s0c", r[2]);
       await pick(q("#s0d"), p.reasons, r[3][0], id); addTag("#s0d", r[3][0]);
       tip(q("#rg0"), "Controlled by the retailer", `Every targeting criterion shared with advertisers is 100% controlled by ${RET()}. Frostline only sees the data sources, attributes and values the retailer has approved, always as drop-down menus.`, 8); await wait(4800, id); hideTip();
       tip(q("#rg0"), "The retailer's loyalty tiers", `The values come from ${RET()}'s loyalty program. The data stays in the retailer's cloud; the advertiser only picks the segment.`, 8); await wait(3600, id); hideTip(); } },
   { t: "Add purchase history", s: "A second rule from the retailer's POS data: Purchase History includes Cold drinks. Then Send for approval submits the campaign to the retailer.",
     enter() { S.p3 = true; S.rmSent = false; S.rmApproved = false; paintRules(targetScreen([P3().r1])); },
     async play(id) { const p = P3(), r = p.r2;
       const tb = q("#addand"); await moveTo(tb, id); tip(tb, this.t, this.s, 9); await wait(3200, id); hideTip(); await click(tb, id);
       q("#rules").innerHTML = rulesHTML([p.r1, [,,,[]]]); await focusRow(q("#rg1"), id);
       await pick(q("#s1a"), RM_SRC, r[0], id); setSel("#s1a", r[0]);
       await pick(q("#s1b"), RM_ATTR, r[1], id); setSel("#s1b", r[1]);
       await pick(q("#s1c"), OPS.seg, r[2], id); setSel("#s1c", r[2]);
       await pick(q("#s1d"), RM_PH, r[3][0], id); addTag("#s1d", r[3][0]); await wait(300, id);
       tip(q("#rules"), "Both rules in place", `A visitor matches when both are true: ${p.match}. Save Changes stores the targeting.`, 9); await wait(3600, id); hideTip();
       const sv = q("#save"); await click(sv, id); sv.className = "btn dis"; sv.nextElementSibling.className = "btn dis"; toast("Targeting saved"); await wait(900, id);
       const sf = q("#sfa"); await reveal(sf, id); tip(sf, "Send for approval", "Saving doesn't submit the campaign. Until the retailer approves it, Send for approval takes the place of the activation toggle.", 9); await wait(3800, id); hideTip(); await click(sf, id);
       S.rmSent = true; sf.parentElement.innerHTML = rmStatusHTML(); await wait(400, id);
       tip(q("#stt").parentElement, "Awaiting approval", "The campaign is with the retailer. There's no activation toggle until it's approved.", 9); await wait(3600, id); hideTip(); } },
   { t: "The retailer approves", s: "In the retailer's Campaign Approval, the Gold Members campaign is awaiting approval. Activation stays off until it's approved.",
     enter() { S.p3 = true; S.rmSent = true; S.rmApproved = false; show("14-approval-table"); },
     async play(id) { await wait(500, id); tip(hs("14-approval-table#row", 4), this.t, this.s, 10); await wait(3800, id); hideTip(); await click(hs("14-approval-table", 4), id);
       show("15-approve"); await wait(500, id); const o = hs("15-approve"); tip(o, "Approve Selected", "Approving gives the campaign a creative ID.", 10); await wait(3200, id); hideTip(); await click(o, id);
       toast("Campaign approved"); await wait(1500, id);
       S.rmApproved = true; paint(targetScreen([P3().r1, P3().r2])); await wait(500, id);
       const sw = q("#sw"); await reveal(sw, id); tip(sw, "Ready to activate", "Now that it's approved, the activation toggle replaces Send for approval.", 10); await wait(4000, id); hideTip();
       if (VO) await VO.done(id); showEnd(); } }
  ];

  const F3 = [
   { t: "Emma checks in at the pump", s: "Loyalty members check in at the pump with the retailer's app, their card or a QR code. Each check-in identifies them, so the screens can respond.",
     enter() { screen.innerHTML = sceneHTML(P3().first); hideTip(); },
     async play(id) { const p = P3(); await wait(700, id);
       const n = q("#pnote"); n.classList.add("in"); await wait(900, id);
       tip(q("#pmeth"), this.t, this.s, 1); await wait(3400, id); hideTip();
       tip(n, `Welcome to ${p.store}`, `${p.person}'s phone is detected as she pulls in to ${p.store}, and ${RET()}'s loyalty app welcomes her and invites her to check in.`, 1); await wait(3200, id); hideTip();
       await click(n, id); setPhone("pump"); await wait(900, id);
       tip(q("#pcheck"), "Checked in", `${p.person} is checked in at ${p.store} at ${p.time} AM as a Gold member.`, 1); await wait(2800, id); hideTip();
       tip(q("#pcard"), "Frostline's offer, in the retailer's app", `The moment she checks in, ${D().name} is first in her app.`, 1); await wait(3200, id); hideTip(); } },
   { t: "Her profile meets Frostline's rules", s: "The check-in links to what the retailer's loyalty program and POS already hold, checked against every campaign's targeting rules the moment she arrives.",
     enter() { screen.innerHTML = sceneHTML("pump", "attrs"); hideTip(); },
     async play(id) { const p = P3(); await wait(1700, id); tip(q("#ptbl"), this.t, "Each row is a Visitor / Customer Data attribute, checked against the campaign's visitor rules.", 2); await wait(4200, id); hideTip();
       tip(q("#ptbl"), "A match on both rules", `She matches both rules of Frostline's Gold Members campaign: ${p.match}.`, 2); await wait(3600, id); hideTip(); } },
   CV.RMSTEP,
   { t: "Booked on all four screen types", s: "The retailer's booking schedule: for all of December, Frostline Cold Drinks (Direct) holds slot 1 on Forecourt, Shop Front, Cooler Doors and POS. No bid request goes to any DSP for these windows.",
     enter() { show("16b-booking-flight"); },
     async play(id) { await wait(600, id); tip(hs("16b-booking-flight#rows", 4), this.t, this.s, 4); await wait(4200, id); hideTip();
       await moveTo(hs("16-booking-schedule"), id); show("16-booking-schedule"); await wait(400, id);
       tip(hs("16-booking-schedule#top", 4), "Default plus personalised", "Each booking holds the default and the personalised Gold version, both approved, with the booking value at the deal's CPM.", 4); await wait(4000, id); hideTip(); } },
   { t: "What the brand partner slots earn", s: "Booking revenue for 1 to 14 December: all 56 windows booked by Frostline at USD 150 CPM across the four screen types, 100% sold.",
     enter() { show("22-booking-revenue"); },
     async play(id) { await wait(600, id); tip(hs("22-booking-revenue#table", 6), this.t, this.s, 5); await wait(4600, id); hideTip();
       tip(hs("22-booking-revenue#total", 4), "USD 67,494 in two weeks", "Estimated revenue from the four brand partner slots. Direct deals are reported like DSP revenue; invoicing happens outside the platform.", 5); await wait(4200, id); hideTip(); if (VO) await VO.done(id); showEnd(); } }
  ];

  const FLOWDEF = [
    { h1: "Sell your screens to brands", sub: "A convenience retailer opens one slot in every playlist to advertisers, then sells all four screen types to a cold drinks brand through a direct deal.",
      steps: F1, intro: () => show("P1-display-types"),
      start: () => [`See ${RET()} sell its screens to a brand`, "Open slot 1 of every playlist to advertisers, sell December to a cold drinks brand through a direct deal on the forecourt, shop front, cooler door and POS screens, and give the brand its own login."],
      end: () => ["Flow 1 complete", `${RET()} has sold its brand partner slots`, "One slot in every three-campaign rotation is open to advertisers. Frostline holds all four for December through a direct deal, never sent to a DSP, and has its own login to manage its campaigns.", [["4", "screen types"], ["1 in 3", "slots for advertisers"], ["1", "direct deal"]], 1] },
    { h1: "The advertiser creates a campaign by talking", sub: "The advertiser signs in with its own login, briefs the AI campaign agent by voice on its own deal, targets loyalty members with criteria the retailer controls, and the retailer approves.",
      steps: F2, intro: () => { S.p3 = false; screen.innerHTML = login(false); },
      start: () => ["See a brand create its campaign just by talking", "Frostline signs in with its own login, talks the AI campaign agent through the campaign, targets Loyalty Gold members, then the retailer approves it."],
      end: () => ["Flow 2 complete", "A whole campaign from a spoken brief", "Frostline briefed the AI campaign agent by voice on its own deal, targeted Loyalty Gold members who buy cold drinks with the retailer's first-party data, and the retailer approved it.", [["1", "spoken brief"], ["2", "targeting rules"], ["4", "screen types"]], 2] },
    { h1: "One shopper, four screens, every slot sold", sub: "Follow Emma from the pump to the checkout while the brand partner slot personalises for her, then see the bookings behind it.",
      steps: F3, intro: () => { screen.innerHTML = sceneHTML(P3().first); },
      start: () => ["Follow one shopper from the forecourt to the POS", "Emma checks in at the pump, Frostline's Gold version plays for her on every screen, and the booking schedule shows what each slot earns."],
      end: () => ["Flow 3 complete", `${RET()} earns from every brand partner slot`, "Emma's Gold version plays in the brand partner slot of every screen she passes. Every window in Frostline's flight is booked at the deal's CPM, with no DSP involved.", [["4", "screens, one shopper"], ["31", "days booked in December"], ["USD 67,494", "booked in two weeks"]], 0] }
  ];
  return { FLOWDEF };
})() : null;
'''.replace('__HOT__', json.dumps(HOT, separators=(',', ':')))
USED = set(re.findall(r'(?:show|hs)\("([^"#]+)', RM_CODE)) | set(re.findall(r'"(07[cd]\d|07b-assigned-all|P[5-8]-[a-z]+)"', RM_CODE))
HOT = {k: v for k, v in HOT.items() if k.split('#')[0] in USED}
RM_CODE = re.sub(r'HOT = \{.*?\};', lambda m: 'HOT = ' + json.dumps(HOT, separators=(',', ':')) + ';', RM_CODE, count=1, flags=re.S)
print('images', sorted(USED))
rep('/* ================= ui wiring ================= */', VO_CODE + RM_CODE + '\n/* ================= ui wiring ================= */')
rep('const id = ++RUN; S.step = i; card.hidden = true; marks();', 'const id = ++RUN; S.step = i; card.hidden = true; marks(); if (VO) VO.step();')
rep('try { await steps[i].play(id); if (i < steps.length-1) { await wait(900,id); go(i+1); } }', 'try { await steps[i].play(id); if (VO) await VO.done(id); if (i < steps.length-1) { await wait(VO && VO.on ? 350 : 900,id); go(i+1); } }')
rep('S.paused = !S.paused; marks(); };', 'S.paused = !S.paused; marks(); if (VO) VO.sync(); };')
rep('const id = ++RUN; S.paused = false; S.step = -1; hideTip(); card.hidden = true; stage.classList.add("teasing");', 'const id = ++RUN; if (VO) VO.stop(); S.paused = false; S.step = -1; hideTip(); card.hidden = true; stage.classList.add("teasing");')
rep('document.getElementById("capS").textContent = st.s; }', 'document.getElementById("capS").textContent = (VO && VO.text(S.flow, S.step)) || st.s; }')
rep('<button class="ctl fsbtn" id="fs" type="button"', '<span class="vogrp" id="vogrp" hidden><button class="ctl" id="vo" type="button" aria-pressed="false" aria-label="Turn voiceover on"><span class="ms">volume_off</span></button></span><button class="ctl fsbtn" id="fs" type="button"')
rep('const FLOWDEF = FLOWDEF_STD;', 'const FLOWDEF = IS_RM ? RM.FLOWDEF : FLOWDEF_STD;')
rep('chk(id); if (!S.paused) t += 40; } }', 'chk(id); if (!S.paused && !S.voHold) t += 40; } }')
rep('function tip(el, title, text, n) {', 'function tip(el, title, text, n) { if (S.voCue) S.voCue(title);')
rep('function setFlow(k) {\n  S.flow = k;', 'function setFlow(k) {\n  if (VO) VO.stop(); S.flow = k; S.p3 = false; if (VO) VO.warm();')
# an advertiser's own login sees only Campaigns and Insights / Analytics in the left-hand nav
rep('<div class="nav">${nav(NAV1,navOn)}</div><div class="nav bottom">${nav(NAV2,navOn)}</div>', '<div class="nav">${nav(IS_RM && S.flow === 1 ? NAV1.filter(n => n[1] === "Campaigns" || n[1] === "Insights / Analytics") : NAV1,navOn)}</div><div class="nav bottom">${nav(IS_RM && S.flow === 1 ? [] : NAV2,navOn)}</div>')
# gate copy, teaser and fine print
rep('const GFLOWS = [["auto_awesome","Campaign creation"', 'const GFLOWS = IS_RM ? [["storefront","Retailer setup","Open slots to brands and sell them through a deal"],["record_voice_over","Advertiser creates by talking","A whole campaign from a spoken brief"],["person_pin_circle","Shopper journey & outcome","One shopper, four screens"]] : [["auto_awesome","Campaign creation"')
rep('const TEASE = IS_CONV ? CV.TEASE : TEASE_STD;', 'const TEASE = (IS_CONV || IS_RM) ? CV.TEASE : TEASE_STD;')
rep('<h3>Watch a ${INDLABEL} campaign go from a spoken brief to the right customer</h3>', '<h3>${IS_RM ? "Watch a convenience retailer sell its screens to a brand" : `Watch a ${INDLABEL} campaign go from a spoken brief to the right customer`}</h3>')
rep('  document.getElementById("h1").textContent = `See Personalisation Hub run a ${INDLABEL} campaign, end to end`;\n  document.getElementById("sub").textContent = "Short guided demos built on real Personalisation Hub screens: campaign creation, localisation and personalisation, branded as your company.";',
    '  document.getElementById("h1").textContent = IS_RM ? "See a convenience retailer run its own retail media network, end to end" : `See Personalisation Hub run a ${INDLABEL} campaign, end to end`;\n  document.getElementById("sub").textContent = IS_RM ? "Short guided demos: a retailer selling its screens, a brand creating a campaign by talking, and one shopper followed from forecourt to checkout." : "Short guided demos built on real Personalisation Hub screens: campaign creation, localisation and personalisation, branded as your company.";')
rep('S.flow = 0; const stored = readLead(); if (stored) unlock(stored, false); else lock();',
    'if (IS_RM) { const fine = document.querySelector(".fine"); if (fine) fine.textContent = "Example companies, stores and figures are illustrative. Retailer screens are Personalisation Hub HQ Admin screens; campaign screens recreate HQ Admin."; }\n'
    'S.flow = 0; const stored = readLead(); if (window.PH_TOUR_REVIEW) unlock({ name: "", company: "" }, false); else if (stored) unlock(stored, false); else lock();')
# css for screenshots, hotspots, login, slot labels, Frostline tiles
CSS = '''
/* retail media: real prototype screenshots fill the stage; hotspots are invisible targets for the cursor and tips */
.rm-shot{position:absolute;inset:0;background:#fff}.rm-shot img{display:block;width:1280px;height:760px;animation:fade .35s ease both}
.rm-hs{position:absolute;pointer-events:none}
.rm-ov{position:absolute;left:0;top:0;width:1600px;height:950px;transform:scale(.8);transform-origin:0 0;pointer-events:none}
.rm-ovb{position:absolute;left:16px;top:20px;width:238px;height:56px;background:#333;display:flex;align-items:center;gap:10px;padding-left:8px;box-sizing:border-box;font-family:Roboto,Arial,sans-serif}
.rm-ovm{width:40px;height:40px;border:2.5px solid #F2A900;border-radius:9px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;color:#fff;font:700 15px Roboto,Arial,sans-serif;flex:0 0 auto}
.rm-ovm.sm{width:34px;height:34px;font-size:13px;border-radius:8px}
.rm-ovn{display:flex;flex-direction:column;min-width:0;color:#fff;line-height:1.2}
.rm-ovn b{font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:168px}
.rm-ovn small{font-size:11.5px;letter-spacing:2px;text-transform:uppercase;color:#cfcfcf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:168px}
.rm-ova{position:absolute;left:1542px;top:12px;width:42px;height:42px;background:#000;display:flex;align-items:center;justify-content:center}
.rm-toast{position:absolute;left:50%;top:24px;transform:translateX(-50%)}
.rm-login{position:absolute;inset:0;overflow:hidden;background:#141c28;font-family:Roboto,Arial,sans-serif}.rl-bg{position:absolute;inset:0;background:center/cover no-repeat}\n.rl-brand{position:absolute;left:77px;top:18px;display:flex;align-items:center;gap:9px;color:#fff;font-size:21px;letter-spacing:.3px}.rl-brand b{font-weight:700}\n.rl-card{position:absolute;left:50%;top:125px;width:456px;height:488px;margin-left:-228px;background:#fff;border-radius:6px;padding:62px 108px 0;box-sizing:border-box;color:#262626}\n.rl-logo{display:flex;align-items:center;justify-content:center;gap:10px;height:40px;font-weight:700;font-size:16px;color:#1f2a37}\n.rl-card h3{margin:20px -40px 22px;text-align:center;font-size:24px;font-weight:500;letter-spacing:-.2px;white-space:nowrap}\n.rl-lab{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:#8c8c8c;margin:0 0 5px}.rl-lab i{color:#ff4d4f;font-style:normal;margin-right:3px}.rl-lab .ms{font-size:13px}\n.rl-card .in{border:1px solid #d9d9d9;border-radius:4px;height:26px;padding:0 9px;font-size:12px;display:flex;align-items:center;margin-bottom:16px;box-sizing:border-box}\n.rl-row{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:#8c8c8c;margin:6px 0 24px}.rl-row>span{display:flex;align-items:center;gap:7px}.rl-row b{font-weight:400;color:#262626;margin-right:10px}\n.rl-cb{width:12px;height:12px;border:1px solid #d9d9d9;border-radius:2px;display:inline-block}\n.rl-btn{display:flex;align-items:center;justify-content:center;height:26px;border-radius:4px;background:#169BC2;color:#fff;font-weight:600;font-size:12px}\n.rl-pow{position:absolute;left:0;right:0;bottom:24px;display:flex;align-items:center;justify-content:center;gap:5px;font-size:9.5px;color:#8c8c8c}.rl-pow span{font-size:13px;color:#9a9a9a;letter-spacing:.2px}.rl-pow b{font-weight:700}\n.f .in.dsel{display:flex;align-items:center;justify-content:space-between}.f .in.dsel .ms{color:#999;font-size:18px}\n.sel.w4{position:relative}.sel.w4:has(.dchev){padding-right:26px}.sel.w4 .dchev{position:absolute;right:6px;top:50%;transform:translateY(-50%);color:#999;font-size:18px}
.rm-lc{width:400px;background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(10,30,45,.18);padding:28px 30px;display:flex;flex-direction:column;gap:6px}
.rm-lm{display:flex;align-items:center;gap:10px;font-size:20px;margin-bottom:8px}.rm-lm b{font-weight:700}
.rm-lc h3{margin:6px 0 0;font-size:20px}.rm-ls{color:#667;margin-bottom:10px}.rm-lc label{font-size:13px;color:#555;margin-top:6px}
.rm-lc .in{border:1px solid #d9d9d9;border-radius:6px;min-height:36px;padding:8px 10px;font-size:14px}.rm-lc .aibtn{justify-content:center;margin-top:14px}
.cv-ad .sl{position:absolute;left:12px;bottom:7px;font-size:.66em;font-weight:700;letter-spacing:.4px;text-transform:uppercase;opacity:.82}
.cv.rm .cv-ad.cre,.cv.rm .cv-ad.per{background:linear-gradient(150deg,#06345a,#0A5C99)}\n.vogrp{display:inline-flex;align-items:center;gap:4px}.vogrp[hidden]{display:none}\n.ctl#vo.on{border-color:var(--ph-teal,#169BC2);color:var(--ph-teal,#169BC2)}\n.sfa{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;margin-left:12px;border-radius:6px;background:#169BC2;color:#fff;font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap}.sfa .ms{font-size:17px}.sfa.sent{background:#f2f2f2;color:#8c8c8c;cursor:default}
'''
rep('</style>\n</head>', CSS + '</style>\n</head>')

os.makedirs('tour', exist_ok=True)
open('tour/tour-rm.html', 'w', encoding='utf-8').write(t)
# review build for an artifact: no document wrapper, review flags set, gate skipped
head = re.search(r'<title>.*?</title>', t, re.S).group(0).replace('Telco Retail', 'Retail Media')
links = '\n'.join(re.findall(r'<link [^>]*>', t))
style = re.search(r'<style>.*?</style>', t, re.S).group(0)
bodyc = re.search(r'<body>(.*)</body>', t, re.S).group(1)
flags = '<script>window.PH_TOUR_IND = "retail-media"; window.PH_TOUR_IMG = "img/"; window.PH_TOUR_VO = "vo/"; window.PH_TOUR_REVIEW = true;</script>'
os.makedirs('tourart', exist_ok=True)
open('tourart/index.html', 'w', encoding='utf-8').write('<title>Retail Media Tour</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n' + links + '\n' + style + '\n' + flags + '\n' + bodyc)
print('ok', len(t))
