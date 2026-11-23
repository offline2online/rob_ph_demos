// The six Seasonal designs (internally "occasions") (approved 20 Nov 2026): standalone, full-screen animations, one per occasion, with no brand
// panel, logo, brand colours, icon tiles or Open today bar. The source below is the approved prototype's template
// definitions (board documents "Occasion template designs", parts 1 and 2), unchanged except that each template's
// copy block (<div class="txt">) is left out: js/render.js draws the copy from each pharmacy's own content
// (OCCASIONS there says which beat holds which line), and the Christmas photo comes from css/occasion-media.css
// (var(--occ-photo)) instead of a christmas-tree.jpg beside the page.
//
// Decorations are scattered with a seeded generator, so the markup is the same on every screen and matches the
// prototype; keep the templates in this order (each one continues the random sequence of the one before).
//
// Rendering contract: <div class="occ occ-<id>"> + fx + <div class="txt"> with the beats .b1 .b2 .b3, filling the
// screen; the layout switches by a container query on .occ, so no orientation class is needed. Beats play in turn on
// a 12 s CSS loop (Christmas: 2 beats); on the player (.once, below) they play once and the last beat stays.
// OCCASION_CSS adds to the design:
//   - font sizes scaled by --k (set per beat by js/render.js fitOccasion() when a line is too long for the text box);
//   - .hold: one beat (.on) shown still, for a held scene, the editor's paused preview and the copy-fit audit;
//   - .once: the beats play once and the last one stays (the player); without it they loop (the editor, loop=1).
// Reduced motion: the decorations stand still, the beats still change (COMMON's media query).

/* deterministic scatter so the exported HTML is stable */
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rep = (n, f) => Array.from({length:n}, (_, i) => f(i)).join('');
const r = (a, b, d = 1) => +(a + rnd() * (b - a)).toFixed(d);

/* ---------- shared base: every template carries this ---------- */
const COMMON = `
.occ{position:relative;width:100%;height:100%;overflow:hidden;container:occ/size;font-family:var(--body);-webkit-font-smoothing:antialiased}
.occ *{box-sizing:border-box}
.occ .fx{position:absolute;pointer-events:none}
.occ .txt{position:absolute;inset:30% 8% 26%;display:grid;place-items:center;text-align:center;z-index:3}
.occ .b{grid-area:1/1;max-width:100%;opacity:0;text-wrap:balance;animation:12s var(--ease,cubic-bezier(.2,.7,.2,1)) infinite both}
.occ .b1{animation-name:occB1}.occ .b2{animation-name:occB2}.occ .b3{animation-name:occB3}
@keyframes occB1{0%{opacity:0;transform:var(--from,translateY(5cqmin))}5%,29%{opacity:1;transform:none}33%,100%{opacity:0;transform:var(--to,translateY(-3cqmin))}}
@keyframes occB2{0%,33%{opacity:0;transform:var(--from,translateY(5cqmin))}38%,62%{opacity:1;transform:none}66%,100%{opacity:0;transform:var(--to,translateY(-3cqmin))}}
@keyframes occB3{0%,66%{opacity:0;transform:var(--from,translateY(5cqmin))}71%,95%{opacity:1;transform:none}100%{opacity:0;transform:var(--to,translateY(-3cqmin))}}
@media (prefers-reduced-motion:reduce){.occ{--from:none!important;--to:none!important}.occ .fx,.occ .fx *,.occ .anim{animation:none!important}}
`;

const T = [];

