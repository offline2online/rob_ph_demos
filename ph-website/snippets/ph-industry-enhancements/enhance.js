(function () {
  "use strict";
  var CALC = {"convenience":{"model":"conv","per":365,"title":"Your fuel and convenience case","buy":"in-store purchases from fuel customers","how":"Customers per day × 365 × today's conversion gives today's purchases. Personalised offers lift that conversion rate by the uplift percentage, e.g. 20% with a 15% uplift becomes 23% (and, where shown, extra walk-ins come in at the new rate). Extra purchases × value = incremental revenue.","acc":"#FE9226","inputs":[{"id":"stores","label":"Stores","def":500,"step":1,"min":0,"pre":"","suf":""},{"id":"traffic","label":"Fuel customers per store per day","def":600,"step":10,"min":0,"pre":"","suf":""},{"id":"conv","label":"Fuel customers who walk in and buy today","def":25,"step":0.5,"min":0,"pre":"","suf":"%"},{"id":"value","label":"Average in-store spend","def":9,"step":0.5,"min":0,"pre":"$","suf":""}],"assumptions":[{"id":"upl","label":"Uplift in conversion from personalised offers","def":15,"min":0,"max":50,"step":1,"unit":"%"}]},"hospitality":{"model":"spend","per":365,"title":"Your pubs and venues case","buy":"","how":"Venues × guests per day × 365 × average revenue per head × the uplift percentage.","acc":"#FE9226","inputs":[{"id":"stores","label":"Venues","def":50,"step":1,"min":0,"pre":"","suf":""},{"id":"traffic","label":"Guests per venue per day","def":200,"step":10,"min":0,"pre":"","suf":""},{"id":"value","label":"Average revenue per head","def":45,"step":0.5,"min":0,"pre":"$","suf":""}],"assumptions":[{"id":"upl","label":"Uplift in revenue per head from personalised offers","def":10,"min":0,"max":30,"step":1,"unit":"%"}]},"telco":{"model":"tel3","per":365,"title":"Your telco store business case","buy":"new connections","how":"Stream 1: stores × extra walk-ins per store per day × trading days × baseline conversion gives new customers each month. Stream 2: stores × existing walk-ins × the conversion uplift (e.g. 15% becomes 17.25% with a 15% uplift) × trading days. Customers build into an installed base after monthly churn, and the base × monthly ARPU is the incremental revenue, over 36 months (250 trading days a year).","acc":"#169BC2","gate":true,"inputs":[{"id":"stores","label":"Number of stores","def":58,"step":1,"min":0,"pre":"","suf":""},{"id":"footfall","label":"Existing walk-ins per store per day","def":95,"step":5,"min":0,"pre":"","suf":""},{"id":"conv","label":"Baseline in-store conversion","def":15,"step":0.5,"min":0,"pre":"","suf":"%"},{"id":"arpu","label":"Average ARPU per converted customer, per month","def":49,"step":1,"min":0,"pre":"$","suf":""}],"assumptions":[{"id":"walk","label":"Extra walk-ins per store per day from campaigns","def":1,"min":0,"max":20,"step":0.5,"unit":" / store / day"},{"id":"uplift","label":"Conversion uplift from targeted offers","def":15,"min":0,"max":50,"step":1,"unit":"%"},{"id":"churn","label":"Monthly customer churn","def":2,"min":0,"max":10,"step":0.5,"unit":"%"}]},"pharmacy":{"model":"pharm","per":365,"title":"Your pharmacy case","buy":"","how":"","acc":"#60D838","gate":true,"relabel":true,"nohow":true,"inputs":[{"id":"stores","label":"Number of pharmacies","def":100,"step":1,"min":0,"pre":"","suf":""},{"id":"screens","label":"Screens per pharmacy","def":3,"step":1,"min":0,"pre":"","suf":""},{"id":"visits","label":"Daily visits per pharmacy","def":250,"step":10,"min":0,"pre":"","suf":""},{"id":"basket","label":"Average front-of-house basket (promotable products only)","def":22,"step":1,"min":0,"pre":"$","suf":""},{"id":"cpm","label":"Media CPM","def":25,"step":1,"min":0,"pre":"$","suf":"","tip":"Indicative default. Pharmacy and point-of-care screens typically sell at USD 15–40 CPM, a premium over general in-store screens (USD 10–30). Change it to match your market."},{"id":"uplift","label":"Front-of-house basket uplift","def":5,"step":0.5,"min":0,"pre":"","suf":"%"}],"assumptions":[]},"retail-media":{"model":"rm","per":365,"title":"Your retail media and personalisation case","buy":"offer purchases","how":"Media: stores × screens × media revenue per screen × 12 × screen time sold × (1 + targeting premium). Offers: shoppers per day × 365 × today's offer conversion × the uplift percentage × average offer spend.","acc":"#EF60A7","inputs":[{"id":"stores","label":"Stores","def":400,"step":1,"min":0,"pre":"","suf":""},{"id":"screens","label":"Screens per store","def":8,"step":1,"min":0,"pre":"","suf":""},{"id":"rev","label":"Media revenue per screen per month","def":300,"step":1,"min":0,"pre":"$","suf":""},{"id":"traffic","label":"Shoppers per store per day","def":2000,"step":50,"min":0,"pre":"","suf":""},{"id":"conv","label":"In-store conversion percentage today","def":10,"step":0.5,"min":0,"pre":"","suf":"%"},{"id":"value","label":"Average offer spend","def":12,"step":0.5,"min":0,"pre":"$","suf":""}],"assumptions":[{"id":"sell","label":"Screen time sold","def":50,"min":10,"max":100,"step":5,"unit":"%"},{"id":"prem","label":"Premium for loyalty-targeted campaigns","def":30,"min":0,"max":100,"step":5,"unit":"%"},{"id":"upl","label":"Uplift in conversion from personalised offers","def":15,"min":0,"max":50,"step":1,"unit":"%"}]},"grocery":{"model":"rm","per":365,"title":"Your grocery business case","buy":"offer purchases","how":"Media: stores × screens × media revenue per screen × 12 × screen time sold × (1 + targeting premium). Offers: shoppers per day × 365 × today's offer conversion × the uplift percentage × average offer spend.","acc":"#60D838","inputs":[{"id":"stores","label":"Stores","def":150,"step":1,"min":0,"pre":"","suf":""},{"id":"screens","label":"Screens per store","def":6,"step":1,"min":0,"pre":"","suf":""},{"id":"rev","label":"Media revenue per screen per month","def":300,"step":1,"min":0,"pre":"$","suf":""},{"id":"traffic","label":"Shoppers per store per day","def":1700,"step":50,"min":0,"pre":"","suf":""},{"id":"conv","label":"In-store conversion percentage today","def":10,"step":0.5,"min":0,"pre":"","suf":"%"},{"id":"value","label":"Average offer spend","def":12,"step":0.5,"min":0,"pre":"$","suf":""}],"assumptions":[{"id":"sell","label":"Screen time sold","def":50,"min":10,"max":100,"step":5,"unit":"%"},{"id":"prem","label":"Premium for loyalty-targeted campaigns","def":30,"min":0,"max":100,"step":5,"unit":"%"},{"id":"upl","label":"Uplift in conversion from personalised offers","def":15,"min":0,"max":50,"step":1,"unit":"%"}]},"fashion":{"model":"conv","per":365,"title":"Your fashion store case","buy":"transactions","how":"Customers per day × 365 × today's conversion gives today's purchases. Personalised offers lift that conversion rate by the uplift percentage, e.g. 20% with a 15% uplift becomes 23% (and, where shown, extra walk-ins come in at the new rate). Extra purchases × value = incremental revenue.","acc":"#EF60A7","inputs":[{"id":"stores","label":"Stores","def":80,"step":1,"min":0,"pre":"","suf":""},{"id":"traffic","label":"Visitors per store per day","def":550,"step":10,"min":0,"pre":"","suf":""},{"id":"conv","label":"Visitors who buy today","def":20,"step":0.5,"min":0,"pre":"","suf":"%"},{"id":"value","label":"Average transaction value","def":90,"step":1,"min":0,"pre":"$","suf":""}],"assumptions":[{"id":"upl","label":"Uplift in conversion from personalised offers","def":15,"min":0,"max":50,"step":1,"unit":"%"}]},"qsr":{"model":"conv","per":365,"title":"Your restaurant case","buy":"upsells","how":"Customers per day × 365 × today's conversion gives today's purchases. Personalised offers lift that conversion rate by the uplift percentage, e.g. 20% with a 15% uplift becomes 23% (and, where shown, extra walk-ins come in at the new rate). Extra purchases × value = incremental revenue.","acc":"#EF60A7","inputs":[{"id":"stores","label":"Restaurants","def":200,"step":1,"min":0,"pre":"","suf":""},{"id":"traffic","label":"Orders per restaurant per day","def":850,"step":10,"min":0,"pre":"","suf":""},{"id":"conv","label":"Orders that take an upsell today","def":20,"step":0.5,"min":0,"pre":"","suf":"%"},{"id":"value","label":"Average upsell value","def":4,"step":0.5,"min":0,"pre":"$","suf":""}],"assumptions":[{"id":"upl","label":"Uplift in upsell rate from personalised offers","def":15,"min":0,"max":50,"step":1,"unit":"%"}]},"banking":{"model":"conv","per":365,"title":"Your branch business case","buy":"home loans","how":"Customers per day × 365 × today's conversion gives today's purchases. Personalised offers lift that conversion rate by the uplift percentage, e.g. 20% with a 15% uplift becomes 23% (and, where shown, extra walk-ins come in at the new rate). Extra purchases × value = incremental revenue.","acc":"#169BC2","inputs":[{"id":"stores","label":"Branches","def":100,"step":1,"min":0,"pre":"","suf":""},{"id":"traffic","label":"Visits per branch per day","def":60,"step":5,"min":0,"pre":"","suf":""},{"id":"conv","label":"Visits that become a new home loan today","def":0.5,"step":0.1,"min":0,"pre":"","suf":"%"},{"id":"value","label":"Lifetime revenue per home loan","def":15000,"step":500,"min":0,"pre":"$","suf":""}],"assumptions":[{"id":"walk","label":"Extra branch visits from targeted campaigns","def":5,"min":0,"max":20,"step":1,"unit":"%"},{"id":"upl","label":"Uplift in conversion from personalised offers","def":15,"min":0,"max":50,"step":1,"unit":"%"}]}};
  var ACCENT = {"industries":"#169BC2","convenience":"#FE9226","hospitality":"#FE9226","telco":"#169BC2","pharmacy":"#60D838","retail-media":"#EF60A7","grocery":"#60D838","fashion":"#EF60A7","qsr":"#EF60A7","banking":"#169BC2"};
  var NOTE = " Figures are estimates based on your inputs, in your own currency, and are not a guarantee.";
  var page = (typeof window !== "undefined" && window.PH_IND_PAGE) || "";
  var fmtNum = function (n) { return Math.round(n).toLocaleString("en-AU"); };
  var fmtMoney = function (n) { var a = Math.abs(n); return "$" + (a >= 1e9 ? (n / 1e9).toFixed(1) + "B" : a >= 1e6 ? (n / 1e6).toFixed(1) + "M" : a >= 1e4 ? Math.round(n / 1e3) + "K" : fmtNum(n)); };
  var pct = function (n) { return +n.toFixed(2) + "%"; };
  var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
  var fmtA = function (v, a) { return a.unit === "%" ? v + "%" : v + a.unit; };
  function core(v, c) {
    var life = v.life || 1, base = v.stores * v.traffic * c.per, extra = base * (v.walk || 0) / 100;
    var newConv = v.conv * (1 + v.upl / 100), today = base * v.conv / 100, fromWalk = extra * v.conv / 100, fromConv = (base + extra) * (newConv - v.conv) / 100, n = fromWalk + fromConv, val = v.value * life;
    return {today: today, n: n, newConv: newConv, fromWalk: fromWalk * val, fromConv: fromConv * val, total: n * val, hasWalk: !!v.walk};
  }
  /* Pharmacy: three years of incremental revenue, three streams, all front-of-house. Nothing is earned from products that need pharmacist approval.
     Presets (not user inputs): ad plays seen per visit per screen, fill rate, share of visits that buy front of house, foot-traffic uplift. */
  var PHARM = {plays: 4, fill: 0.4, buyers: 0.3, walk: 0.03, years: 3, days: 365};
  function pharmCalc(v) {
    var visits = v.stores * v.visits * PHARM.days, up = v.uplift / 100;
    var media = visits * v.screens * PHARM.plays * PHARM.fill * v.cpm / 1000 * PHARM.years;
    var basket = visits * PHARM.buyers * v.basket * up * PHARM.years;
    var traffic = visits * PHARM.walk * PHARM.buyers * v.basket * (1 + up) * PHARM.years;
    return {media: media, basket: basket, traffic: traffic, total: media + basket + traffic};
  }
  /* Mirrors telco_calc() in telco-model.php (one set of formulas; tests/telco-model.test.php + .mjs keep them equal). */
  function telcoCalc(v) {
    var days = 250 / 12, conv = v.conv / 100, up = conv * (1 + v.uplift / 100) - conv, churn = v.churn / 100, b1 = 0, b2 = 0, years = [{t: 0}, {t: 0}, {t: 0}], total = 0, last = {};
    for (var i = 1; i <= 36; i++) {
      var n1 = v.stores * v.walk * days * conv, n2 = v.stores * v.footfall * up * days;
      b1 = i === 1 ? n1 : b1 * (1 - churn) + n1; b2 = i === 1 ? n2 : b2 * (1 - churn) + n2;
      var rev = (b1 + b2) * v.arpu; years[Math.floor((i - 1) / 12)].t += rev; total += rev; last = {runRate: rev, base: b1 + b2};
    }
    return {years: years.map(function (y) { return {total: y.t}; }), total: total, runRate: last.runRate, base: last.base};
  }
  var MODELS = {
    pharm: function (v) { var r = pharmCalc(v);
      return {rows: [["Media revenue from front-of-house brands", r.media, "$"], ["Front-of-house basket uplift", r.basket, "$"], ["Extra foot traffic", r.traffic, "$"]], total: r.total}; },
    tel3: function (v, c) { var r = telcoCalc(v), y = r.years;
      return {rows: [["Conversion today, then with personalisation", pct(v.conv) + " → " + pct(v.conv * (1 + v.uplift / 100)), "t"], ["Year 1 incremental revenue", y[0].total, "$"], ["Year 2 incremental revenue", y[1].total, "$"], ["Year 3 incremental revenue", y[2].total, "$"], ["Monthly revenue run-rate by month 36", r.runRate, "$"], ["Incremental subscribers by month 36", r.base, "n"]], total: r.total}; },
    spend: function (v) { var guests = v.stores * v.traffic * 365, after = v.value * (1 + v.upl / 100), p = function (n) { return "$" + n.toFixed(2); };
      return {rows: [["Revenue per head today, then with personalisation", p(v.value) + " → " + p(after), "t"], ["Guests a year", guests, "n"], ["Revenue a year today", guests * v.value, "$"]], total: guests * (after - v.value)}; },
    conv: function (v, c) { var r = core(v, c), rows = [["Conversion today, then with personalisation", pct(v.conv) + " → " + pct(r.newConv), "t"], [cap(c.buy) + " a year, today", r.today, "n"], ["Extra " + c.buy + " a year", r.n, "n"]];
      if (r.hasWalk) rows.push(["Revenue from extra walk-ins", r.fromWalk, "$"], ["Revenue from higher conversion", r.fromConv, "$"]);
      return {rows: rows, total: r.total}; },
    rm: function (v, c) { var media = v.stores * v.screens * v.rev * 12 * v.sell / 100 * (1 + v.prem / 100), r = core(v, c);
      return {rows: [["Retail media revenue a year, loyalty-targeted", media, "$"], ["Offer conversion today, then with personalisation", pct(v.conv) + " → " + pct(r.newConv), "t"], ["Extra " + c.buy + " a year", r.n, "n"], ["Incremental sales from personalised offers", r.total, "$"]], total: media + r.total}; }
  };
  function push(o) { try { (window.dataLayer = window.dataLayer || []).push(o); } catch (e) {} }
  function tip(text, label) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "ph-ind-tip"; b.setAttribute("aria-label", label + ": " + text); b.setAttribute("data-tip", text); b.textContent = "i";
    return b;
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }


  var INF_D = "M385.0,100.0 L384.8,105.6 L384.2,111.1 L383.3,116.5 L382.0,121.9 L380.3,127.1 L378.4,132.1 L376.1,136.9 L373.5,141.5 L370.6,145.8 L367.5,149.8 L364.1,153.6 L360.6,157.1 L356.9,160.2 L353.1,163.1 L349.1,165.6 L345.0,167.8 L340.9,169.7 L336.7,171.4 L332.4,172.7 L328.2,173.7 L323.9,174.5 L319.7,174.9 L315.4,175.2 L311.2,175.2 L307.1,175.0 L303.0,174.5 L298.9,173.9 L295.0,173.1 L291.1,172.1 L287.2,170.9 L283.4,169.6 L279.7,168.2 L276.1,166.6 L272.6,164.9 L269.1,163.1 L265.7,161.1 L262.4,159.1 L259.2,157.1 L256.0,154.9 L252.9,152.6 L249.8,150.3 L246.8,148.0 L243.9,145.6 L241.0,143.1 L238.2,140.6 L235.4,138.0 L232.7,135.4 L230.0,132.8 L227.4,130.2 L224.8,127.5 L222.2,124.8 L219.7,122.1 L217.1,119.4 L214.6,116.6 L212.2,113.9 L209.7,111.1 L207.3,108.3 L204.8,105.6 L202.4,102.8 L200.0,100.0 L197.6,97.2 L195.2,94.4 L192.7,91.7 L190.3,88.9 L187.8,86.1 L185.4,83.4 L182.9,80.6 L180.3,77.9 L177.8,75.2 L175.2,72.5 L172.6,69.8 L170.0,67.2 L167.3,64.6 L164.6,62.0 L161.8,59.4 L159.0,56.9 L156.1,54.4 L153.2,52.0 L150.2,49.7 L147.1,47.4 L144.0,45.1 L140.8,42.9 L137.6,40.9 L134.3,38.9 L130.9,36.9 L127.4,35.1 L123.9,33.4 L120.3,31.8 L116.6,30.4 L112.8,29.1 L108.9,27.9 L105.0,26.9 L101.1,26.1 L97.0,25.5 L92.9,25.0 L88.8,24.8 L84.6,24.8 L80.3,25.1 L76.1,25.5 L71.8,26.3 L67.6,27.3 L63.3,28.6 L59.1,30.3 L55.0,32.2 L50.9,34.4 L46.9,36.9 L43.1,39.8 L39.4,42.9 L35.9,46.4 L32.5,50.2 L29.4,54.2 L26.5,58.5 L23.9,63.1 L21.6,67.9 L19.7,72.9 L18.0,78.1 L16.7,83.5 L15.8,88.9 L15.2,94.4 L15.0,100.0 L15.2,105.6 L15.8,111.1 L16.7,116.5 L18.0,121.9 L19.7,127.1 L21.6,132.1 L23.9,136.9 L26.5,141.5 L29.4,145.8 L32.5,149.8 L35.9,153.6 L39.4,157.1 L43.1,160.2 L46.9,163.1 L50.9,165.6 L55.0,167.8 L59.1,169.7 L63.3,171.4 L67.6,172.7 L71.8,173.7 L76.1,174.5 L80.3,174.9 L84.6,175.2 L88.8,175.2 L92.9,175.0 L97.0,174.5 L101.1,173.9 L105.0,173.1 L108.9,172.1 L112.8,170.9 L116.6,169.6 L120.3,168.2 L123.9,166.6 L127.4,164.9 L130.9,163.1 L134.3,161.1 L137.6,159.1 L140.8,157.1 L144.0,154.9 L147.1,152.6 L150.2,150.3 L153.2,148.0 L156.1,145.6 L159.0,143.1 L161.8,140.6 L164.6,138.0 L167.3,135.4 L170.0,132.8 L172.6,130.2 L175.2,127.5 L177.8,124.8 L180.3,122.1 L182.9,119.4 L185.4,116.6 L187.8,113.9 L190.3,111.1 L192.7,108.3 L195.2,105.6 L197.6,102.8 L200.0,100.0 L202.4,97.2 L204.8,94.4 L207.3,91.7 L209.7,88.9 L212.2,86.1 L214.6,83.4 L217.1,80.6 L219.7,77.9 L222.2,75.2 L224.8,72.5 L227.4,69.8 L230.0,67.2 L232.7,64.6 L235.4,62.0 L238.2,59.4 L241.0,56.9 L243.9,54.4 L246.8,52.0 L249.8,49.7 L252.9,47.4 L256.0,45.1 L259.2,42.9 L262.4,40.9 L265.7,38.9 L269.1,36.9 L272.6,35.1 L276.1,33.4 L279.7,31.8 L283.4,30.4 L287.2,29.1 L291.1,27.9 L295.0,26.9 L298.9,26.1 L303.0,25.5 L307.1,25.0 L311.2,24.8 L315.4,24.8 L319.7,25.1 L323.9,25.5 L328.2,26.3 L332.4,27.3 L336.7,28.6 L340.9,30.3 L345.0,32.2 L349.1,34.4 L353.1,36.9 L356.9,39.8 L360.6,42.9 L364.1,46.4 L367.5,50.2 L370.6,54.2 L373.5,58.5 L376.1,63.1 L378.4,67.9 L380.3,72.9 L382.0,78.1 L383.3,83.5 L384.2,88.9 L384.8,94.4 L385.0,100.0Z";
  var INF_SEGS = [["#169BC2", -12.5], ["#EF60A7", -37.5], ["#FE9226", -62.5], ["#60D838", -87.5]];
  var INF_LABELS = [["tl", "Know", "who's in store, and why"], ["tr", "Personalise", "every moment of the visit"], ["br", "Measure", "from screen to sale"], ["bl", "Optimise", "the next campaign, automatically"]];
  function setupLoop() {
    var NS = "http://www.w3.org/2000/svg";
    [].forEach.call(document.querySelectorAll("img.ph-ind-inf"), function (img) {
      var fig = el("figure", "ph-ind-inf-fig");
      fig.setAttribute("role", "img");
      fig.setAttribute("aria-label", img.getAttribute("alt") || "Know, personalise, measure, optimise");
      var svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "-12 -12 424 224"); svg.setAttribute("fill", "none"); svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("stroke-width", "22"); svg.setAttribute("stroke-linecap", "butt"); svg.setAttribute("stroke-linejoin", "round");
      INF_SEGS.forEach(function (sg, i) {
        var p = document.createElementNS(NS, "path");
        p.setAttribute("d", INF_D); p.setAttribute("pathLength", "100"); p.setAttribute("stroke", sg[0]);
        p.setAttribute("stroke-dasharray", "23 77"); p.setAttribute("stroke-dashoffset", String(sg[1]));
        p.setAttribute("class", "ph-ind-seg ph-ind-s" + i);
        svg.appendChild(p);
      });
      fig.appendChild(svg);
      INF_LABELS.forEach(function (l) { var d = el("div", "ph-ind-inf-lab ph-ind-" + l[0]); d.appendChild(el("b", "", l[1])); d.appendChild(el("span", "", l[2])); fig.appendChild(d); });
      img.replaceWith(fig);
    });
  }


  function setupLines() {
    var NS = "http://www.w3.org/2000/svg";
    [].forEach.call(document.querySelectorAll(".ph-ind-flow"), function (flow) {
      var panels = [].slice.call(flow.querySelectorAll(".ph-ind-panel"));
      if (!panels.length) return;
      flow.classList.add("ph-ind-lined");
      panels.forEach(function (panel) {
        var svg = document.createElementNS(NS, "svg");
        svg.setAttribute("class", "ph-ind-lines"); svg.setAttribute("aria-hidden", "true");
        panel.insertBefore(svg, panel.firstChild);
        panel.__phSvg = svg;
      });
      var draw = function (panel) {
        var svg = panel.__phSvg, B = panel.getBoundingClientRect();
        if (!svg || !B.width || !B.height) return;
        var R = function (n) { var r = n.getBoundingClientRect(); return {t: r.top - B.top, b: r.bottom - B.top, cx: (r.left + r.right) / 2 - B.left, w: r.width}; };
        var data = panel.querySelector(".ph-ind-data"), hubEl = panel.querySelector(".ph-ind-hubnode");
        if (!data || !hubEl || data.children.length < 2) return;
        var loc = R(data.children[0]), per = R(data.children[1]), hub = R(hubEl), segs = [];
        if (per.t >= loc.b - 1) { segs.push(["loc", loc.cx, loc.b, per.cx, per.t]); segs.push(["per", per.cx, per.b, hub.cx, hub.t]); }
        else { segs.push(["loc", loc.cx, loc.b, hub.cx - 16, hub.t]); segs.push(["per", per.cx, per.b, hub.cx + 16, hub.t]); }
        var devs = [].map.call(panel.querySelectorAll(".ph-ind-tps > *"), function (tp) { return R(tp.firstElementChild || tp); }).filter(function (d) { return d.w > 0; });
        if (devs.length) {
          var minB = Math.min.apply(null, devs.map(function (d) { return d.b; }));
          devs.filter(function (d) { return d.t < minB; }).forEach(function (d) { segs.push(["out", hub.cx, hub.b, d.cx, d.t]); });
        }
        svg.setAttribute("viewBox", "0 0 " + B.width + " " + B.height);
        svg.innerHTML = segs.map(function (s) { var my = (s[2] + s[4]) / 2;
          return '<path class="ph-ind-fl ' + s[0] + '" d="M' + s[1] + "," + s[2] + " C" + s[1] + "," + my + " " + s[3] + "," + my + " " + s[3] + "," + s[4] + '"/><circle class="ph-ind-fd ' + s[0] + '" cx="' + s[3] + '" cy="' + s[4] + '" r="3.5"/>'; }).join("");
      };
      var queued = false;
      var all = function () { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; panels.forEach(draw); }); };
      all();
      window.addEventListener("resize", all);
      if (window.ResizeObserver) { var ro = new ResizeObserver(all); panels.forEach(function (p) { ro.observe(p); }); }
      [].forEach.call(flow.querySelectorAll(".ph-ind-tabmenu > *"), function (t) { t.addEventListener("click", function () { setTimeout(all, 30); setTimeout(all, 300); }); });
      [].forEach.call(flow.querySelectorAll("img"), function (im) { if (!im.complete) im.addEventListener("load", all); });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(all);
      window.addEventListener("load", all);
    });
  }

  function buildGate(current, c) {
    var ind = c.model === "pharm" ? {ep: "pharmacy-model", src: "Pharmacy business model download"} : {ep: "telco-model", src: "Telco business model download"};
    var wrap = el("section", "ph-ind-gate"), h = el("h3", "ph-ind-gate-h", "Get the detailed business model"), p = el("p", "ph-ind-gate-p", "Provide your details to download the business model.");
    wrap.setAttribute("aria-label", "Download the business model");
    var form = el("form", "ph-ind-gate-f"); form.noValidate = true;
    var defs = [["name", "Full name", "text", "name"], ["company", "Company", "text", "organization"], ["email", "Work email", "email", "email"]];
    defs.forEach(function (d) { var l = el("label", "ph-ind-gate-l"); l.appendChild(el("span", "", d[1])); var i = el("input"); i.type = d[2]; i.name = d[0]; i.required = true; i.autocomplete = d[3]; i.maxLength = 120; l.appendChild(i); form.appendChild(l); });
    var hp = el("input"); hp.type = "text"; hp.name = "website"; hp.tabIndex = -1; hp.autocomplete = "off"; hp.setAttribute("aria-hidden", "true"); hp.className = "ph-ind-gate-hp"; form.appendChild(hp);
    var cl = el("label", "ph-ind-gate-c"), cb = el("input"); cb.type = "checkbox"; cb.name = "consent"; cl.appendChild(cb);
    var ct = el("span", "", "I agree to be contacted. See the "); var pa = el("a", "", "privacy policy"); pa.href = "/privacy-policy/"; ct.appendChild(pa); ct.appendChild(document.createTextNode(".")); cl.appendChild(ct); form.appendChild(cl);
    var btn = el("button", "ph-ind-gate-b", "Download the model"); btn.type = "submit"; btn.disabled = true; form.appendChild(btn);
    var msg = el("p", "ph-ind-gate-m"); msg.setAttribute("role", "status"); msg.setAttribute("aria-live", "polite"); form.appendChild(msg);
    var busy = false;
    // A visitor already captured (the tour gate, or an earlier download) is never asked again: their details fill the form,
    // the fields and consent box are hidden and the button is ready. Consent was ticked when that lead was captured.
    var known = el("p", "ph-ind-gate-k"); known.hidden = true; form.insertBefore(known, btn);
    var applyKnown = function () {
      var l = readLead(), f = form.elements;
      if (!l) return;
      f.name.value = l.name || ""; f.company.value = l.company || ""; f.email.value = l.email;
      cb.checked = true; form.classList.add("ph-ind-gate-known");
      known.hidden = false; known.textContent = "Thanks" + (l.name ? ", " + String(l.name).trim().split(/\s+/)[0] : "") + ". We already have your details, so there is nothing more to fill in.";
      p.textContent = "Download the business model."; sync();
    };
    var valid = function () {
      var f = form.elements;
      return !!(f.name.value.trim() && f.company.value.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.value.trim()) && cb.checked);
    };
    var sync = function () { btn.disabled = busy || !valid(); };
    form.addEventListener("input", sync); form.addEventListener("change", sync);
    applyKnown();
    window.addEventListener("ph:lead", applyKnown);
    window.addEventListener("storage", function (e) { if (e.key === "ph_lead") applyKnown(); });
    form.addEventListener("submit", function (e) {
      e.preventDefault(); if (busy || !valid()) { sync(); return; }
      msg.className = "ph-ind-gate-m"; msg.textContent = "";
      var body = {inputs: current(), consent: cb.checked, page: location.origin + location.pathname};
      if (testMode()) body.test = true;
      defs.forEach(function (d) { body[d[0]] = form.elements[d[0]].value; }); body.website = hp.value;
      busy = true; sync(); btn.textContent = "Preparing…";
      var done = function () { busy = false; btn.textContent = "Download the model"; sync(); };
      fetch("/wp-json/ph-site/v1/" + ind.ep, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)})
        .then(function (r) { return r.json().then(function (j) { return {ok: r.ok, j: j}; }); })
        .then(function (o) {
          done();
          if (!o.ok || !o.j.download) { msg.className = "ph-ind-gate-m ph-ind-gate-err"; msg.textContent = (o.j && o.j.error) || "Something went wrong. Please try again."; return; }
          push({event: "ph_ind_lead", ph_industry: page, ph_form: "business_model", ph_estimate: Math.round(MODELS[c.model](body.inputs, c).total)});
          shareLead({name: body.name, company: body.company, email: body.email, source: ind.src});
          msg.textContent = "Thanks. Your download is starting. If it does not, use this link: "; var a = el("a", "", "Download the model"); a.href = o.j.download; msg.appendChild(a);
          window.location.href = o.j.download;
        }).catch(function () { done(); msg.className = "ph-ind-gate-m ph-ind-gate-err"; msg.textContent = "Something went wrong. Please try again."; });
    });
    wrap.appendChild(h); wrap.appendChild(p); wrap.appendChild(form);
    return wrap;
  }

  // Test mode: open a page with ?ph_test=1 (kept for the tab) and every lead sent from it is a test lead in the console.
  function testMode() {
    try {
      if (/[?&]ph_test=1(&|$)/.test(location.search)) sessionStorage.setItem("ph_test", "1");
      return sessionStorage.getItem("ph_test") === "1";
    } catch (e) { return /[?&]ph_test=1(&|$)/.test(location.search); }
  }

  // A visitor who gave their details once should not be asked again: on a successful lead capture the calculator and Talk to us forms
  // write ph_lead to localStorage and announce it on window, which unlocks the product tour on this page (and on the next visit).
  function readLead() { try { var l = JSON.parse(localStorage.getItem("ph_lead") || "null"); return l && l.email ? l : null; } catch (e) { return null; } }
  function shareLead(l) {
    var lead = {name: String(l.name || ""), company: String(l.company || ""), email: String(l.email || ""), source: l.source, ts: Date.now()};
    try { localStorage.setItem("ph_lead", JSON.stringify(lead)); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent("ph:lead", {detail: lead})); } catch (e) {}
  }

  // Interactive product tour (telco, pharmacy, retail media and fuel & convenience): the tour page is served same-origin at /industries/<page>/tour/ and framed here, so its CSS cannot
  // clash with the theme or Elementor. The band's heading is server-rendered (Elementor, ".ph-ind-tour"); the iframe is progressive enhancement.
  var TOUR_COPY = {
    telco: ["See Personalisation Hub run a telco campaign, end to end", "Pick a demo and watch a campaign go from brief to every store screen."],
    pharmacy: ["See Personalisation Hub run a pharmacy campaign, end to end", "Pick a demo and watch a campaign go from brief to every pharmacy screen, and on to the pharmacist."],
    "retail-media": ["See a convenience retailer run its own retail media network, end to end", "Pick a demo: a retailer selling its screens, a brand creating a campaign by talking, and one shopper from forecourt to checkout."],
    convenience: ["See Personalisation Hub run a fuel and convenience campaign, end to end", "Watch one retailer campaign follow a loyalty member from the pump to the shop front, the coolers and the till."]
  };
  function tourSrc() { return "/industries/" + page + "/tour/?embed=1" + (testMode() ? "&ph_test=1" : ""); }
  function setupTour() {
    if (!TOUR_COPY[page]) return;
    var band = document.querySelector(".ph-ind-tour");
    var mount = band && band.querySelector(".ph-ind-tour-mount");
    if (!mount) {
      var calc = document.querySelector(".ph-ind-calc"), after = calc && calc.closest(".ph-ind-sec");
      if (!after) return;
      band = el("section", "ph-ind-sec ph-ind-tour");
      var inner = el("div", "ph-ind-tour-in");
      inner.appendChild(el("p", "ph-ind-tour-eyebrow", "Interactive product tour"));
      inner.appendChild(el("h2", "ph-ind-tour-h", TOUR_COPY[page][0]));
      inner.appendChild(el("p", "ph-ind-tour-p", TOUR_COPY[page][1]));
      mount = el("div", "ph-ind-tour-mount"); inner.appendChild(mount); band.appendChild(inner);
      after.parentNode.insertBefore(band, after.nextSibling);
    }
    if (band && !band.id) band.id = "ph-tour"; // anchor for links from other tours (e.g. /industries/convenience/ -> /industries/retail-media/#ph-tour)
    if (location.hash === "#ph-tour" && band && band.scrollIntoView) setTimeout(function () { band.scrollIntoView(); }, 0);
    window.PH_TOUR = {
      endpoint: "/wp-json/ph-site/v1/tour-lead", nonce: "",
      arrangeDemo: function () { if (typeof window.PH_SITE_DEMO === "function") window.PH_SITE_DEMO(band); }
    };
    var f = el("iframe", "ph-ind-tour-frame");
    f.title = "Interactive product tour"; f.loading = "lazy"; f.src = tourSrc();
    f.setAttribute("scrolling", "no"); f.style.cssText = "width:100%;border:0";
    f.setAttribute("allow", "fullscreen"); f.setAttribute("allowfullscreen", ""); f.allowFullscreen = true;
    mount.appendChild(f);
    // Full screen: the tour uses the Fullscreen API itself. Where it is missing (iPhone Safari) it posts ph-tour-fullscreen and we pin the frame over the viewport.
    var pinned = null, nativeFs = false;
    function pinFrame(on) {
      var de = document.documentElement, b = document.body;
      if (on && !pinned) {
        pinned = {css: f.style.cssText, html: de.style.overflow, body: b.style.overflow};
        f.style.cssText = "position:fixed;top:0;right:0;bottom:0;left:0;width:100%;height:100%;max-height:none;min-height:0;border:0;z-index:2147483000;background:#0F1424";
        de.style.overflow = "hidden"; b.style.overflow = "hidden";
      } else if (!on && pinned) {
        f.style.cssText = pinned.css; de.style.overflow = pinned.html; b.style.overflow = pinned.body; pinned = null;
      }
    }
    function bandInView() { try { band.scrollIntoView({block: "nearest"}); } catch (x) { band.scrollIntoView(); } }
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (e.origin !== location.origin || e.source !== f.contentWindow || !d) return;
      if (d.type === "ph-tour-fullscreen") { var on = d.on === true; pinFrame(on); if (!on) bandInView(); return; }
      if (d.type !== "ph-tour-height" || pinned) return;
      var h = Math.round(Number(d.h));
      if (h > 0 && h < 20000) f.style.height = h + "px";
    });
    document.addEventListener("fullscreenchange", function () {
      var on = document.fullscreenElement === f;
      if (nativeFs && !on) bandInView();
      nativeFs = on;
    });
  }

  var LEAD_FORM = {}; // no industry page has a standalone "Talk to us" form: leads come only from the calculator download or the tour
  function setupLeadForm() {
    if (!LEAD_FORM[page]) return;
    var host = document.querySelector("[data-elementor-type='wp-page']") || document.querySelector("main") || document.body;
    var wrap = el("section", "ph-ind-lead"), h = el("h3", "ph-ind-gate-h", "Talk to us about " + LEAD_FORM[page].toLowerCase()), p = el("p", "ph-ind-gate-p", "Tell us about your business and we will get back to you.");
    var form = el("form", "ph-ind-gate-f"); form.noValidate = true;
    var defs = [["company", "Company name", "text", "organization", 1], ["website", "Website", "text", "url", 0], ["company_industry", "Industry", "text", "off", 0], ["countries", "Countries", "text", "off", 0], ["store_count", "Number of stores", "text", "off", 0], ["contact_name", "Your name", "text", "name", 1], ["job_title", "Job title", "text", "organization-title", 0], ["email", "Work email", "email", "email", 1], ["linkedin", "LinkedIn profile", "text", "off", 0]];
    defs.forEach(function (d) { var l = el("label", "ph-ind-gate-l"); l.appendChild(el("span", "", d[1] + (d[4] ? "" : " (optional)"))); var i = el("input"); i.type = d[2]; i.name = d[0]; i.required = !!d[4]; i.autocomplete = d[3]; i.maxLength = 300; if (d[0] === "company_industry") i.value = LEAD_FORM[page]; l.appendChild(i); form.appendChild(l); });
    var hp = el("input"); hp.type = "text"; hp.name = "hp_url"; hp.tabIndex = -1; hp.autocomplete = "off"; hp.setAttribute("aria-hidden", "true"); hp.className = "ph-ind-gate-hp"; form.appendChild(hp);
    var cl = el("label", "ph-ind-gate-c"), cb = el("input"); cb.type = "checkbox"; cb.name = "consent"; cl.appendChild(cb);
    var ct = el("span", "", "I agree to be contacted about Personalisation Hub. See the "); var pa = el("a", "", "privacy policy"); pa.href = "/privacy-policy/"; ct.appendChild(pa); ct.appendChild(document.createTextNode(".")); cl.appendChild(ct); form.appendChild(cl);
    var btn = el("button", "ph-ind-gate-b", "Send"); btn.type = "submit"; form.appendChild(btn);
    var msg = el("p", "ph-ind-gate-m"); msg.setAttribute("role", "status"); msg.setAttribute("aria-live", "polite"); form.appendChild(msg);
    if (testMode()) wrap.appendChild(el("p", "ph-ind-lead-test", "Test mode: submissions are flagged as test leads."));
    form.addEventListener("submit", function (e) {
      e.preventDefault(); msg.className = "ph-ind-gate-m"; msg.textContent = "";
      var body = {pageIndustry: page, page: location.origin + location.pathname, consent: cb.checked, hp_url: hp.value};
      defs.forEach(function (d) { body[d[0]] = form.elements[d[0]].value; });
      if (testMode()) body.test = true;
      btn.disabled = true;
      fetch("/wp-json/ph-site/v1/industry-lead", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)})
        .then(function (r) { return r.json().then(function (j) { return {ok: r.ok, j: j}; }); })
        .then(function (o) {
          btn.disabled = false;
          if (!o.ok) { msg.className = "ph-ind-gate-m ph-ind-gate-err"; msg.textContent = (o.j && o.j.error) || "Something went wrong. Please try again."; return; }
          push({event: "ph_ind_lead", ph_industry: page, ph_form: "contact"});
          shareLead({name: body.contact_name, company: body.company, email: body.email, source: "Talk to us"});
          form.reset(); msg.textContent = "Thanks. We will be in touch.";
        }).catch(function () { btn.disabled = false; msg.className = "ph-ind-gate-m ph-ind-gate-err"; msg.textContent = "Something went wrong. Please try again."; });
    });
    wrap.appendChild(h); wrap.appendChild(p); wrap.appendChild(form);
    host.appendChild(wrap);
  }

  function setupCalc() {
    var root = document.querySelector(".ph-ind-calc"), c = CALC[page];
    if (!root || !c) return;
    var cin = root.querySelector(".ph-ind-cin"), cout = root.querySelector(".ph-ind-cout");
    if (!cin || !cout) return;
    var rows = cin.querySelectorAll(".ph-ind-cf"), fields = c.inputs.concat(c.assumptions);
    if (c.relabel) {
      while (rows.length < fields.length) { var cp = rows[rows.length - 1].cloneNode(true); rows[rows.length - 1].after(cp); rows = cin.querySelectorAll(".ph-ind-cf"); }
      while (rows.length > fields.length) { rows[rows.length - 1].remove(); rows = cin.querySelectorAll(".ph-ind-cf"); }
    }
    if (rows.length !== fields.length) return;
    root.style.setProperty("--ph-ind-a", c.acc);
    root.classList.add("ph-ind-live");
    var labels = cin.querySelectorAll(".ph-ind-label-gap");
    if (labels[0]) labels[0].textContent = "Your figures";
    if (labels[1] && !c.assumptions.length) labels[1].style.display = "none";
    else if (labels[1]) labels[1].appendChild(tip("Starting points only. Change them to match your business, or ask us for benchmarks for your market.", "About the assumptions"));
    var get = {};
    fields.forEach(function (f, i) {
      var row = rows[i], lab = row.querySelector(".ph-ind-cf-l"), val = row.querySelector(".ph-ind-cf-v"), assumption = i >= c.inputs.length, id = "ph-ind-in-" + f.id;
      if (!lab || !val) return;
      var label = el("label", lab.className, c.relabel ? f.label : lab.textContent); label.htmlFor = id; lab.replaceWith(label);
      if (f.tip) label.appendChild(tip(f.tip, f.label));
      var box = el("span", assumption ? "ph-ind-in ph-ind-in-range" : "ph-ind-in"), input = el("input");
      input.id = id; input.min = f.min; input.step = f.step; input.value = f.def;
      if (assumption) {
        input.type = "range"; input.max = f.max;
        var out = el("output", "", fmtA(f.def, f)); out.htmlFor = id;
        box.appendChild(input); box.appendChild(out);
        get[f.id] = function () { var x = +input.value; out.textContent = fmtA(x, f); return x; };
      } else {
        input.type = "number"; input.inputMode = "decimal";
        if (f.pre) box.appendChild(el("i", "", f.pre));
        box.appendChild(input);
        if (f.suf) box.appendChild(el("i", "", f.suf));
        get[f.id] = function () { var x = parseFloat(input.value); return isFinite(x) && x >= 0 ? x : 0; };
      }
      val.replaceWith(box);
    });
    var total = [].filter.call(cout.querySelectorAll("p"), function (p) { return /ph-ind-ctot-/.test(p.className) && !/ph-ind-ctot-l/.test(p.className); })[0];
    var crows = [].slice.call(cout.querySelectorAll(".ph-ind-crow"));
    if (!total || !crows.length) return;
    if (!c.nohow) { var how = el("div", "ph-ind-how"); how.appendChild(tip(c.how + NOTE, "How it's calculated")); how.appendChild(el("span", "", "How it's calculated")); crows[crows.length - 1].after(how); }
    var totLabel = cout.querySelector(".ph-ind-ctot-l"); if ((c.gate || c.model === "pharm") && totLabel) totLabel.textContent = "Estimated 3-year incremental revenue";
    var current = function () { var v = {}; fields.forEach(function (f) { v[f.id] = get[f.id] ? get[f.id]() : f.def; }); return v; };
    if (c.gate && root.parentNode) { var gate = buildGate(current, c); gate.style.setProperty("--ph-ind-a", c.acc); root.parentNode.insertBefore(gate, root.nextSibling); }
    var timer = null;
    function update() {
      var v = {}; fields.forEach(function (f) { v[f.id] = get[f.id] ? get[f.id]() : f.def; });
      var r = MODELS[c.model](v, c);
      total.textContent = fmtMoney(r.total);
      while (crows.length < r.rows.length) { var copy = crows[crows.length - 1].cloneNode(true); crows[crows.length - 1].after(copy); crows.push(copy); }
      crows.forEach(function (row, i) {
        var d = r.rows[i]; row.style.display = d ? "" : "none"; if (!d) return;
        var ps = row.querySelectorAll("p"); if (ps.length < 2) return;
        ps[0].textContent = d[0]; ps[1].textContent = d[2] === "$" ? fmtMoney(d[1]) : d[2] === "t" ? d[1] : fmtNum(d[1]);
      });
      clearTimeout(timer);
      timer = setTimeout(function () { push({event: "ph_ind_calculator", ph_industry: page, ph_inputs: v, ph_estimate: Math.round(r.total)}); }, 1500);
    }
    root.addEventListener("input", update);
    update();
  }

  function setupFlow() {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    [].forEach.call(document.querySelectorAll(".ph-ind-flow"), function (flow) {
      var menu = flow.querySelector(".ph-ind-tabmenu"); if (!menu) return;
      var tabs = [].slice.call(menu.children); if (tabs.length < 2) return;
      flow.style.setProperty("--ph-ind-a", ACCENT[page] || "#169BC2");
      tabs.forEach(function (t) { var bar = el("i", "ph-ind-prog"); bar.setAttribute("aria-hidden", "true"); t.appendChild(bar); });
      if (reduce) return;
      flow.classList.add("ph-ind-anim");
      var hold = false, stopped = false, elapsed = 0, last = Date.now(), DUR = 7000;
      var on = function () { hold = true; flow.classList.add("ph-ind-hold"); }, off = function () { hold = false; flow.classList.remove("ph-ind-hold"); };
      flow.addEventListener("mouseenter", on); flow.addEventListener("mouseleave", off);
      flow.addEventListener("focusin", on); flow.addEventListener("focusout", off);
      tabs.forEach(function (t) { t.addEventListener("click", function (e) { if (e.isTrusted) { stopped = true; flow.classList.remove("ph-ind-anim"); } }); });
      setInterval(function () {
        var now = Date.now();
        if (!hold && !stopped && !document.hidden) elapsed += now - last;
        last = now;
        if (stopped || elapsed < DUR) return;
        elapsed = 0;
        var cur = 0; tabs.forEach(function (t, i) { if (t.getAttribute("aria-selected") === "true") cur = i; });
        tabs[(cur + 1) % tabs.length].click();
      }, 250);
    });
  }

  function trackCtas() {
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a") : null; if (!a) return;
      var sec = a.closest(".ph-ind-sec, .ph-ind-sec-hero"); if (!sec) return;
      var href = a.getAttribute("href") || "", cta = href.indexOf("aws.amazon.com") > -1 ? "trial" : href.indexOf("popup") > -1 ? "demo" : "";
      if (!cta) return;
      var all = [].slice.call(document.querySelectorAll(".ph-ind-sec, .ph-ind-sec-hero"));
      push({event: "ph_ind_cta", ph_industry: page, ph_cta: cta, ph_section: all.indexOf(sec)});
    }, true);
  }

  if (typeof module !== "undefined" && module.exports) { module.exports = {CALC: CALC, pharmCalc: pharmCalc, MODELS: MODELS}; return; }
  function start() { setupLoop(); setupFlow(); setupLines(); setupCalc(); setupLeadForm(); setupTour(); trackCtas(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