const spark=(x,y)=>`<i style="left:${x}%;top:${y}%;--z:${r(1.4,4)}cqmin;--r:${r(0,45,0)}deg;animation-duration:${r(.9,2.6)}s;animation-delay:-${r(0,3)}s"></i>`;
/* ---------- 1. Christmas: real photo of a lit tree, very large centred copy ---------- */
T.push({
  id:'christmas', name:'Christmas', when:'25 December', uses:'Suburb + store name', bg:'christmas-tree.jpg',
  fx:`<div class="fx photo anim"></div><div class="fx shade"></div>
<div class="fx glow gp">${(()=>{let o='';[10,13.5,17,20.5,24,27.5,31,67,70.5,74,77.5,81,84].forEach(y=>{const h=Math.max(3,(y-6)/74*36)*.88,n=Math.max(1,Math.round(h/4.5));for(let k=0;k<n;k++){const x=(55.5-h+2*h*(k+.5)/n+(rnd()*2-1)*1.4).toFixed(1);o+=spark(x,(y+(rnd()*2-1)*.9).toFixed(1))}});return o})()}</div>
<div class="fx glow gl">${(()=>{let o='';for(let y=10;y<=88;y+=6.5){[[19,30],[70,85]].forEach(([a,b])=>{for(let k=0;k<2;k++){const x=(a+(b-a)*(k+.5)/2+(rnd()*2-1)*2).toFixed(1);o+=spark(x,(y+(rnd()*2-1)*1.5).toFixed(1))}})}return o})()}</div>`,
  css:`
.occ-christmas{--display:'Playfair Display',Georgia,serif;--body:'Outfit',system-ui,sans-serif;--from:translateY(3cqmin) scale(.97);--to:scale(1.02);--ease:cubic-bezier(.16,.84,.3,1);background:#0b1418;color:#fff}
.occ-christmas .photo{inset:-4%;background:var(--occ-photo,none) center 40%/cover no-repeat;animation:xmasDrift 24s ease-in-out infinite alternate}
@keyframes xmasDrift{from{transform:scale(1)}to{transform:scale(1.08) translateY(-1.5%)}}
.occ-christmas .shade{inset:0;background:radial-gradient(75% 45% at 50% 50%,rgba(6,12,16,.62),rgba(6,12,16,.2) 70%,transparent),linear-gradient(rgba(6,12,16,.35),rgba(6,12,16,.1) 35%,rgba(6,12,16,.1) 65%,rgba(6,12,16,.55))}
.occ-christmas .glow{inset:0}
.occ-christmas .gl{display:none}
.occ-christmas .glow i{position:absolute;width:var(--z);height:var(--z);margin:calc(var(--z)/-2) 0 0 calc(var(--z)/-2);border-radius:50%;
  background:radial-gradient(circle,#fffaf0 0 12%,rgba(255,222,140,.9) 22%,rgba(255,180,80,.3) 48%,transparent 70%);mix-blend-mode:screen;transform:rotate(var(--r));animation:xmasFlicker steps(1,end) infinite}
.occ-christmas .glow i::before,.occ-christmas .glow i::after{content:"";position:absolute;left:50%;top:50%;width:260%;height:8%;transform:translate(-50%,-50%);border-radius:50%;
  background:linear-gradient(90deg,transparent,rgba(255,240,200,.95) 50%,transparent)}
.occ-christmas .glow i::after{transform:translate(-50%,-50%) rotate(90deg)}
@keyframes xmasFlicker{0%{opacity:.15;transform:rotate(var(--r)) scale(.5)}12%{opacity:1;transform:rotate(var(--r)) scale(1.15)}22%{opacity:.55;transform:rotate(var(--r)) scale(.85)}30%{opacity:.95;transform:rotate(var(--r)) scale(1.05)}46%{opacity:.25;transform:rotate(var(--r)) scale(.6)}61%{opacity:.85;transform:rotate(var(--r)) scale(1)}74%{opacity:.4;transform:rotate(var(--r)) scale(.75)}86%{opacity:1;transform:rotate(var(--r)) scale(1.2)}}
@container occ (orientation:landscape){.occ-christmas .gp{display:none}.occ-christmas .gl{display:block}}
.occ-christmas .txt{inset:16% 6% 16%}
.occ-christmas .b1{animation-name:xmasB1}.occ-christmas .b2{animation-name:xmasB2}
@keyframes xmasB1{0%{opacity:0;transform:var(--from)}6%,44%{opacity:1;transform:none}50%,100%{opacity:0;transform:var(--to)}}
@keyframes xmasB2{0%,50%{opacity:0;transform:var(--from)}56%,94%{opacity:1;transform:none}100%{opacity:0;transform:var(--to)}}
.occ-christmas .hl{font:italic 600 17cqmin/1 var(--display);text-shadow:0 .4cqmin 3cqmin rgba(0,0,0,.6),0 0 6cqmin rgba(255,200,110,.35)}
.occ-christmas .kicker{font:500 4cqmin/1.2 var(--body);letter-spacing:.34em;text-transform:uppercase;color:#ffd98a;margin-bottom:3cqmin;text-shadow:0 .3cqmin 2cqmin rgba(0,0,0,.7)}
.occ-christmas .sub{font:500 11cqmin/1.05 var(--display);text-shadow:0 .4cqmin 3cqmin rgba(0,0,0,.6)}
@container occ (orientation:landscape){.occ-christmas .photo{background-position:center 38%}.occ-christmas .txt{inset:8% 10% 8%}.occ-christmas .hl{font-size:16cqmin}.occ-christmas .sub{font-size:10cqmin}}
`});

/* ---------- 2. New Year's: midnight sky, firework bursts, poster type ---------- */
const burst = (x, y, col, delay, n = 16) => `<div class="burst" style="left:${x}%;top:${y}%;color:${col};--d:${delay}s">${rep(n,i=>`<i style="--a:${(360/n*i).toFixed(1)}deg"></i>`)}</div>`;
T.push({
  id:'newyear', name:"New Year's", when:'1 January', uses:'Suburb + store name',
  fx:`<div class="fx stars">${rep(46,()=>`<i style="left:${r(0,100)}%;top:${r(0,100)}%;--z:${r(.25,.6,2)}cqmin;animation-delay:-${r(0,4)}s"></i>`)}</div>
<div class="fx sky">${burst(22,16,'#f3d9a4',0)}${burst(76,12,'#ff7a6b',.9)}${burst(52,26,'#5fd6d0',1.8)}${burst(16,78,'#ff7a6b',2.4,14)}${burst(84,74,'#f3d9a4',1.3,14)}${burst(60,88,'#5fd6d0',.4,12)}</div>`,
  css:`
.occ-newyear{--display:'Big Shoulders Display',Impact,sans-serif;--body:'Outfit',system-ui,sans-serif;--from:scale(.8);--to:scale(1.08);--ease:cubic-bezier(.2,1.35,.4,1);
  background:radial-gradient(90% 60% at 50% 105%,#3b2373 0%,#1a1442 45%,#08081c 100%);color:#fff7e8}
.occ-newyear .stars,.occ-newyear .sky{inset:0}
.occ-newyear .stars i{position:absolute;width:var(--z);height:var(--z);border-radius:50%;background:#fff;animation:nyTw 4s ease-in-out infinite}
@keyframes nyTw{0%,100%{opacity:.15}50%{opacity:.9}}
.occ-newyear .burst{position:absolute;width:0;height:0}
.occ-newyear .burst::before{content:"";position:absolute;left:-6cqmin;top:-6cqmin;width:12cqmin;height:12cqmin;border-radius:50%;background:radial-gradient(currentColor,transparent 65%);opacity:0;animation:nyFlash 3.2s var(--d) ease-out infinite}
.occ-newyear .burst i{position:absolute;left:-.6cqmin;top:-.6cqmin;width:1.2cqmin;height:1.2cqmin;border-radius:50%;background:currentColor;box-shadow:0 0 1.4cqmin currentColor;opacity:0;animation:nyFly 3.2s var(--d) cubic-bezier(.1,.7,.3,1) infinite}
@keyframes nyFly{0%{transform:rotate(var(--a)) translateX(0) scale(1);opacity:0}4%{opacity:1}55%{opacity:.9}100%{transform:rotate(var(--a)) translateX(20cqmin) translateY(4cqmin) scale(.25);opacity:0}}
@keyframes nyFlash{0%{opacity:0;transform:scale(.3)}5%{opacity:.7}30%,100%{opacity:0;transform:scale(1.4)}}
.occ-newyear .txt{inset:32% 8% 26%}
.occ-newyear .hl{font:900 22cqmin/.86 var(--display);text-transform:uppercase;letter-spacing:.01em;background:linear-gradient(#fff7e2,#f3d9a4 60%,#d9a95b);-webkit-background-clip:text;background-clip:text;color:transparent}
.occ-newyear .sub{font:800 10cqmin/1 var(--display);text-transform:uppercase;letter-spacing:.02em}
.occ-newyear .sub.sm{font-size:8cqmin;color:#f3d9a4}
.occ-newyear .kicker{font:400 4.6cqmin/1.25 var(--body);margin-bottom:3cqmin;color:#e9e3ff}
@container occ (orientation:landscape){.occ-newyear .txt{inset:14% 18% 14%}.occ-newyear .hl{font-size:21cqmin}}
`});

/* ---------- 3. Australia Day: waving Australian flag, flag colours (navy, red, white) ---------- */
const starPath = (cx, cy, n, R, rIn) => { let d = ''; for (let i = 0; i < n * 2; i++) { const rad = i % 2 ? rIn : R, a = Math.PI * i / n - Math.PI / 2; d += (i ? 'L' : 'M') + (cx + rad * Math.cos(a)).toFixed(1) + ' ' + (cy + rad * Math.sin(a)).toFixed(1); } return d + 'Z'; };
const AUS_FLAG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 500'><defs><clipPath id='s'><path d='M0 0v30h60V0z'/></clipPath><clipPath id='t'><path d='M30 15h30v15zv15H0zH0V0zV0h30z'/></clipPath></defs>
<rect width='1000' height='500' fill='#012169'/>
<g transform='scale(8.3333)' clip-path='url(#s)'><path d='M0 0v30h60V0z' fill='#012169'/><path d='M0 0l60 30m0-30L0 30' stroke='#fff' stroke-width='6'/><path d='M0 0l60 30m0-30L0 30' clip-path='url(#t)' stroke='#E4002B' stroke-width='4'/><path d='M30 0v30M0 15h60' stroke='#fff' stroke-width='10'/><path d='M30 0v30M0 15h60' stroke='#E4002B' stroke-width='6'/></g>
<g fill='#fff'><path d='${starPath(250,375,7,75,33.3)}'/><path d='${starPath(750,416.7,7,35.7,15.9)}'/><path d='${starPath(625,218.8,7,35.7,15.9)}'/><path d='${starPath(750,83.3,7,35.7,15.9)}'/><path d='${starPath(861.1,185.4,7,35.7,15.9)}'/><path d='${starPath(800,270.8,5,20.8,8.3)}'/></g></svg>`;
const FLAG_URL = `url("data:image/svg+xml,${encodeURIComponent(AUS_FLAG)}")`;
const STRIPS = 60;
T.push({
  id:'ausday', name:'Australia Day', when:'26 January', uses:'Suburb',
  fx:`<div class="fx sky">${rep(40,()=>`<i style="left:${r(0,100)}%;top:${r(0,100)}%;--z:${r(.25,.7,2)}cqmin;animation-delay:-${r(0,5)}s"></i>`)}</div>
<div class="fx halo"></div><div class="fx pole"></div><div class="fx flag">${rep(STRIPS,k=>`<i style="left:${(k*100/STRIPS).toFixed(3)}%;background-position:${(k*100/(STRIPS-1)).toFixed(3)}% 0;--amp:${(0.4+k/STRIPS*2.2).toFixed(2)}cqmin;animation-delay:-${(k*0.045).toFixed(3)}s"></i>`)}</div>`,
  css:`
.occ-ausday{--display:'Archivo Black','Arial Black',sans-serif;--body:'Archivo',Arial,sans-serif;--from:translateY(5cqmin);--to:translateY(-3cqmin);--ease:cubic-bezier(.22,1,.36,1);
  background:radial-gradient(90% 60% at 50% 30%,#0a2f86 0%,#012169 45%,#000f38 100%);color:#fff}
.occ-ausday .sky{inset:0}
.occ-ausday .sky i{position:absolute;width:var(--z);height:var(--z);border-radius:50%;background:#fff;animation:adTw 5s ease-in-out infinite}
@keyframes adTw{0%,100%{opacity:.15}50%{opacity:.85}}
.occ-ausday .halo{left:-10%;right:-10%;top:0;height:46%;background:radial-gradient(50% 50% at 50% 50%,rgba(70,130,255,.45),transparent 70%)}
.occ-ausday .pole{left:calc(10cqw - 1.4cqmin);top:calc(13% - 3cqmin);width:1.4cqmin;height:calc(42cqw + 18cqmin);border-radius:1cqmin;background:linear-gradient(90deg,#8d96a8,#f4f6fa 45%,#9aa3b5)}
.occ-ausday .pole::before{content:"";position:absolute;left:50%;top:-2.4cqmin;width:3.4cqmin;height:3.4cqmin;margin-left:-1.7cqmin;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff,#c9a24a 60%,#8a6a22)}
.occ-ausday .flag{left:10cqw;top:13%;width:80cqw;height:40cqw;filter:drop-shadow(0 2.5cqmin 4cqmin rgba(0,0,0,.55))}
.occ-ausday .flag i{position:absolute;top:0;width:calc(100% / ${STRIPS} + 2px);height:100%;background-image:${FLAG_URL};background-size:${STRIPS * 100}% 100%;background-repeat:no-repeat;animation:adWave 2.6s ease-in-out infinite}
@keyframes adWave{0%,100%{transform:translateY(calc(var(--amp) * -1));filter:brightness(1.1)}50%{transform:translateY(var(--amp));filter:brightness(.86)}}
.occ-ausday .txt{inset:44% 7% 12%}
.occ-ausday .kicker{display:flex;align-items:center;justify-content:center;gap:2.4cqmin;font:700 3.8cqmin/1 var(--body);letter-spacing:.32em;text-transform:uppercase;margin-bottom:3.4cqmin}
.occ-ausday .kicker::before,.occ-ausday .kicker::after{content:"";width:8cqmin;height:.6cqmin;background:#E4002B}
.occ-ausday .hl{font:400 11cqmin/1.04 var(--display)}
.occ-ausday .sub{font:700 5.2cqmin/1.2 var(--body);margin-top:3.4cqmin;background:#E4002B;display:inline-block;padding:1.4cqmin 4cqmin;border-radius:99cqmin}
@container occ (orientation:landscape){.occ-ausday .halo{top:10%;height:80%;right:45%}.occ-ausday .pole{left:calc(6cqw - 1.4cqmin);top:calc(50% - 24cqmin);height:62cqmin}.occ-ausday .flag{left:6cqw;top:50%;width:84cqmin;height:42cqmin;margin-top:-21cqmin}.occ-ausday .txt{inset:12% 4% 12% 52%}.occ-ausday .hl{font-size:10cqmin}}
`});

/* ---------- 4. Valentine's Day: blush, rising hearts, editorial serif ---------- */
const HEART = c => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 29'><path fill='${c}' d='M16 29 2.7 15.9A8.6 8.6 0 0 1 16 4.8a8.6 8.6 0 0 1 13.3 11.1Z'/></svg>`)}")`;
T.push({
  id:'valentine', name:"Valentine's Day", when:'14 February', uses:'Suburb',
  fx:`<div class="fx pulse anim"></div>
<div class="fx hearts">${rep(20,i=>`<i style="left:${r(2,94)}%;--z:${r(3.5,10)}cqmin;--x:${r(-6,6)}cqmin;--o:${r(.45,.95,2)};--h:${['#e0475f','#b3123f','#ffffff','#f28a9b'][i%4]};animation-duration:${r(9,16)}s;animation-delay:-${r(0,16)}s"></i>`)}</div>`,
  css:`
.occ-valentine{--display:'DM Serif Display',Georgia,serif;--body:'Outfit',system-ui,sans-serif;--from:scale(.94) translateY(2cqmin);--to:scale(1.03);--ease:cubic-bezier(.25,.8,.25,1);
  background:radial-gradient(100% 70% at 50% 46%,#fff4f2 0%,#f9d6d8 58%,#f0b3bc 100%);color:#5c0b26}
.occ-valentine .pulse{left:50%;top:50%;width:90cqmin;height:82cqmin;transform:translate(-50%,-52%);background:${HEART('rgba(179,18,63,.07)')} center/contain no-repeat;animation:vaBeat 2.4s ease-in-out infinite}
@keyframes vaBeat{0%,100%{transform:translate(-50%,-52%) scale(1)}12%{transform:translate(-50%,-52%) scale(1.06)}24%{transform:translate(-50%,-52%) scale(1)}36%{transform:translate(-50%,-52%) scale(1.04)}}
.occ-valentine .hearts{inset:0}
.occ-valentine .hearts i{position:absolute;bottom:-12cqmin;width:var(--z);height:calc(var(--z)*.9);background:var(--h);-webkit-mask:${HEART('#000')} center/contain no-repeat;mask:${HEART('#000')} center/contain no-repeat;opacity:0;animation:vaRise linear infinite}
@keyframes vaRise{0%{transform:translate(0,0) rotate(-8deg);opacity:0}10%{opacity:var(--o)}50%{transform:translate(var(--x),-60cqh) rotate(8deg)}85%{opacity:var(--o)}100%{transform:translate(0,-118cqh) rotate(-6deg);opacity:0}}
.occ-valentine .txt{inset:30% 9% 28%}
.occ-valentine .kicker{font:500 3.2cqmin/1 var(--body);letter-spacing:.34em;text-transform:uppercase;color:#b3123f;margin-bottom:3cqmin}
.occ-valentine .hl{font:italic 400 11cqmin/1.04 var(--display);color:#8e0e35}
@container occ (orientation:landscape){.occ-valentine .txt{inset:18% 16% 18%}.occ-valentine .hl{font-size:12.5cqmin}}
`});

/* ---------- 5. Easter: pastel meadow with bouncing painted eggs ---------- */
const EGGS = [
  ['#f6cf5b','repeating-linear-gradient(0deg,transparent 0 22%,#f08a7e 22% 30%)'],
  ['#8f7ad8','radial-gradient(circle,#f6cf5b 18%,transparent 20%) 0 0/34% 26%'],
  ['#4fb79a','repeating-linear-gradient(-30deg,transparent 0 16%,#fff 16% 22%)'],
  ['#f08a7e','repeating-linear-gradient(0deg,transparent 0 30%,#fff7d6 30% 36%,transparent 36% 44%,#8f7ad8 44% 50%)'],
  ['#b7a8f0','radial-gradient(circle,#fff 16%,transparent 18%) 0 0/30% 22%']
];
T.push({
  id:'easter', name:'Easter', when:'Easter long weekend', uses:'Suburb',
  fx:`<div class="fx meadow">${rep(14,()=>`<i style="left:${r(2,96)}%;top:${r(8,80)}%;--z:${r(1.6,3)}cqmin;--f:${['#ffffff','#f6cf5b','#f08a7e','#b7a8f0'][Math.floor(rnd()*4)]}"></i>`)}</div>
<div class="fx eggs">${rep(5,i=>`<i style="left:${14+i*18}%;--c:${EGGS[i][0]};--p:${EGGS[i][1]};animation-delay:${(i*.18).toFixed(2)}s"></i>`)}</div>`,
  css:`
.occ-easter{--display:'Fredoka','Trebuchet MS',sans-serif;--body:'Fredoka','Trebuchet MS',sans-serif;--from:translateY(7cqmin) scale(.9);--to:scale(.96);--ease:cubic-bezier(.34,1.56,.64,1);
  background:linear-gradient(#e9e2ff 0%,#f6f2ff 70%,#d5f0e4 70%,#bfe6d4 100%);color:#45358a}
.occ-easter .meadow{left:0;right:0;bottom:0;height:30%}
.occ-easter .meadow i{position:absolute;width:var(--z);height:var(--z);border-radius:50%;
  background:radial-gradient(circle,#f6cf5b 22%,transparent 24%),radial-gradient(circle at 50% 10%,var(--f) 26%,transparent 28%),radial-gradient(circle at 90% 45%,var(--f) 26%,transparent 28%),radial-gradient(circle at 74% 92%,var(--f) 26%,transparent 28%),radial-gradient(circle at 26% 92%,var(--f) 26%,transparent 28%),radial-gradient(circle at 10% 45%,var(--f) 26%,transparent 28%)}
.occ-easter .eggs{left:0;right:0;bottom:32%;height:0}
.occ-easter .eggs i{position:absolute;bottom:0;width:13cqmin;height:17cqmin;margin-left:-6.5cqmin;border-radius:50% 50% 50% 50%/62% 62% 40% 40%;
  background:radial-gradient(circle at 34% 28%,rgba(255,255,255,.55) 0 10%,transparent 26%),var(--p),var(--c);box-shadow:inset -1.6cqmin -1.4cqmin 0 rgba(0,0,0,.08);transform-origin:50% 100%;animation:eaHop 2.4s ease-in-out infinite}
.occ-easter .eggs i::after{content:"";position:absolute;left:10%;right:10%;bottom:-2.6cqmin;height:2cqmin;border-radius:50%;background:rgba(40,90,70,.18);animation:eaShadow 2.4s ease-in-out infinite;animation-delay:inherit}
@keyframes eaHop{0%,60%,100%{transform:translateY(0) scale(1,1)}10%{transform:translateY(0) scale(1.08,.9)}25%{transform:translateY(-9cqmin) scale(.95,1.06) rotate(-6deg)}40%{transform:translateY(0) scale(1.06,.93)}50%{transform:translateY(-2cqmin) rotate(4deg)}}
@keyframes eaShadow{0%,60%,100%{transform:scale(1);opacity:1}25%{transform:scale(.6);opacity:.4}}
.occ-easter .txt{inset:22% 8% 46%}
.occ-easter .hl{font:600 10.5cqmin/1.05 var(--display)}
@container occ (orientation:landscape){.occ-easter{background:linear-gradient(#e9e2ff 0%,#f6f2ff 66%,#d5f0e4 66%,#bfe6d4 100%)}.occ-easter .meadow{height:34%}.occ-easter .eggs{bottom:30%}.occ-easter .txt{inset:8% 14% 52%}.occ-easter .hl{font-size:11cqmin}}
`});

/* ---------- 6. Anzac Day: solemn dawn, single poppy, slow fades only ---------- */
T.push({
  id:'anzac', name:'Anzac Day', when:'25 April', uses:'Suburb',
  fx:`<div class="fx dawn anim"></div><div class="fx horizon"></div>
<svg class="fx poppy anim" viewBox="0 0 100 100" aria-hidden="true">
  <g transform="translate(50 50)">
    <ellipse rx="22" ry="27" transform="rotate(0) translate(0 -20)" fill="#a8191a"/>
    <ellipse rx="22" ry="27" transform="rotate(90) translate(0 -20)" fill="#b81f1f"/>
    <ellipse rx="22" ry="27" transform="rotate(180) translate(0 -20)" fill="#a8191a"/>
    <ellipse rx="22" ry="27" transform="rotate(270) translate(0 -20)" fill="#c62a26"/>
    <circle r="11" fill="#141414"/><circle r="5" fill="#2b2b2b"/>
    ${rep(10,i=>{const a=i*36*Math.PI/180;return `<circle cx="${(Math.cos(a)*8).toFixed(2)}" cy="${(Math.sin(a)*8).toFixed(2)}" r="1.2" fill="#3a3a3a"/>`})}
  </g>
</svg>`,
  css:`
.occ-anzac{--display:'Cormorant Garamond',Garamond,Georgia,serif;--body:'Cormorant Garamond',Georgia,serif;--from:none;--to:none;--ease:ease-in-out;background:#111216;color:#efe6d8}
.occ-anzac .b{animation-timing-function:ease-in-out}
.occ-anzac .dawn{left:-20%;right:-20%;bottom:-10%;height:70%;background:radial-gradient(55% 60% at 50% 100%,rgba(220,128,52,.6),rgba(150,70,40,.25) 45%,transparent 72%);animation:azDawn 12s ease-in-out infinite alternate}
@keyframes azDawn{from{opacity:.35;transform:translateY(6%)}to{opacity:.9;transform:none}}
.occ-anzac .horizon{left:12%;right:12%;bottom:22%;height:.15cqmin;background:linear-gradient(90deg,transparent,rgba(239,230,216,.35),transparent)}
.occ-anzac .poppy{left:50%;top:20%;width:30cqmin;height:30cqmin;margin-left:-15cqmin;filter:drop-shadow(0 1.5cqmin 3cqmin rgba(0,0,0,.5));animation:azPoppy 12s ease-in-out infinite alternate}
@keyframes azPoppy{from{opacity:.75;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
.occ-anzac .txt{inset:46% 10% 26%}
.occ-anzac .kicker{font:600 3.4cqmin/1 var(--body);letter-spacing:.4em;text-transform:uppercase;color:#c9a45c;margin-bottom:3cqmin}
.occ-anzac .hl{font:500 13cqmin/1 var(--display);letter-spacing:.01em}
.occ-anzac .sub{font:italic 500 8cqmin/1.12 var(--display)}
@container occ (orientation:landscape){.occ-anzac .poppy{left:24%;top:30%;width:36cqmin;height:36cqmin;margin-left:-18cqmin}.occ-anzac .txt{inset:20% 8% 24% 42%}.occ-anzac .horizon{bottom:16%}}
`});

/** Design key ('christmas', 'newyear', …) -> {fx, css}: the decoration markup and the template's own CSS. */
export const OCCASION_DESIGNS = Object.fromEntries(T.map((t) => [t.id, { fx: t.fx, css: t.css }]));

// Every font size in the designs, scaled by the beat's --k (1 unless the copy needs shrinking to fit its box).
const scaleFonts = (css) => css.replace(/(font(?:-size)?:[^;}]*)/g, (decl) => decl.replace(/(\d*\.?\d+)cqmin/g, 'calc($1cqmin*var(--k,1))'));
const HOLD = `
.occ.hold .b{animation:none;opacity:0;transform:none}
.occ.hold .b.on{opacity:1}
.occ.once .b{animation-iteration-count:1}
.occ.once .b3{animation-name:occB3Once}
.occ-christmas.once .b2{animation-name:xmasB2Once}
@keyframes occB3Once{0%,66%{opacity:0;transform:var(--from,translateY(5cqmin))}71%,100%{opacity:1;transform:none}}
@keyframes xmasB2Once{0%,50%{opacity:0;transform:var(--from)}56%,100%{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.occ .fx::before,.occ .fx::after,.occ .fx *::before,.occ .fx *::after,.occ .anim::before,.occ .anim::after{animation:none!important}}
`;
// .once: the beats play one time through and the last beat stays on screen, fully drawn (the player, unless loop=1):
// each beat runs its keyframes once (fill-mode both keeps where it ends), and the last beat (.b3, Christmas .b2) runs
// a copy of its design's keyframes that ends visible instead of fading out. The decorations (.fx) keep moving.
// Reduced motion: COMMON stills .fx, .fx * and .anim but not their ::before/::after (New Year's flashes, Easter's egg
// shadows), so the last rule above stills those too. The beats (.b) keep changing.
/** All six templates' CSS: the shared base, each design, the held-beat and reduced-motion rules. Injected once per document. */
export const OCCASION_CSS = scaleFonts(COMMON + T.map((t) => t.css).join('')) + HOLD;
