<?php return <<<'PHTOUR'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Interactive product tour · Telco Retail | Personalisation Hub</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;600;700&family=Roboto:wght@400;500;700;900&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=block">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0&display=block">
<style>
/* Layout: tour chrome (brand bar, flow chips, controls) wraps a fixed 1280x760 product stage that scales to fit. */
:root{
  --bg:#f4f7f9; --panel:#ffffff; --fg:#1d2730; --muted:#5b6873; --line:#dde4ea;
  --teal:#169bc2; --violet:#9747ff; --chip:#eaf5f9;
  --display:"Kantumruy Pro","Roboto",system-ui,sans-serif;
  --ui:"Roboto","Helvetica Neue",Helvetica,Arial,sans-serif;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#11161b; --panel:#192027; --fg:#e7edf2; --muted:#9aa8b4; --line:#2a343d; --chip:#16303a; color-scheme:dark}}
:root[data-theme="dark"]{--bg:#11161b; --panel:#192027; --fg:#e7edf2; --muted:#9aa8b4; --line:#2a343d; --chip:#16303a; color-scheme:dark}
html{scrollbar-gutter:stable}
html,body{background:var(--bg);color:var(--fg)}
body{font-family:var(--ui);padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:20px 40px}
.wrap{max-width:1300px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.ms{font-family:"Material Symbols Outlined";font-weight:400;font-style:normal;font-size:20px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;direction:ltr;-webkit-font-smoothing:antialiased;font-feature-settings:"liga";vertical-align:middle}

/* ---------- tour chrome ---------- */
.top{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px 24px}
.top h1,.top h2{font-family:var(--display);font-size:clamp(22px,3vw,30px);line-height:1.15;margin:0;text-wrap:balance}
.top p{margin:4px 0 0;color:var(--muted);font-size:14px;max-width:60ch}
.mark{display:inline-flex;align-items:center;gap:8px;font-family:var(--display);font-size:13px;color:var(--muted);margin-bottom:6px;letter-spacing:.3px}
.prefs{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--panel)}
.seg button{all:unset;cursor:pointer;padding:7px 14px;font-size:13px;color:var(--fg);display:flex;align-items:center;gap:6px}
.seg button[aria-pressed="true"]{background:var(--teal);color:#fff}
.seg button:focus-visible,.chip:focus-visible,.ctl:focus-visible,.dot:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
.field{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:4px 6px 4px 10px}
.field label{font-size:12px;color:var(--muted)}
.field input[type=text]{all:unset;font-size:13px;width:150px;color:var(--fg)}
.field input[type=color]{width:26px;height:26px;border:0;padding:0;background:none;cursor:pointer}
.flows{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;scrollbar-width:thin}
.chip{all:unset;cursor:pointer;flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:var(--panel);font-size:13px;color:var(--fg)}
.chip .n{font-variant-numeric:tabular-nums;color:var(--muted)}
.chip[aria-current="true"]{border-color:var(--teal);background:var(--chip)}
.chip[aria-disabled="true"]{cursor:default;opacity:.55}
.chip small{font-size:11px;color:var(--muted)}
.stagebox{position:relative;width:100%;box-sizing:content-box;aspect-ratio:1280/760;contain:strict;border-radius:10px;overflow:hidden;border:1px solid var(--line);background:#fff;box-shadow:0 10px 30px rgba(10,30,45,.12)}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px}
.ctl{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--fg)}
.ctl.main{background:var(--teal);border-color:var(--teal);color:#fff}
.dots{display:flex;gap:6px;align-items:center}
.dot{all:unset;cursor:pointer;width:26px;height:6px;border-radius:99px;background:var(--line)}
.dot[aria-current="true"]{background:var(--teal)}
.dot.done{background:color-mix(in srgb,var(--teal) 45%,var(--line))}
.cap{flex:1 1 0;min-width:0;text-align:right}
@media (min-width:600px){.cap b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
@media (min-width:600px) and (max-width:899px){.dot{width:12px}}
@media (max-width:599px){.cap{order:5;flex:1 1 280px;text-align:left}.fsbtn{order:6;margin-left:auto}}
.cap b{display:block;font-family:var(--display);font-size:16px}
.cap span{color:var(--muted);font-size:14px}
.fine{font-size:12px;color:var(--muted)}
.proto{border:1.5px dashed var(--line);border-radius:10px;padding:12px 14px;display:flex;flex-wrap:wrap;gap:10px 20px;align-items:center;justify-content:space-between;background:color-mix(in srgb,var(--panel) 70%,transparent)}
.proto-calc{display:flex;gap:10px;align-items:center}.proto-calc .ms{color:var(--muted)}.proto-calc b{display:block;font-size:14px}.proto-calc small{color:var(--muted);font-size:12.5px}
.proto-ctl{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px;color:var(--muted)}.proto-ctl span{text-transform:uppercase;letter-spacing:.6px;font-weight:600}
.proto-ctl button{all:unset;cursor:pointer;font-size:13px;padding:7px 12px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--fg)}.proto-ctl button:focus-visible{outline:2px solid var(--teal)}
.tourbox{position:relative;container-type:inline-size}
.wrap.locked .flows,.wrap.locked .bar,.wrap.locked .prefs{display:none}
.gate{position:absolute;inset:0;z-index:5;border-radius:10px;overflow:hidden;display:flex;justify-content:flex-end;pointer-events:none}
.gate::before{content:"";position:absolute;inset:0;background:linear-gradient(270deg,rgba(8,18,28,.94) 0%,rgba(8,18,28,.82) 30%,rgba(8,18,28,.25) 58%,rgba(8,18,28,.05) 100%)}
.g-panel{position:relative;width:min(440px,44%);box-sizing:border-box;padding:clamp(18px,2.6cqw,34px);display:flex;flex-direction:column;justify-content:center;gap:12px;color:#fff;pointer-events:auto;font-family:var(--ui)}
.g-eb{font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:#7fd3ea;display:flex;align-items:center;gap:6px;font-weight:600}.g-eb .ms{font-size:18px}
.g-panel h3{font-family:var(--display);font-size:clamp(20px,2.3cqw,29px);line-height:1.15;margin:0;text-wrap:balance;font-weight:700}
.g-panel p{margin:0;color:rgba(255,255,255,.8);font-size:14px;line-height:1.5}
.g-flows{display:flex;flex-direction:column;gap:8px;margin-top:4px}
.g-flow{all:unset;cursor:pointer;position:relative;overflow:hidden;display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);transition:background .2s,border-color .2s}
.g-flow:hover,.g-flow.gl-on{background:rgba(22,155,194,.2);border-color:#38b0cf}.g-flow:focus-visible{outline:2px solid #7fd3ea;outline-offset:2px}
.g-flow>.ms{width:36px;height:36px;border-radius:9px;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;font-size:20px;color:#7fd3ea;flex:none}
.g-flow b{display:block;font-size:14.5px;font-weight:600}.g-flow small{display:block;font-size:12px;color:rgba(255,255,255,.72);margin-top:2px}
.g-flow .g-go{margin-left:auto;display:flex;align-items:center;font-size:12.5px;color:#7fd3ea;white-space:nowrap;font-weight:600}.g-flow .g-go .ms{font-size:18px}
.g-flow i{position:absolute;left:0;bottom:0;height:3px;width:0;background:linear-gradient(90deg,#169bc2,#9747ff)}
.g-flow.gl-on i{animation:gbar var(--tdur,6.6s) linear forwards}@keyframes gbar{to{width:100%}}
.g-cap{position:absolute;left:18px;bottom:18px;max-width:50%;background:rgba(8,18,28,.82);color:#fff;border-radius:999px;padding:8px 14px 8px 10px;font-size:13px;display:flex;align-items:center;gap:8px;pointer-events:none;z-index:1}.g-cap .ms{font-size:18px;color:#7fd3ea}
.g-form{display:flex;flex-direction:column;gap:9px}
.g-form label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:rgba(255,255,255,.78)}
.g-form input[type=text],.g-form input[type=email]{all:unset;box-sizing:border-box;height:38px;padding:0 12px;border-radius:8px;background:#fff;color:#1C2540;font-size:14px}
.g-form input[type=text]:focus-visible,.g-form input[type=email]:focus-visible{outline:2px solid #38b0cf;outline-offset:1px}
.g-form .g-cons{flex-direction:row;align-items:flex-start;gap:8px;font-size:12.5px;line-height:1.45;color:rgba(255,255,255,.85)}
.g-cons input{margin:2px 0 0;accent-color:#60D838;width:16px;height:16px;flex:none}.g-cons a{color:#7fd3ea}
.g-sub{all:unset;cursor:pointer;height:42px;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600;font-size:15px;background:#DCE1EB;color:#5A6479;margin-top:2px}
.g-sub.ok{background:#60D838;color:#1C2540}.g-sub:focus-visible{outline:2px solid #7fd3ea;outline-offset:2px}
.g-err{color:#ffb4a9;font-size:12px}.g-err:empty{display:none}
.g-back{all:unset;cursor:pointer;font-size:12.5px;color:rgba(255,255,255,.72);display:inline-flex;align-items:center;gap:2px;align-self:flex-start}.g-back .ms{font-size:18px}
.g-sel{display:flex;align-items:center;gap:10px;background:rgba(22,155,194,.2);border:1px solid #38b0cf;border-radius:10px;padding:9px 12px}.g-sel>.ms{color:#7fd3ea}.g-sel b{display:block;font-size:14px}.g-sel small{font-size:12px;color:rgba(255,255,255,.72)}
@container (max-width: 760px){
  .gate{position:static;margin-top:12px;pointer-events:auto;background:#0e1a24;justify-content:stretch}
  .gate::before,.g-cap{display:none}
  .g-panel{width:100%}
}
#stage.teasing #cursor,#stage.teasing #tip,#stage.teasing #ring{display:none}
#card .acts a{all:unset;cursor:pointer;height:40px;padding:0 18px;border-radius:8px;display:inline-flex;align-items:center;gap:8px;font-size:15px}
#card .acts a.go{background:linear-gradient(135deg,#169bc2,#9747ff);color:#fff;font-weight:500}#card .acts a:focus-visible{outline:2px solid #169bc2;outline-offset:2px}

/* ---------- product stage (fixed light product UI) ---------- */
#stage{position:absolute;left:0;top:0;width:1280px;height:760px;transform-origin:0 0;font-family:var(--ui);font-size:14px;color:#333;background:#fff;overflow:hidden;color-scheme:light}
#stage *{box-sizing:border-box}
.app{position:absolute;inset:0;display:grid;grid-template-columns:256px 1fr;grid-template-rows:100%}
#layer{position:absolute;inset:0;pointer-events:none;z-index:5}#layer:empty{display:none}
.side{background:#333;display:flex;flex-direction:column;padding:0 4px 8px}
.side .logo{height:100px;display:flex;align-items:center;justify-content:center;gap:10px;color:#fff}
.side .logo .wm{font-weight:700;font-size:17px;line-height:1.1;max-width:150px}
.nav{display:flex;flex-direction:column;gap:4px}
.nav div{height:40px;display:flex;align-items:center;gap:12px;padding:0 16px 0 24px;border-radius:8px;color:rgba(255,255,255,.65);font-size:14px;text-transform:uppercase;letter-spacing:.2px}
.nav div.on{background:#169bc2;color:#fff}
.nav.bottom{margin-top:auto}
.mainc{display:flex;flex-direction:column;min-width:0;position:relative}
.hdr{height:60px;flex:0 0 60px;display:flex;align-items:center;gap:14px;padding:0 20px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08);z-index:2}
.hdr .ph{display:flex;align-items:center;gap:8px;font-size:22px;color:#666}
.hdr .ph b{color:#444}
.env{margin-left:auto;background:#222;color:#fff;border-radius:999px;font-size:12px;padding:5px 12px;display:flex;align-items:center;gap:6px}
.content{flex:1;overflow:hidden;position:relative;padding:20px 20px 40px}
.scroller{position:absolute;inset:0;overflow:hidden}
.sci{padding:18px 72px 60px 24px;will-change:transform}
.crumb{color:rgba(0,0,0,.45);font-size:14px;margin-bottom:22px}
.crumb b{color:#333;font-weight:400}
.title{font-size:20px;font-weight:700;color:#333}
.hr{height:1px;background:rgba(5,5,5,.06);margin:16px 0}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.txtbtn{padding:6px 12px;border-radius:6px;color:#333}
.aibtn{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 15px;border-radius:6px;background:linear-gradient(135deg,rgba(22,155,194,.2),rgba(151,71,255,.2))}
.aibtn span:last-child{background:linear-gradient(135deg,#169bc2,#9747ff);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:500}
.aibtn .ms{color:#5f7fe0;font-size:18px}
.aibtn.off{opacity:.45}
.fab{position:absolute;right:28px;bottom:26px;width:62px;height:62px;border-radius:50%;background:linear-gradient(135deg,#169bc2,#9747ff);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 6px 16px rgba(80,60,200,.35);z-index:3}
.fab .ms{font-size:30px}
/* grid */
.grid{border:1px solid rgba(24,29,31,.15);border-radius:4px;overflow:hidden}
.gh,.gr{display:grid;grid-template-columns:48px 80px 150px 1fr 150px 210px 48px;align-items:center}
.gh{background:#f8f8f8;font-weight:700;font-size:13px;color:#181d1f;height:40px;border-bottom:1px solid rgba(24,29,31,.15)}
.gh>div,.gr>div{padding:0 12px}
.gr{height:76px;border-bottom:1px solid rgba(24,29,31,.1);background:#fff}
.gr.new{animation:rowin .7s ease both;background:#e8fdff}
@keyframes rowin{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.cb{width:16px;height:16px;border:1px solid #d9d9d9;border-radius:4px;display:inline-block}
.sd{width:8px;height:8px;border-radius:50%;display:inline-block;background:#52c41a}
.pill{display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 14px;border:1px solid #d1d5db;border-radius:999px;font-size:11px;letter-spacing:.3px}
.nm{display:flex;align-items:center;gap:12px;font-weight:700;min-width:0}
.nm span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.thumb{width:76px;height:43px;border-radius:3px;overflow:hidden;flex:0 0 76px;background:#eee}
.thumb svg,.asset svg,.frame svg{display:block;width:100%;height:100%}
.tps{display:flex;gap:6px;color:#169bc2}
.tps .ms{font-size:18px;background:#eef8fb;border-radius:6px;padding:4px}
.muted{color:rgba(0,0,0,.45)}
.pager{display:flex;justify-content:flex-end;gap:8px;align-items:center;margin-top:12px;font-size:13px}
.pager .pg{border:1px solid #169bc2;color:#169bc2;font-weight:600;border-radius:6px;padding:3px 9px}
/* modal */
.mask{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding-top:80px;z-index:5;animation:fade .25s ease both}
@keyframes fade{from{opacity:0}to{opacity:1}}
.modal{width:540px;background:#fff;border-radius:8px;padding:20px 24px;box-shadow:0 12px 40px rgba(0,0,0,.25);animation:pop .3s ease both}
@keyframes pop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
.modal h3{margin:0 0 14px;font-size:16px;font-weight:700;display:flex;justify-content:space-between}
.info{background:#eaf6fb;border:1px solid #9fd6e8;border-radius:6px;padding:9px 12px;display:flex;gap:10px;align-items:center;font-size:14px;color:#333}
.info u{color:#333}
.lbl{font-size:14px;margin:14px 0 8px}
.lbl i{color:#ff4d4f;font-style:normal;margin-right:4px}
.ta{position:relative;border:1px solid #d9d9d9;border-radius:6px;min-height:84px;padding:8px 36px 8px 11px;font-size:15px;line-height:1.55;color:#333;white-space:pre-wrap}
.ta.focus{border-color:#169bc2;box-shadow:0 0 0 2px rgba(22,155,194,.15)}
.ta .ph{color:#bfbfbf}
.ta .mic{position:absolute;right:8px;bottom:6px;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#1677ff;transition:background .2s,color .2s}
.ta .mic .ms{font-size:19px}
.ta .mic.rec{background:#ff4d4f;color:#fff;animation:pulse 1.4s ease-out infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,77,79,.45)}100%{box-shadow:0 0 0 12px rgba(255,77,79,0)}}
.interim{color:#9aa5ae}
.vrow{display:flex;align-items:center;gap:8px;color:#e5484d;font-size:13px;margin-top:8px;height:18px}
.wave{display:inline-flex;gap:2px;align-items:center;height:16px}
.wave i{width:3px;height:5px;background:#ff4d4f;border-radius:2px;animation:wv .9s ease-in-out infinite}
.wave i:nth-child(2){animation-delay:.12s}.wave i:nth-child(3){animation-delay:.24s}.wave i:nth-child(4){animation-delay:.36s}.wave i:nth-child(5){animation-delay:.48s}
@keyframes wv{0%,100%{height:4px}50%{height:16px}}
.aibtn.busy .ms{animation:spin 1s linear infinite}
.writing{display:flex;flex-direction:column;align-items:center;gap:10px;padding:26px 0 18px;text-align:center}
.writing .orb{width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#169bc2,#9747ff);display:flex;align-items:center;justify-content:center;color:#fff;animation:breathe 1.6s ease-in-out infinite}
.writing .orb .ms{font-size:28px}
@keyframes breathe{0%,100%{transform:scale(.94)}50%{transform:scale(1.04)}}
.caret{display:inline-block;width:1px;height:1.1em;background:#333;vertical-align:-3px;animation:blink 1s steps(1) infinite}.caret.typing{animation:none}
@keyframes blink{50%{opacity:0}}
.checks{display:grid;grid-template-columns:repeat(3,auto);gap:8px 18px;justify-content:start;margin-top:4px;font-size:14px}
.ck{display:flex;align-items:center;gap:6px}
.ck .ms{font-size:20px;color:#bbb}
.ck.load .ms{color:#bbb;animation:spin 1s linear infinite}
.ck.ok .ms{color:#52c41a;font-weight:700}
@keyframes spin{to{transform:rotate(360deg)}}
.foot{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}
.btn{height:32px;padding:0 15px;border:1px solid #d9d9d9;border-radius:6px;display:inline-flex;align-items:center;background:#fff}
.btn.pri{background:#169bc2;border-color:#169bc2;color:#fff}
.btn.dis{background:#f5f5f5;color:#bfbfbf;border-color:#d9d9d9}
.build{display:flex;flex-direction:column;gap:10px;margin-top:6px}
.bs{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #eef0f2;border-radius:8px;font-size:14px;color:#999;transition:all .3s}
.bs .ms{font-size:20px}
.bs.on{color:#333;border-color:#cfe9f2;background:#f5fbfd}
.bs.on .ms{color:#169bc2;animation:spin 1s linear infinite}
.bs.ok{color:#333}
.bs.ok .ms{color:#52c41a;animation:none}
.bs small{margin-left:auto;color:rgba(0,0,0,.45)}
/* detail */
.status{display:flex;align-items:center;gap:8px}
.sw{width:44px;height:22px;border-radius:999px;background:#bfbfbf;position:relative;transition:background .3s}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .3s}
.sw.on{background:#169bc2}.sw.on::after{left:24px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:10px 0 12px}
#insw{min-height:8px}.insin{animation:insin .6s ease both}
@keyframes insin{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.eng{display:flex;align-items:center;gap:16px;border-top:1px solid rgba(0,0,0,.05);border-bottom:1px solid rgba(0,0,0,.05);padding:10px 0;margin-bottom:6px}
.eng small{font-size:12px;letter-spacing:.5px;color:rgba(0,0,0,.45);text-transform:uppercase}
.eng .trk{flex:1;height:6px;border-radius:99px;background:#f0f0f0;overflow:hidden}.eng .trk i{display:block;height:100%;width:0;background:#38b0cf;border-radius:99px;transition:width 1.2s ease}
.eng b{font-size:18px;font-weight:600;color:#38b0cf;min-width:44px;text-align:right}
.kpi{display:flex;align-items:center;gap:12px;border:1px solid rgba(0,0,0,.06);border-radius:8px;padding:10px 14px}
.kpi .ic{width:38px;height:38px;border-radius:8px;display:flex;align-items:center;justify-content:center}
.kpi small{display:block;font-size:10px;font-weight:500;letter-spacing:.5px;color:#9ca3af;text-transform:uppercase}
.kpi b{font-size:18px;font-weight:600}
.tabs{display:flex;align-items:flex-end;gap:4px;border-bottom:1px solid #f0f0f0;margin-top:6px}
.tabs div.t{padding:12px 10px;height:46px;color:#333;position:relative}
.tabs div.t.on{color:#169bc2;font-weight:500;background:rgba(22,155,194,.1)}
.tabs div.t.on::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:#169bc2}
.tabs .aibtn{margin:0 0 7px auto}
.form{display:flex;flex-direction:column;gap:16px;margin-top:18px;max-width:880px}
.f label{display:block;color:rgba(0,0,0,.45);margin-bottom:8px}
.f label i{color:#ff4d4f;font-style:normal;margin-right:4px}
.in{border:1px solid #d9d9d9;border-radius:6px;min-height:34px;padding:6px 11px;line-height:1.6;color:#333;background:#fff}
.in.tags{display:flex;flex-wrap:wrap;gap:6px;padding:4px 8px}
.tag{background:rgba(0,0,0,.04);border:1px solid rgba(0,0,0,.06);border-radius:4px;padding:1px 8px;font-size:13px}
.fill{animation:fillin .5s ease both}
@keyframes fillin{0%{background:#eaf6fb}100%{background:#fff}}
.sec{font-size:12px;letter-spacing:.5px;color:rgba(0,0,0,.45);text-transform:uppercase;margin-top:6px}
.tp{display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #f0f0f0}
.tp .ico{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#f2f6f8;color:#169bc2;position:relative}
.tp .ico i{position:absolute;right:-3px;bottom:-3px;width:12px;height:12px;border-radius:50%;background:#52c41a;border:2px solid #fff}
.tp .ico.offc{color:#999}.tp .ico.offc i{background:#bbb}
.tp .sw{margin-left:auto}
.tp .pl{margin-left:44px;margin-top:-4px;padding-bottom:12px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:16px}
.segc{display:inline-flex;background:#f5f5f5;border-radius:6px;padding:2px}
.segc span{padding:4px 12px;border-radius:5px;display:flex;align-items:center;gap:6px}
.segc span.on{background:#333;color:#fff}
.segc.light span.on{background:#fff;color:#333;box-shadow:0 1px 2px rgba(0,0,0,.1)}
.card{border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;margin-top:12px}
.card .ch{background:#fafafa;padding:10px 14px;display:flex;align-items:center;gap:8px;font-size:13px;letter-spacing:.3px;text-transform:uppercase;border-bottom:1px solid #eee}
.card .cbd{padding:12px 14px}
.card .cbd small{display:block;color:#333;margin-bottom:6px}
.scene{border:1px solid #eee;border-radius:8px;padding:14px;margin-top:12px}
.scene h4{margin:0 0 10px;font-size:15px}
.frame{position:relative;border-radius:6px;overflow:hidden;background:#f2f2f2;aspect-ratio:16/9}
.frame .shim,.asset .shim{position:absolute;inset:0;background:linear-gradient(100deg,#eef1f4 20%,#f8fafb 40%,#eef1f4 60%);background-size:200% 100%;animation:shim 1.2s linear infinite;display:flex;align-items:center;justify-content:center;gap:8px;color:#8a97a3;font-size:13px}
@keyframes shim{to{background-position:-200% 0}}
.frame .art,.asset .art{position:absolute;inset:0;animation:reveal .8s ease both}
@keyframes reveal{from{opacity:0;filter:blur(8px)}to{opacity:1;filter:none}}
.fa{display:flex;justify-content:flex-end;gap:8px;align-items:center;margin:8px 0 4px}
.req{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,rgba(22,155,194,.2),rgba(151,71,255,.2));border-radius:6px;padding:4px 10px;color:#6a5be0;font-size:13px}
.pop{border:1px solid #e5e5e5;border-radius:8px;padding:10px 12px;margin-top:6px;box-shadow:0 4px 14px rgba(0,0,0,.08);animation:pop .25s ease both}
.pop .in{min-height:34px}
.ctabs{display:flex;gap:2px;margin-top:16px;border-bottom:1px solid #f0f0f0}
.ctabs span{padding:8px 16px;border:1px solid #f0f0f0;border-bottom:0;border-radius:8px 8px 0 0;background:#fafafa}
.ctabs span.on{background:#fff;color:#169bc2;font-weight:500}
.assets{display:grid;grid-template-columns:1.35fr .6fr .6fr;gap:16px;margin-top:14px;align-items:start}
.ap{border:1px solid #e8e8e8;border-radius:8px;overflow:hidden}
.ap .ch{background:#fafafa;padding:9px 12px;font-size:12px;letter-spacing:.3px;text-transform:uppercase;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between}
.ap .cbd{padding:12px;background:#fafafa}
.asset{position:relative;border-radius:4px;overflow:hidden;background:#eee}
.ap .af{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;font-size:13px}
.ap .af{flex-wrap:wrap;gap:6px}
.asset .play{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:2px solid rgba(56,176,207,.95);background:rgba(255,255,255,.18);color:#38b0cf;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 1px rgba(255,255,255,.35);animation:reveal .6s ease both}
.asset .play .ms{font-size:30px}.ap .af .btn{height:28px;font-size:12px;white-space:nowrap;max-width:100%}
.toast{position:absolute;top:76px;left:50%;transform:translateX(-50%);background:#fff;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:10px 16px;display:flex;align-items:center;gap:10px;z-index:6;animation:pop .3s ease both}
.toast .ms{color:#52c41a}
/* fx layer */
#cursor svg{display:block;width:26px;height:26px;transform-origin:4px 2px;transition:transform 90ms ease}#cursor.press svg{transform:scale(.86)}
#cursor{position:absolute;left:0;top:0;width:26px;height:26px;z-index:40;pointer-events:none;will-change:transform;transition-property:transform;transition-timing-function:cubic-bezier(.4,.1,.2,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
.ripple{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #169bc2;z-index:39;pointer-events:none;animation:rip .6s ease-out forwards}
@keyframes rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
#ring{position:absolute;z-index:30;pointer-events:none;border-radius:10px;box-shadow:0 0 0 3px rgba(22,155,194,.9),0 0 0 9999px rgba(15,25,35,.22);transition:opacity .25s ease;opacity:0}
#ring.on{opacity:1}
#tip{position:absolute;z-index:41;width:300px;background:#14202b;color:#fff;border-radius:10px;padding:12px 14px 13px;font-size:14px;line-height:1.45;box-shadow:0 10px 28px rgba(0,0,0,.3);opacity:0;transform:translateY(6px);transition:opacity .25s,transform .25s;pointer-events:none}
#tip.on{opacity:1;transform:none}
#tip small{display:block;color:#7fd3ec;font-size:11px;letter-spacing:.6px;text-transform:uppercase;margin-bottom:3px}
#tip b{display:block;font-size:15px;margin-bottom:2px}
#tip::before{content:"";position:absolute;width:12px;height:12px;background:#14202b;transform:rotate(45deg);left:var(--ax,30px)}
#tip.below::before{top:-6px}#tip.above::before{bottom:-6px}
#card{position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(12,22,32,.6)}
#card .in2{width:520px;background:#fff;border-radius:14px;padding:28px 30px;box-shadow:0 20px 50px rgba(0,0,0,.3);animation:pop .35s ease both}
#card h2{font-family:var(--display);font-size:26px;line-height:1.2;margin:8px 0 8px;color:#14202b;text-wrap:balance}
#card p{color:#55626d;margin:0 0 18px;font-size:15px;line-height:1.5}
#card .eyebrow{font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:#169bc2;font-weight:500}
#card .acts{display:flex;gap:10px;flex-wrap:wrap}
#card button{all:unset;cursor:pointer;height:40px;padding:0 18px;border-radius:8px;display:inline-flex;align-items:center;gap:8px;font-size:15px}
#card .go{background:linear-gradient(135deg,#169bc2,#9747ff);color:#fff;font-weight:500}
#card .ghost{border:1px solid #d6dde3;color:#14202b}
#card button:focus-visible{outline:2px solid #169bc2;outline-offset:2px}
#card .stats{display:flex;gap:18px;margin:0 0 18px}
#card .stats div{font-size:13px;color:#55626d}
#card .stats b{display:block;font-size:22px;color:#14202b;font-variant-numeric:tabular-nums}
/* personalisation scene */
.scene3{position:absolute;inset:0;display:grid;grid-template-columns:520px 1fr;background:linear-gradient(160deg,#eef3f6,#e3ebf0)}
.sc-left{display:flex;align-items:center;justify-content:center}
.phone{width:300px;height:620px;border-radius:44px;background:#11161b;padding:12px;box-shadow:0 24px 60px rgba(10,30,45,.35);position:relative}
.ph-notch{position:absolute;top:18px;left:50%;width:96px;height:24px;margin-left:-48px;border-radius:14px;background:#11161b;z-index:2}
.ph-screen{width:100%;height:100%;border-radius:34px;overflow:hidden;background:#fff;position:relative;font-size:14px;color:#222}
.ph-lock{height:100%;background:linear-gradient(170deg,#2c3e50,#4b6a7f);color:#fff;padding:70px 14px 0;text-align:center}
.ph-time{font-size:58px;font-weight:300;line-height:1}.ph-date{font-size:14px;opacity:.85;margin:6px 0 40px}
.ph-note{text-align:left;background:rgba(255,255,255,.92);color:#222;border-radius:18px;padding:12px 14px;opacity:0;transform:translateY(-14px);transition:all .45s ease}
.ph-note.in{opacity:1;transform:none}.ph-note b{display:block;font-size:14px;margin:6px 0 2px}.ph-note span{font-size:13px;color:#444}
.pn-top{display:flex;align-items:center;gap:6px;font-size:12px;color:#555}.pn-top small{margin-left:auto}
.ph-logo{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,.2);color:#fff;font-weight:900;font-size:11px}.ph-logo.sm{width:20px;height:20px;border-radius:5px;font-size:8px}
.ph-head{height:96px;display:flex;align-items:flex-end;gap:10px;padding:0 16px 14px;color:#fff;font-weight:700;font-size:15px}
.ph-body{padding:18px 16px}.ph-body h5{margin:0 0 4px;font-size:20px}.mut{color:#777;display:block}
.ph-q{margin:18px 0 10px;font-weight:600}
.ph-opt{border:1.5px solid #e2e2e2;border-radius:12px;padding:11px 14px;margin-bottom:8px;transition:all .2s}.ph-opt.on{background:#f5fbfd;font-weight:600}
.ph-btn{margin-top:14px;text-align:center;color:#fff;border-radius:12px;padding:12px;font-weight:700}.ph-btn.off{opacity:.4}
.ph-card{display:flex;gap:12px;align-items:flex-start;border:1px solid #eee;border-radius:14px;padding:14px;margin-top:14px}.ph-card b{display:block}
.ph-done{text-align:center;padding-top:40px}.ph-big{font-size:46px;font-weight:900;margin:6px 0}
.ph-tag{margin:22px auto 0;display:inline-block;background:#f3f6f8;border-radius:99px;padding:6px 12px;font-size:13px}
.sc-right{padding:90px 70px 40px 10px;display:flex;flex-direction:column;justify-content:center}
.tp-eyebrow{font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:#169bc2;font-weight:600}
.sc-right h3{font-family:var(--display);font-size:30px;line-height:1.2;margin:8px 0 22px;color:#14202b}
.tp-methods{display:flex;flex-direction:column;gap:10px}
.tp-m{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #dde5ea;border-radius:12px;padding:14px 16px;font-size:15px;color:#55626d}
.tp-m .ms{width:36px;height:36px;border-radius:10px;background:#eef3f6;color:#8a97a3;display:flex;align-items:center;justify-content:center}
.tp-m.on{border-color:#169bc2;color:#14202b;box-shadow:0 4px 14px rgba(22,155,194,.15)}.tp-m.on .ms{background:#e6f4f9;color:#169bc2}
.tp-note{color:#55626d;font-size:14px;line-height:1.5;margin-top:18px;max-width:560px}
.tp-tbl{background:#fff;border:1px solid #dde5ea;border-radius:12px;overflow:hidden}
.tp-h,.tp-r{display:grid;grid-template-columns:1.4fr 1.05fr 1fr .9fr;gap:10px;padding:12px 16px;align-items:center}
.tp-ok{color:#22a06b;font-weight:600;display:flex;align-items:center;gap:4px}.tp-ok .ms{font-size:18px}
.tp-tv{width:520px;aspect-ratio:16/9;background:#11161b;border-radius:12px;padding:10px;box-shadow:0 18px 40px rgba(10,30,45,.28);transition:box-shadow .4s}.tp-tv.on{box-shadow:0 0 0 4px rgba(22,155,194,.35),0 18px 40px rgba(10,30,45,.28)}
.tv-in{width:100%;height:100%;border-radius:5px;overflow:hidden;position:relative}.tv-in>svg{display:block;width:100%;height:100%;animation:reveal .6s ease both}
.tv-idle{width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 36px;color:#fff;font-family:var(--display);font-size:30px;font-weight:700}.tv-idle small{font-size:17px;margin-top:6px}
.tp-shelf{width:560px;border-radius:12px;overflow:hidden;box-shadow:0 18px 40px rgba(10,30,45,.2);transition:box-shadow .4s}.tp-shelf.on{box-shadow:0 0 0 4px rgba(22,155,194,.35),0 18px 40px rgba(10,30,45,.2)}.tp-shelf svg{display:block;width:100%;height:auto}.tp-shelf .scr{animation:reveal .6s ease both}
.ra{position:absolute;inset:0;display:grid;grid-template-columns:236px 1fr;background:#fff;font-size:14px;color:#333}
.ra-side{background:#333;color:#fff;display:flex;flex-direction:column;padding:18px 0 14px}
.ra-sh{padding:6px 22px 22px}.ra-sh b{display:block;font-size:18px;font-weight:500}.ra-sh small{color:rgba(255,255,255,.55);font-size:12px;letter-spacing:.5px}
.ra-nav>div{display:flex;align-items:center;gap:12px;height:44px;margin:2px 10px;padding:0 12px;border-radius:8px;font-size:12.5px;letter-spacing:.3px;color:rgba(255,255,255,.85)}.ra-nav>div.on{background:#169bc2;color:#fff}.ra-nav .ch{margin-left:auto;font-size:18px}
.ra-pow{margin-top:auto;padding:0 22px;font-size:11px;color:rgba(255,255,255,.55)}.ra-pow b{color:#fff;font-weight:600}
.ra-main{display:flex;flex-direction:column;min-width:0}
.ra-hd{height:60px;background:#000;color:#fff;display:grid;grid-template-columns:40px 1fr 40px;align-items:center;padding:0 20px}
.ra-logo{display:flex;align-items:center;justify-content:center;gap:10px;font-weight:700;font-size:16px}
.ra-me{position:relative;width:36px;height:36px;display:block;justify-self:end}.ra-me .av,.ra-sa .av{display:block}.ra-me .av{width:36px;height:36px;box-sizing:border-box;border-radius:50%;overflow:hidden;border:2px solid #fff}.ra-me .av svg,.ra-sa .av svg{width:100%;height:100%;display:block}.ra-me i{position:absolute;right:-2px;bottom:-2px;width:11px;height:11px;border-radius:50%;border:2px solid #000}
.ra-body{flex:1;overflow:hidden;padding:14px 0}.ra-col{max-width:900px;margin:0 auto;padding:0 24px}
.ra-crumb{color:rgba(0,0,0,.45);font-size:13px}.ra-crumb b{color:#333}
.ra-tr{display:flex;align-items:center;gap:12px;margin-top:10px}.ra-tr h2{font-size:20px;font-weight:500;margin:0;color:rgba(0,0,0,.88);display:flex;align-items:center;gap:8px;flex:1}.ra-tr h2 .ms{font-size:22px}
.ra-tb{padding:5px 10px;border-radius:6px}.ra-div{height:1px;background:rgba(5,5,5,.06);margin:12px 0}
.ra-card{border:1px solid #f0f0f0;border-radius:8px;padding:14px 18px;background:#fff}
.ra-staff{display:flex;align-items:center;gap:10px}.ra-staff .lab{font-weight:600;font-size:12.5px;letter-spacing:.4px}
.ra-all{width:34px;height:34px;border-radius:50%;border:2px solid #169bc2;color:#169bc2;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600}
.ra-sa{position:relative;width:34px;height:34px}.ra-sa .av{width:34px;height:34px;border-radius:50%;overflow:hidden}.ra-sa i{position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;border-radius:50%;border:2px solid #fff}
.ra-ini{width:34px;height:34px;border-radius:50%;background:#e6f4f9;color:#169bc2;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600}
.ra-leg{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12.5px;color:#555}.ra-leg i{width:8px;height:8px;border-radius:50%;display:inline-block}.ra-leg s{width:1px;height:14px;background:#ddd;margin:0 4px}
.ra-ss{margin:12px 0 8px;font-weight:500;display:flex;justify-content:space-between}.ra-ss .ms{font-size:16px;color:#999}
.ra-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.ra-tiles div{background:#f5f5f5;border-radius:8px;text-align:center;padding:10px}.ra-tiles b{display:block;font-size:20px}.ra-tiles small{color:rgba(0,0,0,.45);font-size:11.5px}
.ra-otabs{display:flex;gap:28px;border-bottom:1px solid #f0f0f0;margin:14px 0 12px}.ra-otabs span{padding:10px 0;font-size:13px;letter-spacing:.4px;display:flex;align-items:center;gap:4px}.ra-otabs span.on,.ra-itabs span.on{color:#169bc2;box-shadow:inset 0 -2px #169bc2;font-weight:500}.ra-otabs .ms{font-size:15px;color:#999}
.ra-itabs{display:flex;align-items:center;gap:24px;border-bottom:1px solid #f0f0f0;margin:-4px 0 12px}.ra-itabs span{padding:8px 0}
.ra-add{margin-left:auto;background:#169bc2;color:#fff;border-radius:6px;padding:6px 14px!important;font-size:13px}
.ra-v{display:flex;align-items:center;gap:16px;border:1px solid #f0f0f0;border-radius:8px;padding:12px 16px;margin-bottom:10px}
.ra-tk{font-weight:700;font-size:16px;color:#169bc2;min-width:64px}
.ra-vi{flex:1;min-width:0}.ra-vi b{font-size:15px}.ra-vi>span{color:rgba(0,0,0,.55);margin-left:10px;font-size:13px}.ra-vi small{display:flex;align-items:center;gap:6px;color:#555;font-size:12.5px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ra-vi small .ms{font-size:16px;color:#169bc2}
.ra-gold{background:#fdf3d6;color:#9a6b00;border-radius:99px;padding:2px 8px;font-size:11px;font-weight:600;margin-left:8px}
.ra-pick,.ra-start{background:#169bc2;color:#fff;border-radius:6px;padding:9px 20px;font-weight:500;font-size:13.5px;flex:none}
.ra-timer{display:flex;align-items:center;gap:6px;background:#fff7e6;color:#d48806;border:1px solid #ffd591;border-radius:99px;padding:5px 12px;font-size:13px}.ra-timer .ms{font-size:16px}.ra-timer.go{background:#f6ffed;color:#389e0d;border-color:#b7eb8f}
.ra-tkc{font-size:12px;font-weight:600;color:#169bc2;background:#e6f4f9;border-radius:99px;padding:2px 9px}
.ra-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ra-wide{grid-column:1/-1}.ra-ct{font-weight:600;margin-bottom:6px;font-size:14px}
.ra-kv{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid #f5f5f5;font-size:13px}.ra-ct+.ra-kv{border-top:0}.ra-kv>span:first-child{color:rgba(0,0,0,.45)}.ra-kv .ms{font-size:15px;color:#999;margin-left:6px}
.ra-sw{display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:6px;border:1px solid rgba(0,0,0,.15)}
.ra-of{display:flex;gap:16px;align-items:flex-start}.ra-of .thumb{width:176px;height:99px;border-radius:6px;overflow:hidden;flex:none}.ra-of .thumb svg{width:100%;height:100%;display:block}.ra-of b{display:block;font-size:14.5px}.ra-of small{display:block;color:rgba(0,0,0,.55);margin-top:3px;font-size:12.5px}
.ra-int{margin-top:8px}.ra-int div{display:flex;align-items:center;gap:10px;font-size:12.5px;padding:4px 0;color:#444}.ra-int .t{min-width:40px;color:#888}.ra-int strong{font-weight:600;color:#333}.ra-int .ms{font-size:16px;color:#169bc2}
.vd{position:absolute;inset:0;display:grid;grid-template-columns:64px 1fr;background:#fff;color:#333;font-size:14px}
.vd-rail{background:#333;display:flex;flex-direction:column;align-items:center;padding-top:66px;gap:8px}.vd-rail span{width:50px;height:36px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#ddd}.vd-rail span.on{background:#169bc2;color:#fff}.vd-rail .bt{margin-top:auto;margin-bottom:18px;font-size:26px}
.vd-main{display:flex;flex-direction:column;min-width:0}
.vd-hd{height:56px;flex:none;background:#000;display:flex;align-items:center;justify-content:space-between;padding:0 18px 0 22px;color:#fff}.vd-hd>.ms{font-size:26px}
.vd-me{position:relative;width:38px;height:38px;display:block}.vd-me .av{display:block;width:38px;height:38px;border-radius:50%;overflow:hidden;border:2px solid #fff;box-sizing:border-box}.vd-me .av svg,.vd-st .av svg{width:100%;height:100%;display:block}.vd-me i{position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;border-radius:50%;background:#52c41a;border:2px solid #000}
.vd-top{padding:16px 26px 0;flex:none}.vd-crumb{color:rgba(0,0,0,.45);font-size:12.5px}
.vd-tr{display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-bottom:12px;border-bottom:1px solid #f0f0f0}.vd-tr h2{margin:0;font-size:19px;font-weight:500}
.vd-st{display:flex;align-items:center;gap:8px}.vd-st .av{width:30px;height:30px;border-radius:50%;overflow:hidden;display:block}
.vd-pill{background:#fff7e6;border:1px solid #ffd591;color:#d48806;border-radius:99px;padding:4px 12px;font-size:12px}.vd-pill b{font-weight:700}
.vd-body{flex:1;display:grid;grid-template-columns:200px 1fr;gap:22px;padding:14px 26px 0;min-height:0}
.vd-left{background:#eef7fa;padding:6px 16px}.vd-left>div{padding:12px 0;border-bottom:1px solid #d9e8ee}.vd-left>div:last-child{border:0}.vd-left small{display:block;color:rgba(0,0,0,.45);font-size:12.5px;margin-bottom:6px}.vd-left .nm{color:#1f8ea8;font-size:18px;font-weight:500}
.vd-r{min-width:0}.vd-lab{font-size:12px;color:rgba(0,0,0,.45);letter-spacing:.3px;margin:2px 0 10px;text-transform:uppercase}
.vd-visit{box-shadow:0 2px 10px rgba(0,0,0,.13);border-radius:4px;padding:12px 18px;display:flex;gap:70px}.vd-visit>div{display:flex;gap:12px;align-items:flex-start}.vd-visit .ms{font-size:20px;color:#555;margin-top:2px}.vd-visit small{display:block;color:#555;font-size:12.5px;margin-bottom:3px}.vd-visit b{font-size:15px;font-weight:600}
.vd-sw{display:inline-block;width:14px;height:14px;border-radius:3px;margin-right:6px;vertical-align:-2px;border:1px solid rgba(0,0,0,.15)}
.vd-cols{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:20px}
.vd-ins>div{display:flex;align-items:center;gap:14px;font-weight:600;font-size:15px;margin-bottom:20px}.vd-ins .ms{font-size:30px;color:#8c8c8c}
.vd-sub{font-size:13px;color:#555;margin-bottom:8px}.vd-sel{border:1px solid #d9d9d9;border-radius:6px;height:38px;display:flex;align-items:center;gap:8px;padding:0 10px}.vd-sel .ini{width:26px;height:26px;border-radius:50%;background:#e6f4f9;color:#169bc2;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center}.vd-sel .ms{margin-left:auto;font-size:18px;color:#555}
.vd-rec{width:384px;height:216px;margin:0 auto;overflow:hidden}.vd-rec svg{display:block;width:100%;height:100%}
.vd-dots{display:flex;justify-content:center;gap:5px;margin:8px 0}.vd-dots i{width:6px;height:6px;border-radius:3px;background:#ccc}.vd-dots i.on{width:14px;background:#169bc2}
.vd-play{display:flex;align-items:center;gap:8px;margin-left:auto;margin-right:22px;width:max-content;background:#ebebeb;border-radius:99px;padding:5px 16px 5px 10px}.vd-play .ms{font-size:26px;color:#111}.vd-play b{display:block;font-size:13px}.vd-play small{display:block;font-size:9.5px;color:#555;text-align:right}
.vd-bar{height:68px;flex:none;border-top:1px solid #f0f0f0;display:flex;align-items:center;justify-content:center;gap:14px}.vd-bar span{border:1px solid #d9d9d9;border-radius:6px;padding:9px 14px;font-weight:500;font-size:13.5px}.vd-bar span.pri{background:#169bc2;border-color:#169bc2;color:#fff;padding:9px 18px}
.tp-cap{display:flex;align-items:center;gap:6px;color:#55626d;font-size:13px;margin-top:12px}.tp-cap .ms{font-size:18px}
.tp-h{background:#f6f9fb;font-size:12px;letter-spacing:.4px;text-transform:uppercase;color:#7a8791}
.tp-r{border-top:1px solid #eef2f5;font-size:14px;animation:rowin .5s ease both}.tp-r b{font-weight:600;color:#14202b}
.pbt{border:1px solid #f0f0f0;border-radius:8px;overflow:hidden;margin-top:14px}
.pbh,.pbr{display:grid;grid-template-columns:170px 230px 1fr 140px 100px;align-items:center}
.pbh{background:#fafafa;font-weight:600;font-size:13px;height:48px;border-bottom:1px solid #f0f0f0}.pbh>div,.pbr>div{padding:0 12px}
.pbr{height:64px;border-bottom:1px solid #f5f5f5;font-size:13.5px}.pbr .b{font-weight:600}.pbr.new{animation:rowin .6s ease both;background:#f2fbfe}
.pills{display:flex;flex-direction:column;gap:4px;align-items:flex-start}
/* scheduling */
.stbl{border:1px solid #f0f0f0;border-radius:8px;overflow:hidden;margin-top:12px}
.sth,.str{display:grid;grid-template-columns:1.2fr 1.4fr .8fr 1fr 1.1fr 1fr .6fr;align-items:center}
.sth{background:#fafafa;font-weight:600;font-size:13px;height:52px;border-bottom:1px solid #f0f0f0}.sth>div,.str>div{padding:0 12px}
.str{height:56px;font-size:13.5px;animation:rowin .5s ease both}
.sempty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:28px 0;color:rgba(0,0,0,.45)}
.fm label{display:block;margin:14px 0 8px}.fm label i{color:#ff4d4f;font-style:normal;margin-right:4px}
.modes{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #d9d9d9;border-radius:6px;overflow:hidden}
.modes span{text-align:center;padding:7px 0;border-left:1px solid #d9d9d9}.modes span:first-child{border-left:0}.modes span.on{background:#169bc2;color:#fff}
.dts{display:grid;grid-template-columns:1fr 1fr;gap:20px}.dtr{display:flex;gap:8px}.dtr .in{display:flex;justify-content:space-between;align-items:center;min-width:120px}
.tzb{display:inline-flex;border:1px solid #d9d9d9;border-radius:6px;padding:5px 14px;margin-top:14px}
/* flow 2 */
.sgh,.sgr{display:grid;grid-template-columns:44px 130px 180px 1fr 140px 150px 40px;align-items:center}
.sgh{background:#f8f8f8;font-weight:700;font-size:13px;color:#181d1f;height:40px;border-bottom:1px solid rgba(24,29,31,.15)}
.sgh>div,.sgr>div{padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sgr{height:46px;border-bottom:1px solid rgba(24,29,31,.1);background:#fff;font-size:13.5px}
.sgr .b{font-weight:700}.sgr.new{animation:rowin .5s ease both;background:#f2fbfe}
.code{display:flex;align-items:center;gap:4px}.code .ms{font-size:14px;color:#999}
.cb.on{background:#169bc2;border-color:#169bc2;position:relative}.cb.on::after{content:"";position:absolute;left:4px;top:1px;width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.modal.wide{width:980px}
.as{display:grid;grid-template-columns:420px 1fr;gap:20px;height:470px}
.asl{display:flex;flex-direction:column;gap:10px;min-height:0}
.srch{display:flex;border:1px solid #d9d9d9;border-radius:6px;overflow:hidden}.srch .in{border:0;flex:1;border-radius:0}.sbtn{width:40px;display:flex;align-items:center;justify-content:center;border-left:1px solid #d9d9d9;color:#666}
.reslist{flex:1;overflow:hidden;border:1px solid #eee;border-radius:6px}
.rr{display:flex;gap:12px;padding:9px 12px;border-bottom:1px solid #f0f0f0;align-items:flex-start;animation:rowin .4s ease both}
.rr.on{background:#f2fbfe}.rr .cb{margin-top:2px;flex:0 0 16px}
.rr b{display:block;font-size:14px}.rr small{display:block;color:#666;font-size:12.5px;margin-top:2px}.rr .hrs{color:#22a06b}
.selall{display:flex;align-items:center;gap:8px;color:#169bc2;font-size:13px;min-height:20px}
.map{border-radius:6px;overflow:hidden;background:#e9eef1}.map svg{display:block;width:100%;height:100%}
.pinin{animation:drop .5s cubic-bezier(.3,1.4,.6,1) both}@keyframes drop{from{transform:translateY(-24px);opacity:0}to{transform:none;opacity:1}}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#999;gap:6px;font-size:13px}
.stabs{display:flex;gap:4px;border-bottom:1px solid #f0f0f0;margin-top:16px}.stabs div{padding:12px 10px;display:flex;align-items:center;gap:4px}.stabs div.on{color:#169bc2;font-weight:500;background:rgba(22,155,194,.1);box-shadow:inset 0 -2px #169bc2}
.slogo{display:flex;justify-content:center;margin:18px 0 0}.slogo>div{width:104px;height:104px;border-radius:50%;border:1px dashed #169bc2;display:flex;align-items:center;justify-content:center}
.two2{display:grid;grid-template-columns:1fr 220px;gap:12px}
.mask.still,.mask.still .modal{animation:none}
.ddo.sel{background:#e6f4f9;font-weight:600;display:flex;justify-content:space-between;gap:18px}.ddo.sel::after{content:"✓";color:#169bc2}
.ss{height:100%;display:flex;flex-direction:column;background:#fff;font-size:13px;color:#222;position:relative}
.ss-top{padding:40px 14px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;box-shadow:0 4px 10px rgba(0,0,0,.07);position:relative;z-index:1;background:#fff}
.ss-top.home{padding-bottom:6px;box-shadow:none}.ss-top b.t{font-size:14.5px}
.ss-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px}
.ss-back{display:flex;align-items:center;font-weight:600;font-size:14px;margin-left:-6px}.ss-back .ms{font-size:22px}
.ss-pill{display:flex;align-items:center;gap:7px;border:1px solid #b9b9b9;border-radius:99px;padding:3px 7px 3px 9px;background:#f2f2f2;position:relative}
.ss-pill .ms{font-size:19px;color:#333}.ss-pill .ok{position:absolute;left:23px;top:1px;width:8px;height:8px;border-radius:50%;background:#52c41a;border:1px solid #fff}
.ss-pill .x{width:17px;height:17px;border-radius:50%;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
.ss-qr{width:42px;height:28px;border-radius:14px;color:#fff;display:flex;align-items:center;justify-content:center}.ss-qr .ms{font-size:18px}
.ss-store{font-family:var(--display);font-size:20px;font-weight:600;color:#555;padding:0 14px 10px;box-shadow:0 4px 10px rgba(0,0,0,.07);position:relative;z-index:1}
.ss-body{flex:1;position:relative;overflow:hidden}
.ss-lab{font-size:9.5px;letter-spacing:.3px;padding:12px 26px 0;color:#333}
.ss-car{position:relative;margin:10px 22px 0}
.ss-card{height:248px;border-radius:12px;position:relative;overflow:hidden;color:#fff;padding:14px 16px;animation:reveal .5s ease both}
.pc-logo{display:flex;align-items:center;gap:6px;font-weight:700;font-size:11px}.pc-logo span{width:22px;height:22px;border-radius:6px;background:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:8.5px}
.pc-illo{position:absolute;right:-10px;top:30px;width:130px;height:136px}
.pc-big{position:absolute;left:16px;bottom:74px;font-family:var(--display);font-size:44px;font-weight:800;line-height:1}
.pc-bs{font-size:10px;font-weight:800;letter-spacing:.3px}.pc-big+.pc-bs{position:absolute;left:17px;bottom:58px}
.pc-h{position:absolute;left:16px;right:14px;bottom:30px;font-size:14px;font-weight:700}
.pc-tag{position:absolute;left:16px;bottom:12px;font-size:8.5px;padding:3px 7px;border-radius:99px;background:rgba(255,255,255,.18)}
.pc-ic{position:absolute;right:18px;top:52px;font-size:84px!important;opacity:.95}
.pc-h2{position:absolute;left:16px;right:14px;bottom:76px;font-family:var(--display);font-size:24px;font-weight:700;line-height:1.1}
.pc-h2+.pc-bs{position:absolute;left:16px;bottom:56px;font-size:12px}
.pc-cta{position:absolute;left:16px;bottom:16px;font-size:10px;font-weight:700;padding:6px 12px;border-radius:99px}
.ss-arr{position:absolute;right:-22px;top:50%;margin-top:-23px;width:24px;height:46px;border-radius:23px 0 0 23px;background:rgba(90,90,90,.78);color:#fff;display:flex;align-items:center;justify-content:center}.ss-arr .ms{font-size:18px}
.ss-dots{display:flex;justify-content:center;gap:5px;margin:9px 0 2px}.ss-dots i{width:6px;height:6px;border-radius:3px;background:#ccc}.ss-dots i.on{width:13px;background:var(--bc)}
.ss-li{display:flex;align-items:center;gap:10px;padding:12px 16px;font-size:14px}.ss-li b{flex:1;font-weight:700;white-space:nowrap}.ss-li .ms{font-size:21px}.ss-li .ms.ch{color:#333;font-size:18px}
.ss-chip{font-size:10.5px;padding:4px 7px;border-radius:6px;background:var(--bg2);color:var(--bc);white-space:nowrap;animation:rowin .4s ease both}
.ss-foot{position:absolute;left:0;right:0;bottom:0;font-size:9.5px;text-align:center;padding:9px;border-top:1px solid #eee;color:#555;background:#fff}
.ss-wel{text-align:center;padding:18px 16px 0}.ss-wel h4{font-family:var(--display);font-size:22px;font-weight:500;margin:0 0 8px;line-height:1.2;color:#111}
.ss-wel p{color:#a9a9a9;font-size:11.5px;margin:0 0 16px;line-height:1.45}
.ss-stats{display:flex;justify-content:space-around;align-items:flex-end;margin-bottom:12px}.ss-stats b{font-size:42px;font-weight:300;line-height:1}.ss-stats em{font-style:normal;font-size:11px;margin-left:3px}.ss-stats .ms{font-size:16px;margin-left:2px}
.ss-stats small{display:block;color:#a9a9a9;font-size:10.5px;margin-top:5px}
.ss-chart{background:#f6f6f6;padding:12px 8px 6px;margin:0 -16px}.ss-bars{display:flex;align-items:flex-end;gap:2px;height:58px;border-bottom:1px solid #c9c9c9;background:repeating-linear-gradient(0deg,transparent 0 13px,#e3e3e3 13px 14px)}.ss-bars i{flex:1}
.ss-ax{display:flex;justify-content:space-between;font-size:8.5px;color:#888;margin-top:4px}.ss-cap{color:#a9a9a9;font-size:10.5px;margin:8px 0 0}
.ss-btns{position:absolute;left:16px;right:16px;bottom:18px;display:flex;flex-direction:column;gap:8px}
.ss-btn{color:#fff;text-align:center;padding:10px;border-radius:7px;font-size:13.5px;letter-spacing:.3px;box-shadow:0 2px 0 rgba(0,0,0,.15)}
.ss-btn2{text-align:center;padding:9px;border-radius:7px;border:1px solid #ccc;font-size:13.5px;background:#fff}
.ss-form{padding:12px 16px 0}.ss-f{margin-bottom:7px}.ss-f label{display:block;font-size:11px;margin-bottom:4px;color:#333}.ss-f label i{color:#ff4d4f;font-style:normal;margin-right:3px}
.ss-in{border:1px solid #d9d9d9;border-radius:6px;height:28px;padding:0 10px;display:flex;align-items:center;font-size:12.5px;position:relative;background:#fff}.ss-in.on{border-color:var(--bc);box-shadow:0 0 0 2px var(--bg2)}
.ss-in .chev{margin-left:auto;font-size:17px;color:#999}.ss-in .val{padding-left:12px}
.ss-hint{color:#bbb;font-size:10.5px;margin:8px 0 8px}
.ss-colour{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600;position:relative}.ss-pal{position:absolute;right:0;bottom:40px;background:#fff;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.2);padding:9px;display:grid;grid-template-columns:repeat(4,24px);gap:8px;z-index:5;animation:pop .18s ease both}.ss-pal i{width:24px;height:24px;border-radius:50%;display:block;border:1px solid rgba(0,0,0,.15)}.ss-pal i.hov{box-shadow:0 0 0 2px #fff,0 0 0 4px var(--bc)}.ss-sw{width:74px;height:32px;border:1px solid #333;border-radius:4px;padding:3px}.ss-sw i{display:block;height:100%;background:#9e9e9e}
.ss-dd{position:absolute;left:-1px;right:-1px;top:31px;background:#fff;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.2);z-index:5;padding:4px;animation:pop .18s ease both}.ss-dd div{padding:7px 10px;border-radius:5px;font-size:12.5px}.ss-dd div.hov{background:var(--bg2)}
.ss-served{margin:20px 14px 0;border:1px solid var(--bc);border-radius:10px;background:var(--bg2);text-align:center;padding:24px 14px 26px}
.ss-served h4{font-family:var(--display);font-size:25px;font-weight:500;margin:0 0 14px;color:#111}
.ss-served small{display:block;color:#8a9ca0;letter-spacing:.8px;font-size:10.5px;margin-top:12px}.ss-served .tk{font-size:13px;margin:6px 0 4px;letter-spacing:.6px}
.ss-av{width:116px;height:116px;border-radius:50%;overflow:hidden;margin:10px auto 0}.ss-av svg{display:block;width:100%;height:100%}
.ss-nm{background:#fff;border-radius:4px;padding:8px 20px;display:inline-block;margin-top:6px}.ss-nm b{display:block;font-size:14px}.ss-nm span{font-size:12.5px}
.in.focus{border-color:#169bc2;box-shadow:0 0 0 2px rgba(22,155,194,.15)}
.sdd{position:relative;padding-right:34px;min-height:34px}.sdd .chev{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#bfbfbf;font-size:18px}.sdd.open{border-color:#169bc2}
.cset{display:grid;grid-template-columns:230px 1fr;margin-top:10px}
.csub{border-right:1px solid #f0f0f0;padding:4px 12px 4px 0;display:flex;flex-direction:column;gap:2px}
.csub>div{padding:10px 16px;border-radius:6px;color:#333;display:flex;justify-content:space-between;align-items:center}
.csub .cs-open{color:#169bc2}.csub .cs-item{padding-left:40px;background:#fafafa;border-radius:0}.csub .cs-item.on{background:#e6f4f9;color:#169bc2}
.cmain{padding-left:24px}.cmain p{line-height:1.6;margin:0;color:rgba(0,0,0,.45)}.cmain p b{color:rgba(0,0,0,.6)}
.sgsec{margin-top:22px}.sglab{display:flex;align-items:center;gap:6px;font-size:15px}
.sgbar{display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;padding:0 0 0 12px}
.sgth{background:#fafafa;padding:13px 16px;font-weight:600;border-radius:8px 8px 0 0}
.sgtr{display:flex;justify-content:space-between;align-items:center;padding:13px 16px;border-bottom:1px solid #f0f0f0;font-weight:600}.sgtr .ms{color:#333;font-size:18px;font-weight:400}
.sgtr.new{animation:rowin .35s ease both}.sgte{padding:20px 16px;text-align:center;border-bottom:1px solid #f0f0f0;color:#bfbfbf}
.rgroup{background:#f2f2f2;border-radius:6px;padding:14px 16px}
.rrow{display:flex;gap:8px;align-items:center}
.sel{display:flex;align-items:center;justify-content:space-between;gap:6px;height:34px;font-size:13px;border:1px solid #d9d9d9;border-radius:6px;background:#fff;padding:0 8px 0 11px;white-space:nowrap;overflow:hidden}
.sel.open{border-color:#169bc2;box-shadow:0 0 0 2px rgba(22,155,194,.15)}.sel .ph{color:#bfbfbf}.sel .ms{font-size:18px;color:#999}
.w1{width:245px}.w2{width:215px}.w3{width:192px}.w5{width:140px}.w6{width:128px}.sel .v{overflow:hidden;text-overflow:ellipsis}.pct{margin-left:auto;color:#333}.w4{flex:1;justify-content:flex-start;gap:6px;flex-wrap:wrap;height:auto;min-height:34px;padding:4px 8px}
.trash{color:#333;font-size:20px}
.orbw{margin-top:14px;padding-top:12px;border-top:1px solid #e3e3e3}.orb{display:inline-flex;border:1px dashed #169bc2;color:#169bc2;border-radius:4px;padding:3px 10px}
.and{text-align:center;color:#666;margin:12px 0}.orl{color:#888;font-size:12px;font-weight:600;margin:10px 0 10px 4px}.rrow.new{animation:rowin .35s ease both}
.andbtn{display:inline-flex;margin-top:14px;border:1px solid #169bc2;color:#169bc2;border-radius:4px;padding:4px 12px}
.dd{position:absolute;z-index:36;max-height:330px;overflow:hidden;background:#fff;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.16);padding:4px;animation:pop .18s ease both;font-size:14px;color:#333}
.ddo{padding:8px 12px;border-radius:6px;white-space:nowrap}.ddo.hov{background:#e6f4f9}
.tok{display:inline-flex;align-items:center;background:#eef3ff;border:1px solid #c9d6ff;color:#3651c9;border-radius:4px;padding:0 6px;font-size:13px}
.addtok{display:inline-flex;align-items:center;gap:2px;font-size:13px}
.pvas{display:inline-flex;align-items:center;gap:6px;font-size:13px;border:1px solid #d9d9d9;border-radius:6px;padding:3px 8px;margin-bottom:8px;animation:pop .25s ease both}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:16px}
.tile{display:flex;gap:12px;align-items:center;border:1px solid rgba(0,0,0,.08);border-radius:8px;padding:12px 14px;transition:background .3s,border-color .3s}
.tile>.ms{width:36px;height:36px;border-radius:8px;background:#eef8fb;color:#169bc2;display:flex;align-items:center;justify-content:center;flex:0 0 36px}
.tile small{display:block;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:#9ca3af}.tile b{font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}
.tile.alert{background:#fff4f4;border-color:#ffccc7}.tile.alert>.ms{background:#ffe8e6;color:#e5484d}
.segline{display:flex;align-items:center;gap:8px;margin:12px 0;flex-wrap:wrap}
.live{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#22a06b}.live i{width:8px;height:8px;border-radius:50%;background:#52c41a;animation:pulseg 1.6s infinite}
@keyframes pulseg{0%{box-shadow:0 0 0 0 rgba(82,196,26,.5)}100%{box-shadow:0 0 0 8px rgba(82,196,26,0)}}
.twgrid{display:grid;grid-template-columns:1fr 290px;gap:16px}
.plan{position:relative;border:1px solid #e8e8e8;border-radius:8px;background:#fbfcfd;aspect-ratio:560/320}
.plan>svg{position:absolute;inset:0;width:100%;height:100%}
.dcard{position:absolute;display:flex;flex-direction:column;align-items:center;gap:4px;transform:translate(-50%,-50%)}
.dth{border-radius:4px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.25);border:3px solid #222;background:#222}
.dth svg{display:block;width:100%;height:100%}.dth.land{width:132px;height:74px}.dth.port{width:50px;height:88px}
.dth.flash{animation:flash .9s ease}@keyframes flash{0%{box-shadow:0 0 0 0 rgba(22,155,194,.9)}100%{box-shadow:0 0 0 16px rgba(22,155,194,0)}}
.dcard small{font-size:11px;background:#fff;border:1px solid #e3e3e3;border-radius:99px;padding:1px 8px;display:flex;align-items:center;gap:4px;white-space:nowrap}
.nowp{border:1px solid #e8e8e8;border-radius:8px;padding:12px}.nh{font-weight:600;margin-bottom:6px}
.np{padding:9px 0;border-top:1px solid #f0f0f0}.np b{display:block;font-size:13px}.np span{display:block;font-size:13px;color:#169bc2;margin-top:2px}.np small{display:block;font-size:12px;color:rgba(0,0,0,.45);margin-top:2px}
.np.sw2{animation:fillin 1s ease}
.rulebox{margin-top:8px;padding:10px;border-radius:6px;background:#f7f7f7;font-size:12.5px;display:flex;justify-content:space-between;align-items:center;gap:8px}
.rs{font-weight:600;border-radius:99px;padding:2px 8px;font-size:11px;white-space:nowrap}.rs.ok{background:#e9f7ec;color:#22a06b}.rs.no{background:#fff1f0;color:#e5484d}
.lp{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:14px}
.lpc{border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;animation:rowin .5s ease both}
.lpc .ch{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 12px;background:#fafafa;border-bottom:1px solid #eee;font-size:13px;font-weight:500;white-space:nowrap}
.lpc .asset{margin:10px 12px 0}.lpc>small{display:block;padding:8px 12px 12px;font-size:12px;color:rgba(0,0,0,.55)}
.chip2{font-size:11px;border-radius:99px;padding:2px 8px;font-weight:500}.chip2.play{background:#e9f7ec;color:#22a06b}.chip2.busy{background:#fff1f0;color:#e5484d}
.chip small.sub2{display:block}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
[hidden]{display:none!important}
/* ---------- website look and feel: personalisationhub.com industry pages (ph-ind tokens) ---------- */
:root{--ph-navy:#1C2540;--ph-ink:#0F1424;--ph-muted:#5A6479;--ph-line:#DCE1EB;--ph-paper:#F5F7FB;--ph-teal:#169BC2;--ph-teal-d:#0F7A9A;--ph-green:#60D838;--ph-dline:#2A3350;--ph-dtext:#E9EDF6;
  --bg:var(--ph-paper);--panel:#fff;--fg:var(--ph-navy);--muted:var(--ph-muted);--line:var(--ph-line);--teal:var(--ph-teal);--chip:#E8F6FB}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0F1424;--panel:#161D31;--fg:#E9EDF6;--muted:#A3ADC2;--line:#2A3350;--chip:#12303C}}
:root[data-theme="dark"]{--bg:#0F1424;--panel:#161D31;--fg:#E9EDF6;--muted:#A3ADC2;--line:#2A3350;--chip:#12303C}
body{font-family:var(--display);padding-block:56px 72px}
.wrap{max-width:1160px;gap:18px}
.wrap .top .ms,.wrap .bar .ms,.wrap .flows .ms,.gate .ms,.proto .ms{font-family:"Material Symbols Rounded"}
.mark{font-size:13px;font-weight:600;letter-spacing:1.82px;text-transform:uppercase;color:var(--ph-teal-d);margin-bottom:10px}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .mark{color:#4FC3E3}}
.top h1,.top h2{font-size:clamp(30px,4.2vw,46px);font-weight:700;letter-spacing:-.03em;line-height:1.06;color:var(--fg)}
.top p{font-size:18px;line-height:1.5;margin-top:12px;max-width:62ch}
.field{border-radius:10px;padding:6px 8px 6px 12px;height:44px;box-sizing:border-box}.field label{font-size:13px;font-weight:600}.field input[type=text]{font-family:var(--display);font-size:14px}
.chip{font-family:var(--display);font-size:15px;font-weight:600;padding:10px 16px;background:var(--panel)}.chip small{font-weight:400}
.chip[aria-current="true"]{border-color:var(--ph-teal);background:var(--chip);color:var(--fg)}
.stagebox{border-radius:22px;box-shadow:none;border:.6px solid var(--line)}
.ctl{width:44px;height:44px}.ctl.main{background:var(--ph-teal);border-color:var(--ph-teal);color:var(--ph-ink)}
.dot{height:7px}.cap b{font-size:14.5px;font-weight:700}.cap span{display:block;margin-top:3px;font-size:12px;line-height:1.5}.fine{font-size:13px}
.proto{border-radius:12px;font-family:var(--display)}.proto-ctl button{font-family:var(--display);border-radius:999px;padding:8px 14px}
/* gate in the calculator's dark-panel style */
.gate{border-radius:22px}
.gate::before{background:linear-gradient(270deg,rgba(15,20,36,.97) 0%,rgba(15,20,36,.9) 32%,rgba(15,20,36,.3) 60%,rgba(15,20,36,.04) 100%)}
.g-panel{font-family:var(--display);color:var(--ph-dtext)}
.g-eb{font-size:13px;letter-spacing:1.82px;color:#4FC3E3}
.g-panel h3{font-size:clamp(22px,2.5cqw,32px);letter-spacing:-.02em;color:#fff}
.g-panel p{font-size:15.5px;color:#C3CBDD}
.g-flow{border-radius:14px;background:rgba(255,255,255,.04);border:1px solid var(--ph-dline);padding:12px 14px}
.g-flow:hover,.g-flow.gl-on{background:rgba(22,155,194,.14);border-color:var(--ph-teal)}
.g-flow>.ms{border-radius:10px;background:rgba(22,155,194,.16);color:#4FC3E3}
.g-flow b{font-size:16px;font-weight:700;color:#fff}.g-flow small{font-size:13.5px;color:#A3ADC2}
.g-flow .g-go{font-size:14px;color:#4FC3E3}
.g-flow i{background:var(--ph-teal)}
.g-cap{font-family:var(--display);background:rgba(15,20,36,.88);border:1px solid var(--ph-dline);font-size:14px}.g-cap .ms{color:#4FC3E3}
.g-sel{border-radius:14px;background:rgba(22,155,194,.14);border-color:var(--ph-teal)}.g-sel b{font-size:16px;color:#fff}.g-sel small{font-size:13.5px;color:#A3ADC2}.g-sel>.ms{color:#4FC3E3}
.g-form{gap:10px}.g-form label{font-size:14px;font-weight:600;color:var(--ph-dtext);gap:6px}
.g-form input[type=text],.g-form input[type=email]{height:44px;border-radius:10px;padding:9px 12px;font-family:var(--display);font-size:14px;color:var(--ph-navy);border:.6px solid var(--ph-line)}
.g-form .g-cons{font-size:14px;font-weight:400;color:#C3CBDD}.g-cons a{color:#4FC3E3;text-decoration:underline}
.g-sub{align-self:flex-start;height:44px;padding:0 22px;border-radius:999px;font-family:var(--display);font-size:14px;font-weight:700;background:var(--ph-line);color:var(--ph-muted)}
.g-sub:hover{background:#B3261E;color:#fff}.g-sub.ok{background:var(--ph-green);color:var(--ph-navy)}.g-sub.ok:hover{background:var(--ph-green);color:var(--ph-navy)}
.g-err{color:#FF9C8F;font-size:13px}.g-back{font-family:var(--display);font-size:14px;color:#A3ADC2}
@container (max-width: 760px){ .gate{background:var(--ph-ink);border-radius:22px} }
/* in-stage start and end cards: website buttons */
#card .in2{border-radius:22px;font-family:var(--display)}
#card h2{color:var(--ph-navy);letter-spacing:-.02em}
#card .eyebrow{color:var(--ph-teal-d);letter-spacing:1.82px;font-weight:600;font-size:13px}
#card p{color:var(--ph-muted)}
#card button,#card .acts a{height:46px;padding:0 22px;border-radius:999px;font-family:var(--display);font-size:16px;font-weight:600}
#card .go,#card .acts a.go{background:var(--ph-teal);color:#fff;min-height:56px;padding:0 30px;gap:10px;font-size:19px;font-weight:700}
#card .go .ms{color:#fff;font-size:24px;line-height:1}
#card .go:hover,#card .acts a.go:hover{background:#1288AB;color:#fff}
#card .ghost{border:1px solid var(--ph-line);color:var(--ph-navy);background:#fff}
#card .ms{font-family:"Material Symbols Rounded"}
.embed body{padding:0;background:transparent}.embed .top>div:first-child,.embed .proto{display:none}
/* ---------- full screen (native Fullscreen API, or a full-viewport fallback pinned by the parent page) ---------- */
.fsbtn{margin-left:0}.fsbtn .ms,.fsstart .ms,.fsexit .ms,.fsclose .ms{font-family:"Material Symbols Rounded"}
.fsclose{display:none}
html.fs .fsclose{display:inline-flex;align-items:center;justify-content:center;position:fixed;z-index:1000;top:max(12px,env(safe-area-inset-top,0px));right:max(12px,env(safe-area-inset-right,0px));width:40px;height:40px;padding:0;border:0;border-radius:50%;background:rgba(15,20,36,.72);color:#fff;cursor:pointer;-webkit-tap-highlight-color:transparent}
html.fs .fsclose .ms{font-size:24px;line-height:1}.fsclose:hover{background:rgba(44,53,80,.92)}.fsclose:focus-visible{outline:2px solid #7fd3ea;outline-offset:2px}
#card .fsonly{display:none}
html.fs #card .fsonly{display:inline-flex}
#card .acts.end{flex-direction:column;align-items:stretch;flex-wrap:nowrap;gap:20px}
#card .acts.end .go{width:100%;box-sizing:border-box;justify-content:center;height:auto;min-height:56px;padding:12px 30px;font-size:19px;font-weight:700;text-align:center}
#card .sec{display:flex;flex-wrap:nowrap;align-items:center;justify-content:space-between;gap:8px;width:100%;margin:0 0 8px;padding:0;font-size:inherit;letter-spacing:0;text-transform:none}
#card .sec .quiet{padding:4px 0;white-space:nowrap}
#card .sec .quiet:only-child{margin-right:auto}
#card .quiet{height:auto;min-height:32px;padding:4px 6px;border:0;border-radius:6px;background:none;color:var(--ph-muted);font-size:14px;font-weight:500;gap:6px}
#card .quiet:hover{color:var(--ph-navy);text-decoration:underline;text-underline-offset:3px}
#card .quiet .ms{font-size:18px}
#card .quiet:focus-visible{outline:2px solid var(--ph-teal-d);outline-offset:2px}
#card .go:focus-visible{outline:2px solid #fff;outline-offset:2px;box-shadow:0 0 0 4px var(--ph-ink)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) #card .quiet:hover{color:#fff}}
:root[data-theme="dark"] #card .quiet:hover{color:#fff}
@media (max-height:520px){#card .go,#card .acts.end .go{min-height:48px;height:auto;padding:8px 24px;font-size:19px;font-weight:700}#card .sec{margin-bottom:0}}
#card .fslink{height:auto;padding:6px 4px;border:0;background:none;color:#0F7A9A;font-size:14px;text-decoration:underline;text-underline-offset:3px}
html.fs #card .fslink{display:none}
/* start card: "Watch full screen" is a full-size secondary button beside "Start the tour" (50/50); in full screen only Start shows */
#card .acts.split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
#card .acts.split .go,#card .acts.split .fsbig{justify-content:center;height:auto;min-height:56px;padding:0 8px;gap:6px;font-size:15px;font-weight:700;box-sizing:border-box;white-space:nowrap}
#card .fsbig{background:#fff;border:2px solid var(--ph-teal);color:var(--ph-teal-d)}
#card .acts.split .ms{font-size:20px;line-height:1}
@media (max-width:420px){#card .acts.split{grid-template-columns:1fr}}
#card .fsbig:hover{background:#EAF6FA}
#card .fsbig:focus-visible{outline:2px solid var(--ph-teal-d);outline-offset:2px}
@media (max-height:520px){#card .acts.split .go,#card .acts.split .fsbig{min-height:48px}}
html.fs #card .acts.split{grid-template-columns:1fr}
html.fs #card .fsbig{display:none}
:root.fs{--bg:#0F1424;--panel:#192033;--fg:#e7edf2;--muted:#a3acc0;--line:#2c3550;--chip:#16303a;color-scheme:dark}
html.fs{scrollbar-gutter:auto}
html.fs,html.fs body{background:#0F1424;overflow:hidden;height:100%}
html.fs body{padding:0}
html.fs .wrap{position:fixed;inset:0;z-index:100;max-width:none;margin:0;box-sizing:border-box;height:100vh;height:100dvh;gap:10px;padding:12px max(16px,env(safe-area-inset-right,0px)) max(12px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));background:#0F1424;color:var(--fg);overflow:hidden}
html.fs .top p,html.fs .mark,html.fs .fine,html.fs .proto{display:none}
html.fs .top{align-items:center;flex:0 0 auto;padding-right:calc(40px + 12px)}
html.fs .top h2{font-size:clamp(16px,2.2vw,22px)}
html.fs .flows{flex:0 0 auto}
html.fs .bar{flex:0 0 auto}
html.fs .tourbox{flex:1 1 0;min-height:0;container-type:size;display:grid;place-items:center}
html.fs .stagebox{width:min(100cqw,calc(100cqh * 1280 / 760));box-shadow:none}
@media (max-height:520px){html.fs .top h2{display:none}html.fs .wrap{gap:6px;padding-top:8px}html.fs .cap span{display:none}}
/* landscape phones: the stage dominates. One compact row of flow chips with the company field at its end (the brand row is folded in),
   the stage, then a one-row control bar (prev, play, next, dots, caption filling the rest, full-screen button). */
@media (max-height:520px){
html.fs .wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto minmax(0,1fr) auto;gap:6px 10px;padding-top:6px;padding-bottom:max(6px,env(safe-area-inset-bottom,0px))}
html.fs .top{display:contents}
html.fs .top>div:first-child{display:none}
html.fs .prefs{grid-column:2;grid-row:1;flex-wrap:nowrap;gap:6px;align-self:center;margin-right:calc(40px + 8px)}
html.fs .prefs .field{padding:0 4px 0 8px;gap:6px;height:34px;box-sizing:border-box}
html.fs .prefs .field label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
html.fs .prefs .field input[type=text]{width:96px;font-size:13px}
html.fs .prefs .field input[type=color]{width:24px;height:24px}
html.fs .flows{grid-column:1;grid-row:1;min-width:0;max-height:36px;align-items:center;gap:6px;padding:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
html.fs .flows::-webkit-scrollbar{display:none}
html.fs .chip{padding:4px 12px;font-size:13px;line-height:20px;gap:6px;white-space:nowrap}
html.fs .chip small{display:none}
html.fs .tourbox{grid-column:1/-1;grid-row:2}
html.fs .bar{grid-column:1/-1;grid-row:3;flex-wrap:nowrap;gap:8px 10px;max-height:52px;min-height:0;align-items:center}
html.fs .bar .ctl{flex:0 0 auto;width:36px;height:36px}
html.fs .dots{flex:0 0 auto;gap:4px}
html.fs .dot{width:16px}
html.fs .cap{flex:1 1 0;min-width:0}
html.fs .cap b{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
html.fs .fsbtn{margin-left:0;flex:0 0 auto}
}
/* full screen: the bar is exactly as wide as the stage (--stage-w, set from #box). One row: controls at its left edge, compact dots, caption filling the rest, right-aligned and flush with the stage's right edge. The bar's own full-screen toggle is hidden (the top-right x and Esc exit). */
html.fs .bar{width:var(--stage-w,100%);max-width:100%;margin-inline:auto;box-sizing:border-box;padding-block:8px;flex-wrap:nowrap;gap:8px 24px;max-height:none;align-items:center}
html.fs .dots{flex:0 0 auto;gap:4px}
html.fs .dot{width:10px}
html.fs .fsbtn{display:none}
html.fs .cap{flex:1 1 0;min-width:0;text-align:right}
html.fs .cap b{display:block;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
html.fs .cap span{display:block;margin-top:4px;font-size:12px;line-height:1.5}
@media (max-width:599px){html.fs .bar{flex-wrap:wrap;gap:8px 16px}html.fs .cap{order:-1;flex:1 1 100%}html.fs .cap b{white-space:normal}html.fs .dots{order:4;flex:1 1 100%;margin-right:0;gap:4px}html.fs .dot{flex:1 1 0;width:auto;max-width:26px}html.fs .fsbtn{display:inline-flex;order:3;margin-left:0;flex:0 0 auto}}
@media (max-height:520px) and (min-width:600px){html.fs .bar{width:auto;max-width:none;margin-inline:0;flex-wrap:nowrap;padding-block:0;gap:8px 10px}html.fs .dot{width:16px}html.fs .cap{order:5;flex:1 1 0;text-align:right}html.fs .cap span{display:none}html.fs .cap b{font-size:13px}}
/* ---- Fuel & convenience walkthrough (retailer's own campaign): four venue screens, five scenes ---- */
.cv{position:absolute;left:0;top:0;width:1280px;height:760px;background:linear-gradient(180deg,#0e1a2c 0%,#16283f 100%);color:#fff;font-family:Roboto,Arial,sans-serif;overflow:hidden}
.cv *{box-sizing:border-box}
.cv-top{position:absolute;left:32px;right:32px;top:22px;display:flex;align-items:center;gap:14px}
.cv-logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px}
.cv-logo i{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;font-style:normal;font-weight:900;font-size:16px;color:#fff}
.cv-sc{margin-left:auto;font-size:13px;letter-spacing:.8px;text-transform:uppercase;color:#9fb4cc;font-weight:500}
.cv-row{position:absolute;left:0;right:0;bottom:44px;display:flex;justify-content:center;align-items:flex-end;gap:52px}
.cv-loc{display:flex;flex-direction:column;align-items:center;gap:12px;transition:transform .5s,opacity .5s}
.cv-loc.dim{opacity:.55}
.cv-loc.on{transform:translateY(-8px)}
.cv-tile{position:relative;background:#05080d;border-radius:16px;padding:9px;box-shadow:0 18px 40px rgba(0,0,0,.45);border:2px solid #263a55;transition:border-color .4s,box-shadow .4s}
.cv-loc.on .cv-tile{border-color:var(--cva,#7fe05a);box-shadow:0 0 0 4px rgba(127,224,90,.18),0 18px 40px rgba(0,0,0,.45)}
.cv-scr{position:relative;width:100%;height:100%;border-radius:9px;overflow:hidden}
.cv-tile.fore{width:300px;height:198px}.cv-tile.shop{width:198px;height:352px}.cv-tile.cool{width:160px;height:352px}.cv-tile.pos{width:250px;height:156px}
.cv-lab{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:500;color:#dbe6f3}.cv-lab .ms{font-size:20px;color:var(--cva,#7fe05a)}
.cv-lab small{display:block;font-size:11.5px;color:#8ea3bc;font-weight:400}
.cv-ad{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:12px 14px;animation:fade .45s ease both;font-size:var(--fs,13px)}
.cv-ad .ic{font-size:2.6em;opacity:.9;margin-bottom:.35em}
.cv-ad b{display:block;font-size:1.55em;line-height:1.12;font-weight:900;letter-spacing:-.01em;text-wrap:balance}
.cv-ad small{display:block;margin-top:.45em;font-size:1em;opacity:.9;line-height:1.3;font-weight:500}
.cv-ad .tg{display:inline-flex;align-self:flex-start;align-items:center;gap:.4em;font-size:.78em;letter-spacing:.5px;text-transform:uppercase;font-weight:700;background:rgba(255,255,255,.2);padding:.3em .7em;border-radius:99px;margin-bottom:.6em}
.cv-ad .tg .ms{font-size:1.3em}
.cv-ad .cup{position:absolute;right:6px;bottom:4px;width:34%;opacity:.95}
.cv-ad.cre,.cv-ad.per{background:linear-gradient(150deg,#5a2d12,#a4501c)}
.cv-ad.per{background:linear-gradient(150deg,#0b4a3a,#14805f)}
.cv-ad.per .tg{background:#b6f432;color:#0b2a21}
.cv-tile.fore{--fs:13.5px}.cv-tile.shop{--fs:11.5px}.cv-tile.cool{--fs:10.5px}.cv-tile.pos{--fs:11.5px}
.cv-tile.shop .cup,.cv-tile.cool .cup{width:60%;right:10px}
.cv-panel{position:absolute;background:#fff;color:#1d2730;border-radius:16px;box-shadow:0 14px 36px rgba(0,0,0,.35);overflow:hidden}
.cv-ph{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #e3e9ef;font-weight:700;font-size:16px}.cv-ph .ms{color:#169bc2;font-size:24px}
.cv-ph em{margin-left:auto;font-style:normal;font-size:12px;font-weight:500;color:#5b6873;background:#eef3f7;padding:3px 10px;border-radius:99px}
.cv-pb{padding:18px}
.cv-brief{min-height:118px;border:1px solid #d5dde5;border-radius:12px;padding:14px;font-size:16px;line-height:1.5;color:#1d2730;background:#f8fafc}
.cv-brief .caret{display:inline-block;width:2px;height:1.1em;background:#169bc2;vertical-align:text-bottom;margin-left:1px}.cv-brief .caret.typing{animation:blink 1s step-end infinite}
.cv-mic{display:inline-flex;align-items:center;gap:10px;height:44px;padding:0 18px;border-radius:99px;background:#eef3f7;color:#1d2730;font-weight:500;font-size:15px;margin-top:14px}
.cv-mic .ms{font-size:22px}.cv-mic.rec{background:#fdecec;color:#c23030;animation:pulse 1.4s infinite}
.cv-prog{margin-top:16px;display:flex;flex-direction:column;gap:9px}
.cv-pi{display:flex;align-items:center;gap:10px;font-size:15px;color:#8a97a3;transition:color .3s}.cv-pi .ms{font-size:22px;color:#c3ccd5}
.cv-pi.run{color:#1d2730}.cv-pi.run .ms{color:#169bc2;animation:spin 1.1s linear infinite}
.cv-pi.done{color:#1d2730}.cv-pi.done .ms{color:#2e9d5b}
.cv-cre{position:absolute;display:flex;flex-direction:column;gap:10px;align-items:center;transition:opacity .4s}
.cv-cre .cv-tile{border-color:#2d4361}.cv-cre.wait{opacity:.35}
.cv-chip{display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 15px;border-radius:99px;border:1.5px solid #cfd9e2;font-size:15px;font-weight:500;color:#33414d;background:#fff;transition:all .25s}
.cv-chip .ms{font-size:20px;display:none}.cv-chip.sel{background:#e4f5fb;border-color:#169bc2;color:#0d6f8f}.cv-chip.sel .ms{display:inline-block}
.cv-chip small{color:#7a8794;font-weight:400;font-size:12.5px}
.cv-chips{display:flex;flex-wrap:wrap;gap:10px}
.cv-lab2{font-size:12.5px;letter-spacing:.7px;text-transform:uppercase;color:#6a7783;font-weight:700;margin:16px 0 8px}.cv-lab2:first-child{margin-top:0}
.cv-sw{display:inline-flex;align-items:center;width:52px;height:30px;border-radius:99px;background:#c8d2db;padding:3px;transition:background .3s;flex:none}.cv-sw i{width:24px;height:24px;border-radius:50%;background:#fff;transition:transform .3s;box-shadow:0 1px 3px rgba(0,0,0,.3)}.cv-sw.on{background:#2e9d5b}.cv-sw.on i{transform:translateX(22px)}
.cv-rule{display:grid;grid-template-columns:1.25fr 1fr .8fr 1fr;gap:8px;margin-top:10px;animation:rowin .4s ease both}.cv-rule div{border:1px solid #d5dde5;border-radius:8px;padding:8px 11px;font-size:13.5px;background:#fff}.cv-rule small{display:block;font-size:10.5px;color:#7a8794;letter-spacing:.4px;text-transform:uppercase}
.cv-stat{display:flex;align-items:center;gap:10px;font-size:14px;color:#33414d}.cv-stat b{font-size:20px}
.cv-track{position:absolute;left:150px;right:150px;top:92px;height:90px}
.cv-line{position:absolute;left:60px;right:60px;top:42px;height:4px;border-radius:3px;background:#2a4263}
.cv-lf{position:absolute;left:60px;top:42px;height:4px;border-radius:3px;background:var(--cva,#7fe05a);width:0;transition:width 1.1s cubic-bezier(.45,0,.25,1)}
.cv-stop{position:absolute;top:30px;width:28px;height:28px;margin-left:-14px;border-radius:50%;background:#16283f;border:3px solid #2f4b70;display:grid;place-items:center;font-size:12px;font-weight:700;color:#8ea3bc;transition:all .4s}
.cv-stop.on{border-color:var(--cva,#7fe05a);color:#0b2a21;background:var(--cva,#7fe05a)}
.cv-me{position:absolute;top:8px;width:52px;margin-left:-26px;text-align:center;transition:left 1.1s cubic-bezier(.45,0,.25,1)}
.cv-me i{display:grid;place-items:center;width:44px;height:44px;margin:0 auto;border-radius:50%;background:#fff;color:#0e1a2c;font-style:normal;font-weight:900;font-size:18px;box-shadow:0 0 0 4px rgba(255,255,255,.2)}
.cv-rec{position:absolute;left:50%;top:10px;transform:translateX(-50%);display:inline-flex;align-items:center;gap:8px;background:#b6f432;color:#0b2a21;border-radius:99px;height:34px;padding:0 16px;font-weight:700;font-size:14px;animation:pop .4s ease both}.cv-rec .ms{font-size:20px}
.cv-kpis{position:absolute;left:32px;top:64px;width:360px;display:flex;flex-direction:column;gap:14px}
.cv-kpi{background:#fff;color:#1d2730;border-radius:14px;padding:16px 18px;display:flex;align-items:center;gap:14px;box-shadow:0 10px 26px rgba(0,0,0,.3)}
.cv-kpi .ic{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;background:#e4f5fb;color:#169bc2}.cv-kpi .ic .ms{font-size:26px}
.cv-kpi small{display:flex;align-items:center;gap:5px;color:#5b6873;font-size:13.5px}.cv-kpi b{display:block;font-size:30px;line-height:1.1;font-variant-numeric:tabular-nums}
.cv-i{font-size:17px!important;color:#169bc2;cursor:default}
.cv-chart{left:424px;top:64px;width:824px;height:628px}
.cv-leg{display:flex;gap:18px;margin-left:auto;font-size:13px;font-weight:500;color:#33414d}.cv-leg span{display:inline-flex;align-items:center;gap:6px}.cv-leg i{width:12px;height:12px;border-radius:3px;display:inline-block}
.cv-bar{transform-origin:50% 100%;transform-box:fill-box;animation:cvgrow .9s cubic-bezier(.3,.9,.3,1) both}@keyframes cvgrow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.cv-title{position:absolute;left:32px;top:66px;max-width:1000px}.cv-title b{display:block;font-size:32px;font-weight:900;letter-spacing:-.02em}.cv-title span{display:block;margin-top:6px;font-size:16px;color:#aebfd3}
.cv-pill{position:absolute;left:50%;top:196px;transform:translateX(-50%);display:inline-flex;align-items:center;gap:10px;height:40px;padding:0 20px;border-radius:99px;background:rgba(255,255,255,.1);border:1px solid #2f4b70;font-size:15px;color:#dbe6f3;white-space:nowrap}.cv-pill .ms{animation:spin 3s linear infinite}
.cv-ad.cre b,.cv-ad.per b,.cv-ad.cre small,.cv-ad.per small{max-width:66%}
.cv-tile.shop .cv-ad,.cv-tile.cool .cv-ad{justify-content:flex-start;padding-top:18px}
.cv-tile.shop .cv-ad b,.cv-tile.cool .cv-ad b,.cv-tile.shop .cv-ad small,.cv-tile.cool .cv-ad small{max-width:100%}
.cv-tile.pos .cv-ad.per b,.cv-tile.pos .cv-ad.cre b{font-size:1.35em}
.cv-title+.cv-track{top:150px}


/* retail media: real prototype screenshots fill the stage; hotspots are invisible targets for the cursor and tips */
.rm-shot{position:absolute;inset:0;background:#fff}.rm-shot img{display:block;width:1280px;height:760px;animation:fade .35s ease both}.rm-shot.swap img{animation:none}.rm-hold{position:absolute;inset:0;overflow:hidden;pointer-events:none;transition:opacity .18s ease}.rm-hold *{animation-delay:-60s!important;transition:none!important}.rm-hold.out{opacity:0}
html.ph-rm #capS{min-height:3em;min-height:2lh}
@media (max-width:1079px){html.ph-rm:not(.fs) .cap{order:5;flex:1 1 100%;text-align:left}}
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
.rm-login{position:absolute;inset:0;overflow:hidden;background:#141c28;font-family:Roboto,Arial,sans-serif}.rl-bg{position:absolute;inset:0;background:center/cover no-repeat}
.rl-brand{position:absolute;left:77px;top:18px;display:flex;align-items:center;gap:9px;color:#fff;font-size:21px;letter-spacing:.3px}.rl-brand b{font-weight:700}
.rl-card{position:absolute;left:50%;top:125px;width:456px;height:488px;margin-left:-228px;background:#fff;border-radius:6px;padding:62px 108px 0;box-sizing:border-box;color:#262626}
.rl-logo{display:flex;align-items:center;justify-content:center;gap:10px;height:40px;font-weight:700;font-size:16px;color:#1f2a37}
.rl-card h3{margin:20px -40px 22px;text-align:center;font-size:24px;font-weight:500;letter-spacing:-.2px;white-space:nowrap}
.rl-lab{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:#8c8c8c;margin:0 0 5px}.rl-lab i{color:#ff4d4f;font-style:normal;margin-right:3px}.rl-lab .ms{font-size:13px}
.rl-card .in{border:1px solid #d9d9d9;border-radius:4px;height:26px;padding:0 9px;font-size:12px;display:flex;align-items:center;margin-bottom:16px;box-sizing:border-box}
.rl-row{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:#8c8c8c;margin:6px 0 24px}.rl-row>span{display:flex;align-items:center;gap:7px}.rl-row b{font-weight:400;color:#262626;margin-right:10px}
.rl-cb{width:12px;height:12px;border:1px solid #d9d9d9;border-radius:2px;display:inline-block}
.rl-btn{display:flex;align-items:center;justify-content:center;height:26px;border-radius:4px;background:#169BC2;color:#fff;font-weight:600;font-size:12px}
.rl-pow{position:absolute;left:0;right:0;bottom:24px;display:flex;align-items:center;justify-content:center;gap:5px;font-size:9.5px;color:#8c8c8c}.rl-pow span{font-size:13px;color:#9a9a9a;letter-spacing:.2px}.rl-pow b{font-weight:700}
.f .in.dsel{display:flex;align-items:center;justify-content:space-between}.f .in.dsel .ms{color:#999;font-size:18px}
.sel.w4{position:relative}.sel.w4:has(.dchev){padding-right:26px}.sel.w4 .dchev{position:absolute;right:6px;top:50%;transform:translateY(-50%);color:#999;font-size:18px}
.rm-lc{width:400px;background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(10,30,45,.18);padding:28px 30px;display:flex;flex-direction:column;gap:6px}
.rm-lm{display:flex;align-items:center;gap:10px;font-size:20px;margin-bottom:8px}.rm-lm b{font-weight:700}
.rm-lc h3{margin:6px 0 0;font-size:20px}.rm-ls{color:#667;margin-bottom:10px}.rm-lc label{font-size:13px;color:#555;margin-top:6px}
.rm-lc .in{border:1px solid #d9d9d9;border-radius:6px;min-height:36px;padding:8px 10px;font-size:14px}.rm-lc .aibtn{justify-content:center;margin-top:14px}
.cv-ad .sl{position:absolute;left:12px;bottom:7px;font-size:.66em;font-weight:700;letter-spacing:.4px;text-transform:uppercase;opacity:.82}
.cv.rm .cv-ad.cre,.cv.rm .cv-ad.per{background:linear-gradient(150deg,#06345a,#0A5C99)}
.vogrp{display:inline-flex;align-items:center;gap:4px}.vogrp[hidden]{display:none}
.ctl#vo.on{border-color:var(--ph-teal,#169BC2);color:var(--ph-teal,#169BC2)}
/* "Enable sound" hint: a bubble above the speaker button for a moment when a flow starts with the voiceover off */
.vogrp{position:relative}
.vohint{position:absolute;bottom:calc(100% + 12px);right:-10px;z-index:60;display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:10px;background:#14202b;color:#fff;font-size:14px;font-weight:600;line-height:1.2;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.28);cursor:pointer;animation:vohint-in .25s ease both}
.vohint::after{content:"";position:absolute;top:100%;right:22px;border:7px solid transparent;border-top-color:#14202b}
.vohint .ms{font-size:20px;color:#7fd3ea}
#vo.pulse{border-color:var(--ph-teal,#169BC2);color:var(--ph-teal,#169BC2);animation:vopulse 1.1s ease-in-out infinite}
@keyframes vopulse{0%,100%{box-shadow:0 0 0 0 rgba(22,155,194,.55)}50%{box-shadow:0 0 0 9px rgba(22,155,194,0)}}
@keyframes vohint-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.sfa{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;margin-left:12px;border-radius:6px;background:#169BC2;color:#fff;font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap}.sfa .ms{font-size:17px}.sfa.sent{background:#f2f2f2;color:#8c8c8c;cursor:default}
</style>
</head>
<body>
<div class="wrap" id="wrap">
  <button class="fsclose" id="fsclose" type="button" aria-label="Exit full screen"><span class="ms" aria-hidden="true">close</span></button>
  <div class="top">
    <div>
      <div class="mark">Interactive product tour</div>
      <h2 id="h1">Launch a campaign just by talking</h2>
      <p id="sub">Talk the AI campaign agent through a campaign and watch it become a brief, copy, creative and screen-ready assets for every touchpoint, in your brand.</p>
    </div>
    <div class="prefs">
      <div class="field"><label for="co">Your company</label><input type="text" id="co" maxlength="32" autocomplete="organization"><input type="color" id="col" aria-label="Brand colour"></div>
    </div>
  </div>

  <nav class="flows" aria-label="Tour flows" id="flows"></nav>

  <div class="tourbox" id="tourbox">
    <div class="stagebox" id="box"><div id="stage" aria-hidden="true"></div></div>
    <div class="gate" id="gate" hidden></div>
  </div>

  <div class="bar">
    <button class="ctl" id="prev" type="button" aria-label="Previous step"><span class="ms">skip_previous</span></button>
    <button class="ctl main" id="play" type="button" aria-label="Pause"><span class="ms">pause</span></button>
    <button class="ctl" id="next" type="button" aria-label="Next step"><span class="ms">skip_next</span></button>
    <div class="dots" id="dots" role="tablist" aria-label="Steps"></div>
    <span class="vogrp" id="vogrp" hidden><button class="ctl" id="vo" type="button" aria-pressed="false" aria-label="Turn voiceover on"><span class="ms">volume_off</span></button></span><button class="ctl fsbtn" id="fs" type="button" aria-label="Full screen" aria-pressed="false"><span class="ms">fullscreen</span></button>
    <div class="cap" aria-live="polite"><b id="capT">Ready when you are</b><span id="capS">Press Start the tour, or pick a step.</span></div>
  </div>
  <div class="fine">Example company, stores and figures are illustrative. Screens recreate Personalisation Hub HQ Admin.</div>
</div>

<script>
(() => {
/* ================= data ================= */
const IS_CONV = /^\/industries\/convenience\/tour(\/|$)/.test(location.pathname);
const IS_RM = /^\/industries\/retail-media\/tour(\/|$)/.test(location.pathname) || window.PH_TOUR_IND === "retail-media" || /[?&]ind=retail-media(&|$)/.test(location.search);
/* Screenshots and voiceover: on the live site tour.php serves them same-origin (sha-pinned); anywhere else (the train preview) they load from the pinned assets tag on GitHub. */
const RM_ASSETS = window.PH_TOUR_ASSETS || (/^\/industries\/retail-media\/tour(\/|$)/.test(location.pathname) ? "/industries/retail-media/tour/assets/v1/" : "https://raw.githubusercontent.com/offline2online/rob_ph_demos/tour-assets-retail-media-v1/ph-website/tour-assets/retail-media/");
const RM_IMG = window.PH_TOUR_IMG || RM_ASSETS + "img/";
const FLOWS = IS_RM ? [
  ["Retailer setup", true, "Playlists · direct deal"], ["Advertiser creates by talking", true, "Voice brief · targeting"], ["Shopper journey & outcome", true, "Forecourt to POS · bookings"]
] : [
  ["Automated campaign creative", true], ["Seamless localisation & scheduling", true, "Stores · digital twin"], ["Seamless personalisation", true, "Check-in · first-party data"]
];
const IND = {
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
  },
  telco: {
    brand: "Nimbus Mobile", color: "#0B7A5E", accent: "#C6F432", stores: 24,
    rows: [
      ["LOCALISED", "5G Home Internet | First month free", "Home internet switchers", ["tv","language"]],
      ["TRIGGERED", "Prepaid $35 | Double data weekends", "Prepaid upgraders", ["tv","storefront"]],
      ["TARGETED", "Family Plans | Save on 3+ lines", "Families", ["tv","language","storefront"]],
      ["SCHEDULED", "Watch Launch | Pre-order in store", "Early adopters", ["tv"]],
    ],
    brief: "Trade-in offer for existing iPhone users: up to $800 off the latest iPhone when they trade in their current iPhone on a 24-month plan. Run it in all stores through December on in-store screens, the website and store sites.",
    name: "iPhone Trade-in | Up to $800 off",
    details: "In-store and online trade-in campaign for existing iPhone users, offering up to $800 off the latest iPhone when they trade in their current iPhone on a 24-month plan. Creative leads with the saving and drives iPhone users to the in-store trade-in check.",
    products: ["iPhone", "24-month plans", "iPhone trade-in"], audience: ["Existing iPhone users"], objective: "Drive Upgrades",
    headline: "Trade up your iPhone", sub: "Up to $800 off the latest iPhone*", legal: "*On a 24-month plan. Trade-in value depends on iPhone model and condition. T&Cs apply.",
    big: "$800", bigSub: "OFF WITH iPhone TRADE-IN*", change: "Make the background brighter for daytime stores",
    thumbs: ["home", "data", "family", "watch"],
    p3: { name: "Gold Members | Extra $200 iPhone trade-in", headline: "Gold members get more", sub: "Extra $200 on your iPhone trade-in*", big: "+$200", bigSub: "GOLD TRADE-IN BONUS*",
      legal: "*Loyalty Gold members only, on a 24-month plan. Trade-in value depends on iPhone model and condition. T&Cs apply.", audience: ["Loyalty Gold"] }
  },
  pharmacy: {
    brand: "Harbourside Pharmacy", color: "#1D3F8F", accent: "#F2665E", stores: 38,
    rows: [
      ["LOCALISED", "Winter Wellness | 2 for $30 vitamins", "Health-conscious shoppers", ["tv","language"]],
      ["TARGETED", "Skin Check Week | Book a free skin check", "Skincare regulars", ["tv","storefront"]],
      ["TRIGGERED", "Hold Your Place | Scan to join the queue", "Store visitors", ["tv"]],
      ["SCHEDULED", "Travel Essentials | Pack before you fly", "Travellers", ["tv","language"]],
    ],
    brief: "Summer sun care campaign: 2 for $30 on SPF 50+ sunscreen and after-sun, from December to February in every store. Show it on in-store screens, the website and store sites, aimed at families and beach-goers.",
    name: "Sun Care | 2 for $30 SPF 50+",
    details: "Seasonal campaign promoting 2 for $30 on SPF 50+ sunscreen and after-sun. Creative leads with the summer saving, reminds families and beach-goers to stay sun-smart and points them to the sun care bay.",
    products: ["SPF 50+ sunscreen", "After-sun"], audience: ["Families", "Beach-goers"], objective: "Drive Store Visits",
    headline: "SUN-SMART SUMMER", sub: "2 for $30 on SPF 50+ sunscreen*", legal: "*Selected sun care range. While stocks last. Always read the label and use only as directed.",
    big: "2 FOR $30", bigSub: "SPF 50+ SUN CARE*", change: "Make the background brighter for daytime stores",
    thumbs: ["leaf", "skin", "queue", "plane"],
    p3: { name: "Gold Members | Extra 20% off sun care", headline: "Gold members save more", sub: "Extra 20% off sun care for Gold members*", big: "+20%", bigSub: "GOLD SUN CARE BONUS*",
      legal: "*Loyalty Gold members only, on the selected sun care range. While stocks last. Always read the label and use only as directed.", audience: ["Loyalty Gold"] }
  },
  convenience: {
    brand: "Larkspur Convenience", color: "#D9541E", accent: "#8EE05A", stores: 53,
    rows: [
      ["LOCALISED", "Fresh Bakery | Warm pastries all morning", "Commuters", ["tv"]],
      ["TARGETED", "Car Wash | $8 with any fill", "Fuel customers", ["tv"]],
      ["TRIGGERED", "Loyalty App | Earn double points", "App users", ["tv"]],
      ["SCHEDULED", "Cold Drinks | 2 for $5 energy", "Afternoon shoppers", ["tv"]],
    ],
    brief: "Coffee and pastry deal, $6, weekday mornings. Show it on the driveway and forecourt screens, the shop front, the coolers and the POS screens in every store, aimed at commuters and fuel customers.",
    name: "Coffee + Pastry | $6 weekday mornings",
    details: "Weekday morning campaign offering a flat white and any pastry for $6. Creative leads with the price, catches fuel customers on the forecourt and points them to the coffee bar, then reminds them at the coolers and the POS.",
    products: ["Flat white", "Pastry"], audience: ["Commuters", "Fuel customers"], objective: "Drive Store Visits",
    headline: "COFFEE + PASTRY", sub: "A flat white and any pastry for $6*", legal: "*Weekday mornings only. One pastry per coffee. While stocks last. Participating stores only.",
    big: "$6", bigSub: "COFFEE + PASTRY*", change: "Make the background brighter for daytime forecourts",
    thumbs: ["coffee", "car", "snow", "bolt"],
    p3: { name: "Gold Members | Your usual coffee + pastry", headline: "WELCOME BACK", sub: "Your usual flat white and pastry, $6*", big: "YOUR USUAL", bigSub: "GOLD MEMBER OFFER*",
      legal: "*Loyalty Gold members only, weekday mornings. One pastry per coffee. While stocks last. Participating stores only.", audience: ["Loyalty Gold"] }
  }
};
/* One tour source for every industry page: the page path picks the industry (/industries/pharmacy/tour/ is pharmacy, anything else telco). */
const IND_FROM_PATH = IS_RM ? "retail-media" : IS_CONV ? "convenience" : /^\/industries\/pharmacy\/tour(\/|$)/.test(location.pathname) ? "pharmacy" : "telco";
const S = { flow: 0, ind: IND_FROM_PATH, brand: null, color: null, custom: false, step: -1, paused: false, scale: 1, bright: false };
try { document.title = "Interactive product tour · " + (IS_RM ? "Retail Media" : S.ind === "pharmacy" ? "Pharmacy" : S.ind === "convenience" ? "Fuel & Convenience" : "Telco Retail") + " | Personalisation Hub"; } catch (e) {}
const INDLABEL = IS_RM ? "retail media" : S.ind === "pharmacy" ? "pharmacy" : S.ind === "convenience" ? "fuel and convenience" : "telco";
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const RMI = () => IND["retail-media"];
const D = () => IS_RM ? (S.flow === 0 ? RMI() : (S.flow === 2 || S.p3) ? { ...RMI(), ...RMI().adv, ...RMI().p3 } : { ...RMI(), ...RMI().adv }) : S.flow === 2 ? { ...IND[S.ind], ...IND[S.ind].p3 } : IND[S.ind];
/* In retail media B and C are always the retailer (HQ Admin, loyalty app); ADV is the advertiser whose creative is drawn. */
const B = () => S.brand || (IS_RM ? RMI().brand : D().brand);
const C = () => S.color || (IS_RM ? RMI().color : D().color);
const ADV = () => RMI().adv;
const AB = () => IS_RM ? ADV().brand : B();

/* ================= colour + svg helpers ================= */
const hx = h => { h = h.replace("#",""); if (h.length===3) h=[...h].map(c=>c+c).join(""); return [0,2,4].map(i=>parseInt(h.substr(i,2),16)); };
const toHex = a => "#" + a.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,"0")).join("");
const mix = (a,b,t) => { const x=hx(a), y=hx(b); return toHex(x.map((v,i)=>v+(y[i]-v)*t)); };
const esc = s => String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const initials = n => (n.trim().split(/\s+/).slice(0,2).map(w=>w[0]||"").join("") || "Y").toUpperCase();
let gid = 0;

function logoSVG(size, onDark) {
  const c = C(), ini = esc(initials(B()));
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="${c}"/><circle cx="31" cy="9" r="5" fill="${IS_RM ? RMI().accent : D().accent}"/><text x="20" y="26.5" text-anchor="middle" font-family="Roboto,Arial" font-weight="900" font-size="${ini.length>1?15:18}" fill="#fff">${ini}</text></svg>`;
}
function illo(x, y, s, a, dark) {
  if (S.ind === "retail-media") return `<g transform="translate(${x} ${y + 6 * s}) scale(${s})">
    <circle cx="150" cy="80" r="76" fill="${a}" opacity=".22"/><ellipse cx="120" cy="230" rx="88" ry="9" fill="#000" opacity=".18"/>
    <path d="M96 14h40v26c0 10 22 22 22 46v128c0 10-8 16-16 16h-52c-8 0-16-6-16-16V86c0-24 22-36 22-46z" fill="#ffffff"/>
    <rect x="96" y="6" width="40" height="14" rx="4" fill="${a}"/><rect x="74" y="112" width="84" height="62" fill="${a}"/>
    <text x="116" y="150" text-anchor="middle" font-family="Roboto,Arial" font-weight="900" font-size="17" fill="#fff">ICE</text>
    <path d="M190 120l10 18M200 112l-4 22M214 128l-18 6" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity=".85"/>
    <path d="M40 150l10 18M50 142l-4 22M64 158l-18 6" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity=".6"/></g>`;
  if (S.ind === "convenience") return `<g transform="translate(${x} ${y + 10 * s}) scale(${s})">
    <circle cx="150" cy="70" r="72" fill="${a}" opacity=".24"/><ellipse cx="116" cy="224" rx="92" ry="9" fill="#000" opacity=".18"/>
    <path d="M62 78h110v58c0 40-26 70-55 70s-55-30-55-70z" fill="#ffffff"/><path d="M62 78h110v58c0 40-26 70-55 70s-55-30-55-70z" fill="${dark}" opacity=".08"/>
    <path d="M172 96h14c26 0 26 52 0 52h-17" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round"/>
    <rect x="62" y="104" width="110" height="46" fill="${a}"/><text x="117" y="137" text-anchor="middle" font-family="Roboto,Arial" font-weight="900" font-size="24" fill="${dark}">$6</text>
    <path d="M86 62c-4-14 14-14 10-30M118 62c-4-14 14-14 10-30M150 62c-4-14 14-14 10-30" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" opacity=".85"/>
    <path d="M150 214c14-34 58-34 74 0-18 18-58 18-74 0z" fill="#f2b45a"/><path d="M170 202l9 20M188 198l5 24M206 202l-2 22" stroke="#c9822a" stroke-width="5" stroke-linecap="round"/></g>`;
  if (S.ind === "telco") return `<g transform="translate(${x} ${y}) scale(${s})">
    <g transform="rotate(-12 40 120)" opacity=".55"><rect x="0" y="20" width="90" height="180" rx="16" fill="${dark}"/><rect x="6" y="28" width="78" height="164" rx="11" fill="#ffffff22"/></g>
    <rect x="70" y="0" width="120" height="240" rx="22" fill="#0d1114"/><rect x="77" y="8" width="106" height="224" rx="16" fill="url(#scr${gid})"/>
    <rect x="115" y="16" width="30" height="7" rx="3.5" fill="#0d1114"/>
    <circle cx="190" cy="40" r="26" fill="${a}"/><text x="190" y="47" text-anchor="middle" font-family="Roboto,Arial" font-weight="900" font-size="20" fill="#0d1114">5G</text>
    <path d="M40 232 q60 30 120 0" stroke="${a}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M150 224 l12 8 -12 9" stroke="${a}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  return `<g transform="translate(${x} ${y + 16 * s}) scale(${s})">
    <circle cx="150" cy="60" r="46" fill="${a}" opacity=".3"/><circle cx="150" cy="60" r="30" fill="${a}"/>
    <g stroke="${a}" stroke-width="6" stroke-linecap="round"><path d="M150 -2 v-12"/><path d="M150 122 v12"/><path d="M88 60 h-12"/><path d="M212 60 h12"/><path d="M106 16 l-9 -9"/><path d="M194 16 l9 -9"/><path d="M106 104 l-9 9"/><path d="M194 104 l9 9"/></g>
    <rect x="62" y="96" width="76" height="132" rx="16" fill="#ffffff"/><rect x="62" y="96" width="76" height="132" rx="16" fill="${dark}" opacity=".08"/>
    <rect x="80" y="70" width="40" height="30" rx="7" fill="${a}"/><rect x="88" y="58" width="24" height="16" rx="4" fill="${dark}"/>
    <rect x="62" y="132" width="76" height="52" fill="${a}"/><text x="100" y="166" text-anchor="middle" font-family="Roboto,Arial" font-weight="900" font-size="20" fill="#fff">SPF</text><text x="100" y="212" text-anchor="middle" font-family="Roboto,Arial" font-weight="900" font-size="18" fill="${dark}">50+</text>
    <path d="M24 236 q76 24 152 0" stroke="${a}" stroke-width="5" fill="none" stroke-linecap="round"/></g>`;
}
/* kinds: land 640x360 | port 360x640 | web 800x250 | store 360x640 ; variant: first | last */
function art(kind, variant, bright = S.bright, opts = {}) {
  gid++;
  const d = D(), c = IS_RM ? ADV().color : C(), a = IS_RM ? ADV().accent : d.accent;
  const bg1 = bright ? mix(c, "#ffffff", .86) : c, bg2 = bright ? mix(c, "#ffffff", .7) : mix(c, "#000000", .35);
  const ink = bright ? mix(c, "#000000", .25) : "#ffffff", ink2 = bright ? mix(c,"#000000",.1) : mix("#ffffff", c, .12);
  const dark = mix(c, "#000000", .55);
  const W = {land:640, port:360, web:800, store:360, pos:480}[kind], H = {land:360, port:640, web:250, store:640, pos:360}[kind];
  const defs = `<defs><linearGradient id="g${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
    <linearGradient id="scr${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(c,"#ffffff",.35)}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs>`;
  const logo = (x,y,s) => `<g transform="translate(${x} ${y}) scale(${s})"><rect width="40" height="40" rx="10" fill="${bright?c:"#ffffff"}"/><text x="20" y="26.5" text-anchor="middle" font-family="Roboto,Arial" font-weight="900" font-size="15" fill="${bright?"#fff":c}">${esc(initials(AB()))}</text><text x="50" y="26" font-family="Roboto,Arial" font-weight="700" font-size="16" fill="${ink}">${esc(AB())}</text></g>`;
  const T = (x,y,size,txt,fill,w=900,anchor="start") => `<text x="${x}" y="${y}" font-family="Roboto,Arial" font-weight="${w}" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${esc(txt)}</text>`;
  const hl = d.headline.split(" "), mid = Math.ceil(hl.length/2), h1 = hl.slice(0,mid).join(" "), h2 = hl.slice(mid).join(" ");
  let body = "";
  const lineBand = (x, y, maxW, fs) => { if (!opts.line) return ""; const w = Math.min(maxW, 34 + opts.line.length * fs * .56); return `<rect x="${x}" y="${y}" width="${w}" height="${fs*2}" rx="${fs}" fill="${bright?"rgba(0,0,0,.08)":"rgba(255,255,255,.18)"}"/><circle cx="${x+fs}" cy="${y+fs}" r="${fs*.38}" fill="${bright?c:a}"/>` + T(x+fs*1.9, y+fs*1.36, fs, opts.line, ink, 600); };
  if (variant === "queue") {
    const lq = L().q, inkQ = bright ? mix(c,"#000000",.25) : "#ffffff";
    if (kind === "port") body = logo(26,30,.85) + qrSVG(84,110,8.4,mix(c,"#000000",.4)) + T(26,400,36,lq.head.split(" ").slice(0,2).join(" "),inkQ) + T(26,440,36,lq.head.split(" ").slice(2).join(" "),inkQ) + T(26,476,15,lq.sub,inkQ,500);
    else body = logo(32,28,.9) + T(32,160,44,lq.head,inkQ) + T(32,200,17,lq.sub,inkQ,500) + `<rect x="32" y="226" width="200" height="34" rx="17" fill="${a}"/>` + T(132,248,13,"SCAN THE CODE",S.ind==="telco"?"#0d1114":"#fff",700,"middle") + qrSVG(452,96,7.4,mix(c,"#000000",.4));
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(lq.head)}">${defs}<rect width="${W}" height="${H}" fill="url(#g${gid})"/>${body}</svg>`;
  }
  if (kind === "land") {
    if (variant === "first") body = logo(32,28,.9) + T(32,150,50,h1,ink) + T(32,204,50,h2,ink) + T(32,244,20,d.sub,ink2,500) + `<rect x="32" y="266" width="180" height="34" rx="17" fill="${a}"/>` + T(122,288,13,"FIND OUT IN STORE",S.ind==="telco"?"#0d1114":"#fff",700,"middle") + illo(380,60,1.05,a,dark) + lineBand(32,306,560,10) + T(32,348,9,d.legal,ink2,400);
    else body = `<circle cx="520" cy="60" r="140" fill="${a}" opacity=".18"/><circle cx="560" cy="330" r="90" fill="${a}" opacity=".22"/>` + logo(32,28,.9) + T(32,170,d.big.length > 6 ? 64 : 96,d.big,ink) + T(36,206,22,d.bigSub,bright?c:a,800) + T(36,244,18,d.sub,ink2,500) + illo(410,100,.82,a,dark) + T(32,342,9,d.legal,ink2,400);
  } else if (kind === "port") {
    body = logo(26,30,.85) + illo(60,90,1.05,a,dark) + T(26,410,40,h1,ink) + T(26,452,40,h2,ink) + T(26,488,16,d.sub,ink2,500) + `<rect x="26" y="514" width="170" height="34" rx="17" fill="${a}"/>` + T(111,536,12,"FIND OUT IN STORE",S.ind==="telco"?"#0d1114":"#fff",700,"middle") + lineBand(26,566,310,9) + T(26,615,7.5,d.legal,ink2,400);
  } else if (kind === "pos") {
    body = `<circle cx="400" cy="70" r="120" fill="${a}" opacity=".2"/>` + logo(24,22,.8) + T(24,112,d.big.length > 6 ? 40 : 62,d.big,ink) + T(26,142,15,d.bigSub,bright?c:a,800) + T(26,176,15,d.sub,ink2,500) + `<rect x="24" y="200" width="170" height="32" rx="16" fill="${a}"/>` + T(109,221,12,"ASK AT THE COUNTER","#fff",700,"middle") + illo(290,70,.7,a,dark) + T(24,340,8,d.legal,ink2,400);
  } else if (kind === "web") {
    body = logo(28,22,.8) + T(28,118,38,d.headline,ink) + T(28,152,17,d.sub,ink2,500) + `<rect x="28" y="172" width="150" height="32" rx="16" fill="${a}"/>` + T(103,193,12,"LEARN MORE",S.ind==="telco"?"#0d1114":"#fff",700,"middle") + illo(560,14,.82,a,dark) + T(28,236,8,d.legal,ink2,400);
  } else {
    body = `<rect width="360" height="56" fill="#fff"/>` + `<g transform="translate(16 10) scale(.9)"><rect width="40" height="40" rx="10" fill="${c}"/><text x="20" y="26.5" text-anchor="middle" font-family="Roboto,Arial" font-weight="900" font-size="15" fill="#fff">${esc(initials(AB()))}</text><text x="50" y="26" font-family="Roboto,Arial" font-weight="700" font-size="16" fill="#222">${esc(AB())}</text></g>`
      + `<rect y="56" width="360" height="330" fill="url(#g${gid})"/>` + illo(70,80,.95,a,dark) + T(22,420,26,d.headline,"#222") + T(22,448,14,d.sub,"#555",500)
      + `<rect x="22" y="470" width="316" height="44" rx="10" fill="${c}"/>` + T(180,498,14,"Talk to us in store",  "#fff",700,"middle")
      + `<rect x="22" y="528" width="316" height="44" rx="10" fill="#fff" stroke="#ddd"/>` + T(180,556,14,"Find my nearest store","#222",500,"middle") + T(22,610,8,d.legal,"#888",400);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(d.headline)}">${defs}<rect width="${W}" height="${H}" fill="#f6f7f8"/>${body}</svg>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(d.headline)}">${defs}<rect width="${W}" height="${H}" fill="url(#g${gid})"/>${body}</svg>`;
}
function thumbSVG(kind) {
  const c = IS_RM ? ADV().color : C(), a = IS_RM ? ADV().accent : D().accent, ic = {home:"router",data:"signal_cellular_alt",family:"group",watch:"watch",leaf:"eco",skin:"face",queue:"hourglass_top",plane:"flight",snow:"ac_unit",bolt:"bolt",coffee:"local_cafe",car:"local_gas_station"}[kind];
  return `<div style="width:100%;height:100%;background:linear-gradient(135deg,${mix(c,"#fff",.15)},${mix(c,"#000",.3)});display:flex;align-items:center;justify-content:space-between;padding:0 8px;color:#fff"><span style="font:900 9px Roboto;letter-spacing:.3px;line-height:1.1">${esc(initials(AB()))}</span><span class="ms" style="font-size:22px;color:${a}">${ic}</span></div>`;
}

/* ================= screens ================= */
const PLAY = `<span class="play" aria-hidden="true"><span class="ms">play_arrow</span></span>`;
const NAV1 = [["campaign","Campaigns"],["desktop_windows","Displays & Devices"],["store","Stores / Branches"],["monitoring","Insights / Analytics"]];
const NAV2 = [["settings","Company Settings"],["assignment","Platform Admin"]];
function shell(inner, crumbs, navOn = "Campaigns") {
  const nav = (arr, on) => arr.map(([i,l]) => `<div class="${l===on?"on":""}"><span class="ms">${i}</span>${l}</div>`).join("");
  return `<div class="app"><aside class="side"><div class="logo">${logoSVG(44)}<span class="wm">${esc(B())}</span></div>
    <div class="nav">${nav(IS_RM && S.flow === 1 ? NAV1.filter(n => n[1] === "Campaigns" || n[1] === "Insights / Analytics") : NAV1,navOn)}</div><div class="nav bottom">${nav(IS_RM && S.flow === 1 ? [] : NAV2,navOn)}</div></aside>
    <div class="mainc"><div class="hdr"><span class="ms" style="color:#666">menu</span><span class="ph"><svg width="30" height="30" viewBox="0 0 40 40" aria-hidden="true"><rect x="2" y="2" width="7" height="30" fill="#169BC2"/><rect x="9" y="2" width="29" height="7" fill="#EF60A7"/><rect x="31" y="9" width="7" height="29" fill="#FE9226"/><rect x="2" y="31" width="29" height="7" fill="#60D838"/></svg><span>Personalisation<b>Hub</b></span></span>
      ${IS_RM && S.flow === 1 ? `<span class="env"><span class="ms" style="font-size:15px">badge</span>Advertiser · ${esc(ADV().brand)}</span>` : `<span class="env"><span class="ms" style="font-size:15px">rocket_launch</span>Production<span class="ms" style="font-size:14px">edit</span></span>`}${logoSVG(34)}</div>
      <div class="content"><div class="scroller" id="sc"><div class="sci" id="sci"><div class="crumb">${crumbs}</div>${inner}</div></div></div></div><div id="layer"></div></div>`;
}
function listScreen(withNew) {
  const d = D();
  const rows = (withNew ? [["LOCALISED", d.name, d.audience.join(", "), (IS_RM ? ["tv"] : ["tv","language","storefront"]), true]] : []).concat(d.rows);
  const body = rows.map((r,i) => `<div class="gr ${r[4]?"new":""}"><div><span class="cb"></span></div><div><span class="sd"></span></div><div><span class="pill">${r[0]}</span></div>
    <div class="nm"><div class="thumb">${r[4] ? art("land","first") : thumbSVG(d.thumbs[(i-(withNew?1:0))%4])}</div><span>${esc(r[1])}</span></div>
    <div class="tps">${r[3].map(t=>`<span class="ms">${t}</span>`).join("")}</div><div class="muted" style="font-size:13px">${esc(r[2])}</div><div class="muted">⋯</div></div>`).join("");
  return shell(`<div class="title">Campaigns</div><div class="hr"></div>
    <div class="row" style="margin-bottom:12px"><div><b>${IS_RM ? rows.length : rows.length + 22}</b> Campaigns</div><div class="row"><span class="txtbtn">Campaign Prioritisation</span><span class="aibtn" id="launch"><span class="ms">auto_awesome</span><span>Launch a New Campaign</span></span></div></div>
    <div class="grid"><div class="gh"><div><span class="cb"></span></div><div>Status</div><div>Playback Strategy</div><div>Name</div><div>Touch-points</div><div>Target Audience</div><div></div></div>${body}</div>
    <div class="pager"><span>‹</span><span class="pg">1</span><span>›</span><span class="muted">50 / page</span></div>`,
    `Home &gt; <b>Campaigns</b>`);
}
const CHECKS = ["Campaign Name","Campaign Detail","Promoted Product","Campaign Objective","Touch Points","Target Audience"];
function modalHTML(text, states, ready) {
  const ck = CHECKS.map((c,i)=>`<div class="ck ${states[i]||""}" id="ck${i}"><span class="ms">${states[i]==="load"?"progress_activity":"check"}</span>${c}</div>`).join("");
  return `<div class="mask"><div class="modal"><h3>Launch a New Campaign<span class="ms muted">close</span></h3>
    <div class="info"><span class="ms" style="color:#999;font-size:18px">edit</span>If you'd prefer to Manually Add the Campaign&nbsp;<u>click here</u></div>
    <div class="lbl"><i>*</i>Talk to me about your campaign?</div>
    <div class="ta ${text!==null?"focus":""}" id="ta"><span id="tabody">${text===null?`<span class="ph">Describe your campaign in as much detail as possible</span>`:esc(text)}</span><span class="mic" id="mic"><span class="ms">mic</span></span></div>
    <div class="vrow" id="vrow" style="visibility:hidden"><span class="wave"><i></i><i></i><i></i><i></i><i></i></span><span id="vtxt">Listening…</span></div>
    <div class="lbl" style="font-weight:700;margin-top:6px">The following Campaign Details have been captured: <span class="ms muted" style="font-size:16px">info</span></div>
    <div class="checks" id="checks">${ck}</div>
    <div class="foot"><span class="btn">Cancel</span><span class="aibtn ${ready?"":"off"}" id="addnew"><span class="ms">auto_awesome</span><span>Add New Campaign</span></span></div></div></div>`;
}
function writingHTML() {
  return `<div class="mask"><div class="modal"><h3>Launch a New Campaign<span class="ms muted">close</span></h3>
    <div class="writing"><div class="orb"><span class="ms">auto_awesome</span></div><b style="font-size:16px">Writing your campaign brief…</b><span class="muted">From what you said and how past campaigns performed</span></div></div></div>`;
}
const CTA = { story: "Generate Storyboard &amp; Copy", preview: "Generate Creative Preview", assets: "Generate Creative Assets" };
const ctaHTML = k => `<span class="aibtn" id="cta"><span class="ms">auto_awesome</span><span>${CTA[k]}</span></span>`;
const KP = [["play_arrow","#f3f0ff","#7c5cff","Total plays",1204,v=>v.toLocaleString("en")],["schedule","#ecfdf5","#22a06b","Total playback time",161,v=>`${Math.floor(v/60)}h ${Math.round(v%60)}m`],["visibility","#fef2f2","#e5484d","Total views",318,v=>String(Math.round(v))],["timer","#fff8e1","#d59b00","Avg view duration",3.2,v=>v.toFixed(1)+"s"]];
function insightsHTML(full) {
  return `<div class="insin" id="insb"><div style="font-weight:600;margin-top:14px">Campaign Insights</div>
    <div class="kpis">${KP.map((k,i)=>`<div class="kpi"><div class="ic" style="background:${k[1]};color:${k[2]}"><span class="ms">${k[0]}</span></div><div><small>${k[3]}</small><b id="kv${i}">${k[5](full ? k[4] : 0)}</b></div></div>`).join("")}</div>
    <div class="eng"><small>Engagement score</small><span class="trk"><i id="engb" style="width:${full?26:0}%"></i></span><b id="engv">${full?26:0}%</b></div></div>`;
}
async function countUp(id) {
  q("#engb").style.width = "26%"; const n = reduce ? 1 : 30;
  for (let f = 1; f <= n; f++) { const t = 1 - Math.pow(1 - f/n, 3); KP.forEach((k,i) => { q("#kv"+i).textContent = k[5](k[4]*t); }); q("#engv").textContent = Math.round(26*t) + "%"; await wait(40, id); }
}
function setCta(k) { const c = q("#cta"); if (c) c.outerHTML = ctaHTML(k); }
function rmStatusHTML() { return `<span class="muted">Status</span><span class="sd" style="background:${S.rmSent ? "#faad14" : "#bfbfbf"}"></span><b id="stt">${S.rmSent ? "Awaiting approval" : "Draft"}</b><span class="sfa ${S.rmSent ? "sent" : ""}" id="sfa"><span class="ms">${S.rmSent ? "hourglass_top" : "send"}</span>${S.rmSent ? "Sent for approval" : "Send for approval"}</span>`; }
function detailTop(tab, on, cta) {
  const d = D();
  const tabs = ["Campaign Brief","Targeting","Scheduling","Storyboard & Copy","Creative"].map(t=>`<div class="t ${t===tab?"on":""}" data-tab="${t}">${t}</div>`).join("");
  const kp = [["play_arrow","#f3f0ff","#7c5cff","Total plays",on?"1,204":"0"],["schedule","#ecfdf5","#22a06b","Total playback time",on?"2h 41m":"0h 0m"],["visibility","#fef2f2","#e5484d","Total views",on?"318":"0"],["timer","#fff8e1","#d59b00","Avg view duration",on?"3.2s":"0.0s"]];
  return `<div class="row"><div class="title" id="ctitle" style="max-width:640px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}</div>
    <div class="status">${IS_RM && S.flow === 1 && !S.rmApproved ? rmStatusHTML() : `<span class="muted">Status</span><span class="sd" style="background:${on?"#52c41a":"#ff4d4f"}"></span><b id="stt">${on?"Activated - Running":"Not Activated"}</b><span class="sw ${on?"on":""}" id="sw"></span>`}</div></div>
    <div id="insw">${on ? insightsHTML(true) : ""}</div>
    <div class="tabs">${tabs}${cta ? ctaHTML(cta) : ""}</div>`;
}
const crumbD = () => `Home &gt; Campaigns &gt; <b>${esc(D().name)}</b>`;
function briefScreen(filled, on, cta = "story") {
  const d = D(), F = (k, html, cls="") => `<div class="f ${filled>k?"":"pend"}" id="f${k}">${html}</div>`;
  const v = (k, html) => filled > k ? html : "";
  const tps = (IS_CONV || IS_RM) ? [["directions_car","Forecourt screens",true],["storefront","Shop front screens",true],["kitchen","Cooler door screens",true],["point_of_sale","POS screens",true]] : [["language","Website",true],["storefront","Store Sites",true],["tv","Digital Signage",true],["qr_code_2","QR-Control",false],["tablet","Staff Tablet",false],["smart_toy","AI Agents",false]];
  return shell(detailTop("Campaign Brief", on, cta) + `<div class="form" id="form">
    ${IS_RM ? `<div class="f" id="f5"><label><i>*</i>Deal ID</label><div class="in dsel"><span>${esc(RMI().deal)}</span><span class="ms">expand_more</span></div></div>` : ""}${F(0,`<label><i>*</i>Campaign Name</label><div class="in ${filled===1?"fill":""}">${v(0,esc(d.name))}&nbsp;</div>`)}
    ${F(1,`<label>Campaign Details</label><div class="in ${filled===2?"fill":""}" style="min-height:80px">${v(1,esc(d.details))}</div>`)}
    ${F(2,`<label>Promoted Product(s)</label><div class="in tags ${filled===3?"fill":""}">${v(2,d.products.map(p=>`<span class="tag">${esc(p)} ×</span>`).join(""))}&nbsp;</div>`)}
    ${F(3,`<label>Target Audience(s)</label><div class="in tags ${filled===4?"fill":""}">${v(3,d.audience.map(p=>`<span class="tag">${esc(p)} ×</span>`).join(""))}&nbsp;</div>`)}
    ${F(4,`<label>Campaign Objective</label><div class="in ${filled===5?"fill":""}">${v(4,esc(d.objective))}&nbsp;</div>`)}
    <div class="sec">Enabled touch-point(s)</div>
    <div id="tps">${tps.map(t=>{const live = t[2] && filled>5; return `<div class="tp"><span class="ico ${live?"":"offc"}"><span class="ms" style="font-size:18px">${t[0]}</span><i></i></span>${t[1]}<span class="sw ${live?"on":""}"></span></div>${live&&t[3]?`<div class="pl"><div class="in tags fill">${t[3].split("|").map(x=>`<span class="tag">${x} ×</span>`).join("")}</div></div>`:""}`;}).join("")}</div>
    <div class="row" style="justify-content:flex-start;gap:8px;margin-top:8px"><span class="btn dis">Update Campaign Brief</span><span class="btn dis">Cancel</span></div></div>`, crumbD());
}
function frameBox(id, state, bright) {
  const inner = state === "gen" ? `<div class="shim"><span class="ms">auto_awesome</span>Generating…</div>` : state === "none" ? `<div class="shim" style="animation:none"><span class="ms">image</span></div>` : `<div class="art">${art("land", state, !!bright)}</div>`;
  return `<div class="frame" id="${id}">${inner}</div>`;
}
function storyScreen(o) {
  const d = D(), cp = o.copy || 0;
  const card = (k, title, label, val) => `<div class="card"><div class="ch"><span class="ms" style="font-size:16px">expand_more</span>${title}</div><div class="cbd"><small>${label}</small><div class="in ${cp===k+1?"fill":""}" id="cp${k}">${cp>k?esc(val):"&nbsp;"}</div></div></div>`;
  return shell(detailTop("Storyboard & Copy", !!o.on, o.cta === undefined ? "preview" : o.cta) + `<div class="two">
    <div><div class="row" style="justify-content:flex-start;gap:10px"><span><i style="color:#ff4d4f;font-style:normal">*</i> Campaign Type</span><span class="segc"><span><span class="ms" style="font-size:16px">image</span>Image</span><span class="on"><span class="ms" style="font-size:16px">videocam</span>Video</span></span></div>
      ${card(0,"Headline","Default Headline",d.headline)}${card(1,"Sub headline","Default Sub Headline",d.sub)}${card(2,"Legal copy (Ts&amp;Cs)","Legal Copy",d.legal)}${o.body !== undefined ? `<div class="card" id="bodycard"><div class="ch"><span class="ms" style="font-size:16px">expand_more</span>Body copy</div><div class="cbd"><div class="row" style="margin-bottom:6px"><small style="margin:0">Default Body Copy</small><span class="addtok" id="addtok"><span class="ms" style="font-size:16px">add</span>Add token</span></div><div class="in" id="bodyin">${o.body === "token" ? `<span class="tok">\${LocalisedCopy}</span>` : "&nbsp;"}</div></div></div>` : ""}</div>
    <div><span class="segc light"><span class="on">Landscape</span><span>Portrait</span></span>
      <div class="scene"><h4>Scene 1</h4><div class="muted" style="font-size:13px;margin-bottom:6px">First Frame</div>${frameBox("fr1", o.f1, o.b1)}
        <div class="fa" id="fa1"><span class="req" id="reqbtn"><span class="ms" style="font-size:16px">auto_awesome</span>Request changes</span><span class="btn" style="height:28px">Regenerate</span></div>
        <div class="muted" style="font-size:13px;margin:10px 0 6px">Last Frame</div>${frameBox("fr2", o.f2, false)}</div></div></div>`, crumbD());
}
function creativeScreen(n, on, cta = null, tab2) {
  const P = (k, title, kind, ratio) => `<div class="ap" id="ap${k}"><div class="ch">${title}<span class="ms" style="font-size:16px">expand_more</span></div><div class="cbd"><div class="asset" style="aspect-ratio:${ratio}">${n>k?`<div class="art">${art(kind,"first")}</div>${PLAY}`:`<div class="shim"><span class="ms">auto_awesome</span>Rendering…</div>`}</div></div><div class="af"><span class="muted">Priority 1</span><span class="btn pri">Upload new Campaign Asset</span></div></div>`;
  if (tab2 === "local") return shell(detailTop("Creative", on, cta) + `<div class="ctabs"><span>Campaign Assets</span><span>Call to Action</span><span class="on" id="lptab">Localised Preview</span></div>${localPreviewHTML()}`, crumbD());
  return shell(detailTop("Creative", on, cta) + `<div class="ctabs"><span class="on">Campaign Assets</span><span>Call to Action</span>${tab2 ? `<span id="lptab">Localised Preview</span>` : ""}</div>
    <div class="muted" style="margin-top:12px">Campaign assets for each enabled touch-point</div>
    <div class="assets">${(IS_CONV || IS_RM) ? `<div style="display:flex;flex-direction:column;gap:16px">${P(0,"Forecourt screens (landscape)","land","16/9")}${P(2,"Cooler door screens (wide)","web","800/250")}</div>
    <div style="display:flex;flex-direction:column;gap:16px">${P(1,"Shop front screens (portrait)","port","9/16")}${P(3,"POS screens","pos","4/3")}</div>` : `<div style="display:flex;flex-direction:column;gap:16px">${P(0,"Digital signage (landscape)","land","16/9")}${P(2,"Website","web","800/250")}</div>
    ${P(1,"Signage (portrait)","port","9/16")}${P(3,"Store sites","store","9/16")}`}</div>`, crumbD());
}

/* ================= stage + fx ================= */
const box = document.getElementById("box"), stage = document.getElementById("stage");
stage.innerHTML = `<div id="screen"></div><div id="ring"></div><div id="tip"></div><div id="cursor"><svg viewBox="0 0 26 26"><path d="M4 2 L4 21 L9 16.5 L12.5 24 L16 22.5 L12.6 15.2 L19 15 Z" fill="#fff" stroke="#14202b" stroke-width="1.6" stroke-linejoin="round"/></svg></div><div id="card" hidden></div>`;
const screen = stage.querySelector("#screen"), ring = stage.querySelector("#ring"), tipEl = stage.querySelector("#tip"), cur = stage.querySelector("#cursor"), card = stage.querySelector("#card");
let lastW = 0;
function fit() { const w = box.clientWidth; if (!w || Math.abs(w - lastW) < 2) return; lastW = w; S.scale = w / 1280; stage.style.transform = `scale(${S.scale})`; }
function stageW() { const w = box.getBoundingClientRect().width; if (w) document.documentElement.style.setProperty("--stage-w", Math.round(w * 100) / 100 + "px"); }
new ResizeObserver(() => { fit(); stageW(); }).observe(box); fit(); stageW();
const q = s => stage.querySelector(s);
let curPos = { x: 900, y: 600 };
function setCur(x, y, ms) { cur.style.transitionDuration = (ms||0) + "ms"; cur.style.transform = `translate(${x-4}px,${y-2}px)`; curPos = {x,y}; }
setCur(900, 600, 0);
function rel(el) { const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect(); return { x:(r.left-s.left)/S.scale, y:(r.top-s.top)/S.scale, w:r.width/S.scale, h:r.height/S.scale }; }

/* run control */
class Cancel extends Error {}
let RUN = 0;
const chk = id => { if (id !== RUN) throw new Cancel(); };
async function wait(ms, id) { const k = reduce ? .35 : 1; let t = 0; while (t < ms * k) { await new Promise(r => setTimeout(r, 40)); chk(id); if (!S.paused && !S.voHold) t += 40; } }
async function moveTo(el, id, dx=.5, dy=.5) {
  await reveal(el, id);
  const r = rel(el), x = r.x + r.w*dx, y = r.y + r.h*dy, dist = Math.hypot(x-curPos.x, y-curPos.y), ms = reduce ? 0 : Math.min(950, 320 + dist*.7);
  setCur(x, y, ms); await wait(ms + 60, id);
}
async function click(el, id) {
  await moveTo(el, id);
  const rp = document.createElement("div"); rp.className = "ripple"; rp.style.left = curPos.x + "px"; rp.style.top = curPos.y + "px"; stage.appendChild(rp); setTimeout(() => rp.remove(), 700);
  cur.classList.add("press"); await wait(140, id); cur.classList.remove("press"); await wait(120, id);
}
let TOP = 0;
function maxTop() { const sc = q("#sc"), sci = q("#sci"); return sc && sci ? Math.max(0, sci.offsetHeight - sc.clientHeight) : 0; }
function setTop(t, ms) { const sci = q("#sci"); if (!sci) return; TOP = Math.round(Math.max(0, Math.min(maxTop(), t))); sci.style.transition = ms ? `transform ${ms}ms cubic-bezier(.45,0,.25,1)` : "none"; sci.style.transform = `translate3d(0,${-TOP}px,0)`; }
async function reveal(el, id) {
  const sc = q("#sc"); if (!sc || !sc.contains(el)) return;
  const r = el.getBoundingClientRect(), s = sc.getBoundingClientRect(), top = (r.top - s.top)/S.scale, h = r.height/S.scale, view = sc.clientHeight;
  if (top >= 10 && top + h <= view - 20) return;
  await scrollTo(TOP + top - Math.max(20, (view - h)/2), id);
}
async function scrollTo(target, id) {
  hideTip(); const dur = reduce ? 0 : 650; const from = TOP; setTop(target, dur); if (TOP !== from) await wait(dur + 40, id);
}
function tip(el, title, text, n) { if (S.voCue) S.voCue(title);
  const r = rel(el); ring.style.left = (r.x-6)+"px"; ring.style.top = (r.y-6)+"px"; ring.style.width = (r.w+12)+"px"; ring.style.height = (r.h+12)+"px"; ring.classList.add("on");
  tipEl.innerHTML = `<small>Step ${S.step+1} of ${ST().length}</small><b>${esc(title)}</b>${esc(text)}`;
  const tw = 300, th = tipEl.offsetHeight || 110; let x = Math.min(Math.max(16, r.x + r.w/2 - 40), 1280 - tw - 16), below = r.y + r.h + th + 24 < 750;
  let y = below ? r.y + r.h + 16 : r.y - th - 16; if (!below && y < 70) { y = Math.min(r.y + 20, 640); }
  tipEl.className = below ? "below on" : "above on"; tipEl.style.left = x+"px"; tipEl.style.top = y+"px";
  tipEl.style.setProperty("--ax", Math.min(tw-24, Math.max(12, r.x + r.w/2 - x - 6)) + "px");
  tipEl.style.display = S.scale < .55 ? "none" : "";
}
function hideTip() { ring.classList.remove("on"); tipEl.classList.remove("on"); }
async function typeInto(el, text, id, cps=55, onProgress) {
  el.innerHTML = `<span class="tx"></span><span class="caret typing"></span>` + (el.dataset.tail||"");
  const tx = el.querySelector(".tx"), caret = el.querySelector(".caret"), step = reduce ? text.length : 2;
  for (let i = 0; i <= text.length; i += step) { tx.textContent = text.slice(0,i); onProgress && onProgress(i/text.length); await wait(step*1000/cps, id); }
  tx.textContent = text; caret.classList.remove("typing"); onProgress && onProgress(1);
}
let resetScroll = true;
/* Rule steps after the first: repaint (at the top, instantly) then jump straight to the rules so the newest existing rule sits where focusRow left it at the end of the previous step (20% down), with the add button below it and Campaign Insights scrolled clear above. Same task, so no frame at the top is ever painted. */
const paintRules = html => { paint(html); const sc = q("#sc"), gs = document.querySelectorAll("#rules .rgroup"), l = gs[gs.length-1]; if (!sc || !l) return; const o = sc.getBoundingClientRect().top, iw = q("#insw"); setTop(Math.max(TOP + (l.getBoundingClientRect().top - o)/S.scale - sc.clientHeight*0.2, iw ? TOP + (iw.getBoundingClientRect().bottom - o)/S.scale + 8 : 0), 0); };
const paint = html => { const top = resetScroll ? 0 : TOP; resetScroll = false; screen.innerHTML = html; setTop(top, 0); hideTip(); };
async function dictate(el, text, id, onProgress) {
  el.innerHTML = `<span class="tx"></span><span class="interim"></span>`;
  const tx = el.querySelector(".tx"), im = el.querySelector(".interim"), words = text.split(" "), chunks = [3,2,4,3,2,3,4,2];
  let done = 0, c = 0;
  while (done < words.length) {
    const n = Math.min(chunks[c++ % chunks.length], words.length - done), part = words.slice(done, done + n);
    for (let k = 1; k <= n; k++) { im.textContent = (done ? " " : "") + part.slice(0, k).join(" "); await wait(reduce ? 10 : 110, id); }
    await wait(reduce ? 10 : 260, id);
    done += n; tx.textContent = words.slice(0, done).join(" "); im.textContent = ""; onProgress && onProgress(done / words.length);
  }
}
async function busy(btn, label, id, ms) { btn.classList.add("busy"); btn.querySelector(".ms").textContent = "progress_activity"; btn.lastElementChild.textContent = label; await wait(ms, id); }
function fillBrief(k) {
  const d = D(), el = q("#f"+k+" .in"); if (!el) return;
  const val = [esc(d.name)+"&nbsp;", esc(d.details), d.products.map(p=>`<span class="tag">${esc(p)} ×</span>`).join("")+"&nbsp;", d.audience.map(p=>`<span class="tag">${esc(p)} ×</span>`).join("")+"&nbsp;", esc(d.objective)+"&nbsp;"][k];
  el.innerHTML = val; el.classList.remove("fill"); void el.offsetWidth; el.classList.add("fill");
}
function setCopy(k) { const d = D(), el = q("#cp"+k); el.textContent = [d.headline, d.sub, d.legal][k]; el.classList.add("fill"); }
function goLive() {
  q("#sw").classList.add("on"); q("#stt").textContent = "Activated - Running"; q("#stt").previousElementSibling.style.background = "#52c41a";
  q("#insw").innerHTML = insightsHTML(false);
}
const SHIM = t => `<div class="shim"><span class="ms">auto_awesome</span>${t}</div>`;
function setFrame(id, state, bright, opts) { q("#"+id).innerHTML = state === "gen" ? SHIM("Generating…") : `<div class="art">${art("land", state, !!bright, opts || {})}</div>`; }
function setAsset(k, kind) { q("#ap"+k+" .asset").innerHTML = `<div class="art">${art(kind, "first")}</div>${PLAY}`; }
const popHTML = () => `<div class="pop" id="pop"><div style="font-size:13px;margin-bottom:6px">What changes would you like me to make?</div><div class="in focus" id="popin"><span class="caret"></span></div><div class="row" style="justify-content:flex-end;gap:8px;margin-top:8px"><span class="btn" style="height:28px">Cancel</span><span class="req" id="popgo">Request changes</span></div></div>`;

/* ================= steps ================= */
const STEPS = [
 { t:"Start a new campaign", s:"Every campaign starts in Campaigns. Open the AI campaign agent with Launch a New Campaign.",
   enter(){ paint(listScreen(false)); },
   async play(id){ await wait(500,id); const b=q("#launch"); await moveTo(b,id); tip(b,this.t,this.s,1); await wait(2600,id); hideTip(); await click(b,id); } },
 { t:"Just talk", s:"Tap the mic and describe the campaign out loud. The agent captures name, product, objective, touchpoints and audience as you speak.",
   enter(){ paint(listScreen(false)); q("#layer").innerHTML = modalHTML(null, [], false); },
   async play(id){
     const mic=q("#mic"); await moveTo(mic,id); tip(mic,this.t,"Tap the mic to talk to the campaign agent.",2); await wait(1800,id); hideTip(); await click(mic,id);
     mic.classList.add("rec"); mic.firstChild.textContent="stop"; q("#ta").classList.add("focus"); q("#vrow").style.visibility="visible";
     setCur(curPos.x+60, curPos.y+70, reduce?0:500);
     const marks=[.12,.3,.45,.62,.78,.93], st=[]; let shown=false;
     const ro = new ResizeObserver(() => { if (shown) tip(q("#checks"), this.t, this.s, 2); }); ro.observe(q("#ta"));
     try { await dictate(q("#tabody"), D().brief, id, p => {
       marks.forEach((m,i)=>{ const want = p>=m ? "ok" : p>=m-.12 ? "load" : ""; if (st[i]!==want){ st[i]=want; const el=q("#ck"+i); el.className="ck "+want; el.firstChild.textContent = want==="load"?"progress_activity":"check"; } });
       if (!shown && p>.3){ shown=true; tip(q("#checks"), this.t, this.s, 2); }
     }); } finally { ro.disconnect(); }
     await wait(900,id); hideTip(); await click(mic,id); mic.classList.remove("rec"); mic.firstChild.textContent="mic"; q("#vrow").style.visibility="hidden";
     q("#addnew").classList.remove("off"); await wait(800,id); } },
 { t:"The agent writes the brief", s:"Add New Campaign writes the brief from what was said and from historic campaign performance, then opens it with the touchpoints set as they are today.",
   enter(){ paint(listScreen(false)); q("#layer").innerHTML = modalHTML(D().brief, CHECKS.map(()=>"ok"), true); },
   async play(id){ const b=q("#addnew"); await moveTo(b,id); tip(b,this.t,"Add New Campaign hands the conversation to the agent to write the brief.",3); await wait(2200,id); hideTip(); await click(b,id);
     q("#layer").innerHTML = writingHTML(); await wait(1800,id);
     paint(briefScreen(0,false)); await wait(500,id);
     for (let k=0;k<5;k++){ fillBrief(k); await wait(420,id); }
     const tmp=document.createElement("div"); tmp.innerHTML=briefScreen(6,false); q("#tps").innerHTML = tmp.querySelector("#tps").innerHTML; await wait(300,id);
     if (IS_RM) { tip(q("#f5"),"Deal ID, pre-selected","Frostline's deal with the retailer is pre-selected, and the drop-down lists only Frostline's own deals. Every campaign created on it is automatically associated with the slots assigned to that deal: slot 1 on Forecourt, Shop Front, Cooler Doors and POS.",3); await wait(5200,id); hideTip(); } tip(q("#f1"),"Campaign brief","Written from what was said and from how past campaigns performed: name, details, products, audience and objective.",3); await wait(3000,id); hideTip();
     const t=q("#tps"); await reveal(t,id); tip(t,"Touchpoints",IS_RM ? "Only the deal's screen types, from the slots assigned to the deal: forecourt, shop front, cooler door and POS screens." : IS_CONV ? "Forecourt, shop front, cooler door and POS screens switched on from the brief." : "Digital signage, website and store sites switched on from the brief.",3); await wait(2800,id); hideTip(); } },
 { t:"Generate storyboard and copy", s: IS_RM ? "Happy with the brief? The AI agent writes the headline, sub-headline and legal copy from the brief and the agreed brand guidelines: Frostline's, the retailer's, or an agreed variation of the two." : "Happy with the brief? Generate Storyboard & Copy writes the headline, sub-headline and legal copy from the brief and your brand guidelines.",
   enter(){ paint(briefScreen(6,false)); },
   async play(id){ const c=q("#cta"); await moveTo(c,id); tip(c,this.t,this.s,4); await wait(2800,id); hideTip(); await click(c,id); await busy(c,"Generating…",id,1300);
     const tb=q('[data-tab="Storyboard & Copy"]'); paint(storyScreen({copy:0,f1:"none",f2:"none"})); await wait(400,id);
     for (let k=0;k<3;k++){ setCopy(k); await wait(550,id); }
     tip(q("#cp0").closest(".card"),"Storyboard and copy","Copy is ready to edit before any creative is made.",4); await wait(2600,id); hideTip(); } },
 { t:"Generate creative preview", s:"Copy agreed? Generate Creative Preview creates the first and last frames of the scene. Not quite right? Ask for a change in plain English.",
   enter(){ S.bright=false; paint(storyScreen({copy:3,f1:"none",f2:"none",cta:"preview"})); },
   async play(id){ const c=q("#cta"); await moveTo(c,id); tip(c,this.t,"Copy agreed? Generate Creative Preview creates the first and last frames of the scene.",5); await wait(2800,id); hideTip(); await click(c,id); await busy(c,"Generating…",id,700);
     await reveal(q(".scene"),id); setFrame("fr1","gen"); setFrame("fr2","gen"); tip(q("#fr1"),"Generating the preview",IS_RM ? "The AI agent builds the frames from the agreed brand guidelines, whether the advertiser's, the retailer's or an agreed variation of the two, optimised on what has performed best in past campaigns." : "First and last frames are built from the storyboard, optimised on what has performed best in past campaigns.",5); await wait(1800,id);
     setFrame("fr1","first"); await wait(900,id); setFrame("fr2","last"); await wait(1400,id);
     const rb=q("#reqbtn"); await moveTo(rb,id); tip(rb,"Refine in plain English","Not quite right? Ask for a change and the frame is regenerated.",5); await wait(2400,id); hideTip(); await click(rb,id);
     q("#fa1").insertAdjacentHTML("afterend", popHTML()); await typeInto(q("#popin"), D().change, id, reduce?999:48);
     await click(q("#popgo"),id); q("#pop").remove(); setFrame("fr1","gen"); await wait(1500,id);
     setFrame("fr1","first",true); setCta("assets"); tip(q("#fr1"),"Updated","The frame is regenerated with the change applied.",5); await wait(2400,id); hideTip(); } },
 { t:"Generate creative assets", s:"Storyboard refined? Generate Creative Assets builds the final scene for every touchpoint.",
   enter(){ S.bright=true; paint(storyScreen({copy:3,f1:"first",f2:"last",b1:true,cta:"assets"})); setTop(maxTop(),0); },
   async play(id){ const c=q("#cta"); await moveTo(c,id); tip(c,this.t,this.s,6); await wait(2800,id); hideTip(); await click(c,id); await busy(c,"Generating…",id,1300);
     paint(creativeScreen(0,false)); await wait(600,id); for (const [k,kind] of [[0,"land"],[1,"port"],[2,"web"],[3,(IS_CONV || IS_RM) ? "pos" : "store"]]) { setAsset(k,kind); await wait(560,id); }
     tip(q("#ap0"),"Assets for every touchpoint",IS_RM ? "Creative for each screen type: forecourt, shop front, cooler doors and POS. Results from the approved, running campaign feed the agent's future campaigns in a closed loop." : IS_CONV ? "Creative for each screen type: forecourt, shop front, cooler doors and POS. The generate button is gone once the assets exist." : "Landscape and portrait screens, the website and store sites. The generate button is gone once the assets exist.",6); await wait(3200,id); hideTip(); } },
 { t:"Activate the campaign", s:"Switch on the toggle at the top right and the campaign starts playing in every store.",
   enter(){ S.bright=true; paint(creativeScreen(4,false)); },
   async play(id){ const sw=q("#sw"); await moveTo(sw,id); tip(sw,this.t,this.s,7); await wait(2600,id); hideTip(); await click(sw,id);
     goLive(); q("#layer").innerHTML = `<div class="toast"><span class="ms">check_circle</span>Campaign activated in ${D().stores} stores</div>`; await wait(1800,id); q("#layer").innerHTML = ""; } },
 { t:"Insights once it's live", s:"Campaign Insights appear only after the campaign goes live: plays and playback time from playback data, views and view duration from computer vision at each screen.",
   enter(){ S.bright=true; paint(creativeScreen(4,false)); goLive(); },
   async play(id){ await setTop(0,0); const b=q("#insb"); tip(b,this.t,this.s,8); await countUp(id); await wait(3400,id); hideTip();
     const e=q(".eng"); tip(e,"Closed-loop optimisation","Engagement is stored and every variable analysed, so campaigns keep being optimised, and the next brief and creative start from what worked.",8); await wait(3800,id); hideTip(); showEnd(); } }
];

/* ================= flow 2: localisation, store management, digital twin ================= */
const LOC = {
  telco: {
    prefix: "NM", total: 24, category: "Cell phone store",
    existing: [["NM-001","City Centre","Central",3,"High street"],["NM-002","Central Station","Central",2,"Transport hub"]],
    results: [["Northgate Mall","Shop 112, Northgate Mall, 1 Northgate Drive","Open · Closes 9 pm","4.6","North","Shopping centre"],["Airport Terminal 2","Departures level, Terminal 2","Open 24 hours","4.2","Airport","Transport hub"],["Riverside","18 River Road","Open · Closes 6 pm","4.4","West","High street"],["Harbour Point","Unit 4, Harbour Point Shopping Centre","Open · Closes 9 pm","4.5","East","Shopping centre"],["Eastgate Plaza","Eastgate Plaza, 200 East Street","Open · Closes 7 pm","4.3","East","Shopping centre"],["University Quarter","3 College Lane","Open · Closes 6 pm","4.1","South","High street"]],
    focus: { name: "Northgate Mall", code: "NM-011", addr: "Shop 112, Northgate Mall, 1 Northgate Drive", suburb: "Northgate", post: "4101", local: "Find us opposite the food court, Level 1", phone: "(07) 3265 4400", web: "nimbusmobile.com/stores/northgate-mall", fixed: ["Metro"], variable: [] },
    segs: { fixed: ["Metro","Regional","Airport"], variable: ["iPhone out of stock"] },
    rule1: ["Store / Location Data","Fixed Store Segments","includes selected",["Metro","Airport"]],
    rule3: ["Store / Location Data","Variable Store Segments","excludes selected [OR]",["iPhone out of stock"]],
    rule2: ["Queueing / Aggregate Visitor Data","Visitor Device Type (Aggregate)","greater than","30","iPhone"], subMode: "text", subLabel: "carrying an iPhone",
    sched: { name: "December trade-in", start: "01 Dec 2026", end: "31 Dec 2026", range: "1 to 31 December" },
    q: { head: "SKIP THE QUEUE", sub: "Scan to book a time with an expert", name: "Skip the Queue | Scan to book" },
    twin: { weather: "24°C · Sunny", wIcon: "sunny", inStore: 23, wait: [2,7], max: 6, close: "9:00 pm", active: ["Shopping centre","Hot Day"],
      zones: [["Phone wall",20,20,250,130],["Accessories",290,20,250,130],["Entrance",20,170,250,124],["Service counter",290,170,250,124]], qd: [312,272],
      displays: [["Window display","land",27,74],["Counter display","port",89,60]] },
    previews: [["Northgate Mall","Find us opposite the food court, Level 1","play"],["Central Station","Right by the main concourse exit","play"],["Airport Terminal 2","Departures level, next to Gate 12","busy"]]
  },
  pharmacy: {
    prefix: "HP", total: 38, category: "Pharmacy",
    existing: [["HP-001","Harbour Street","Central",2,"High street"],["HP-002","Hillcrest Medical Centre","North",2,"Medical centre"]],
    results: [["Bayview","48 Bay Road","Open · Closes 9 pm","4.7","East","Medical centre"],["Seaside Village","2 Esplanade","Open · Closes 6 pm","4.5","East","High street"],["Parkside Plaza","Shop 9, Parkside Plaza","Open · Closes 9 pm","4.4","West","Shopping centre"],["Old Town","71 Main Street","Open · Closes 7 pm","4.6","Central","High street"],["Lakeside","Lakeside Medical Hub, 5 Lake Drive","Open · Closes 8 pm","4.3","South","Medical centre"],["Station Square","Station Square, Platform Level","Open · Closes 10 pm","4.2","Central","Transport hub"]],
    focus: { name: "Bayview", code: "HP-011", addr: "48 Bay Road", suburb: "Bayview", post: "4102", local: "Sun care bay by the entrance · Open until 9pm tonight", phone: "(07) 3396 2200", web: "harboursidepharmacy.com/bayview", fixed: ["Coastal"], variable: [] },
    segs: { fixed: ["Coastal","Metro","Regional"], variable: ["Sunscreen out of stock","After-sun out of stock"] },
    rule1: ["Store / Location Data","Fixed Store Segments","includes selected",["Coastal","Metro"]],
    rule3: ["Store / Location Data","Variable Store Segments","excludes selected [OR]",["Sunscreen out of stock","After-sun out of stock"]],
    rule2: ["Queueing / Aggregate Visitor Data","Reason for Visit (Aggregate)","greater than","30","Skin & sun advice"], subMode: "select", subOpts: ["Prescription collection","Skin & sun advice","Travel health advice","Other"], subLabel: "waiting for Skin & sun advice",
    sched: { name: "Summer sun care", start: "01 Dec 2026", end: "28 Feb 2027", range: "1 December to 28 February" },
    q: { head: "HOLD YOUR PLACE", sub: "Scan to join the queue and shop while you wait", name: "Hold Your Place | Scan to join the queue" },
    twin: { weather: "29°C · Sunny", wIcon: "sunny", inStore: 18, wait: [1,6], max: 5, close: "9:00 pm", active: ["Coastal","Hot Day"],
      zones: [["Sun care bay",20,20,250,130],["Consultation room",290,20,250,130],["Entrance",20,170,250,124],["Dispensary",290,170,250,124]], qd: [312,272],
      displays: [["Window display","land",27,74],["Sun care bay display","port",89,60]] },
    previews: [["Bayview","Sun care bay by the entrance · Open until 9pm","play"],["Hillcrest Medical Centre","Sunscreen at the front counter","play"],["Station Square","Travel sun care essentials · Open until 10pm","busy"]]
  },
  convenience: {
    prefix: "LC", total: 51, category: "Convenience store",
    existing: [["LC-001","Central Station","Central",3,"City convenience"],["LC-002","Ridge Road Services","North",4,"Motorway site"]],
    results: [["Highway 9 Services","Highway 9, Exit 14 northbound","Open 24 hours","4.5","North","Motorway site"],["Market Street","22 Market Street","Open · Closes 11 pm","4.4","Central","City convenience"],["Eastbrook","Eastbrook Road","Open · Closes 10 pm","4.3","East","Regional highway"],["Gateway Truck Stop","Gateway Freight Park","Open 24 hours","4.2","West","Truck stop"],["Riverside","18 River Road","Open · Closes 11 pm","4.6","South","City convenience"],["Northern Link","Northern Link Highway, km 62","Open 24 hours","4.1","North","Regional highway"]],
    focus: { name: "Highway 9 Services", code: "LC-011", addr: "Highway 9, Exit 14 northbound", suburb: "Kingsford", post: "4207", local: "Fresh coffee and pastries, open 24 hours", phone: "(07) 3355 6100", web: "larkspurconvenience.com/highway-9-services", fixed: ["Motorway sites"], variable: [] },
    segs: { fixed: ["Motorway sites","City convenience","Regional highway","Truck stops"], variable: ["Pastry out of stock"] },
    rule1: ["Store / Location Data","Fixed Store Segments","includes selected",["Motorway sites","City convenience"]],
    rule3: ["Store / Location Data","Variable Store Segments","excludes selected [OR]",["Pastry out of stock"]],
    rule2: ["Queueing / Aggregate Visitor Data","Reason for Visit (Aggregate)","greater than","30","Fuel and coffee"], subMode: "select", subOpts: ["Fuel only","Fuel and coffee","Car wash","Other"], subLabel: "stopping for fuel and coffee",
    sched: { name: "Weekday mornings", start: "01 Dec 2026", end: "28 Feb 2027", range: "1 December to 28 February, weekday mornings", times: ["05:30","10:30"], mode: "Weekday mornings", repeat: "Every weekday" },
    q: { head: "HOT COFFEE", sub: "Fresh inside, steps from the pump", name: "Hot Coffee | Fresh inside" },
    twin: { weather: "18°C · Clear", wIcon: "sunny", inStore: 9, wait: [1,3], max: 5, close: "open 24 hours", active: ["Motorway sites","Weekday morning"],
      zones: [["Forecourt",20,20,250,130],["Coffee bar",290,20,250,130],["Coolers",20,170,250,124],["Checkout",290,170,250,124]], qd: [312,272],
      displays: [["Forecourt display","land",27,74],["Shop front display","port",89,60]] },
    previews: [["Highway 9 Services","Fresh coffee and pastries, open 24 hours","play"],["Market Street","Coffee bar by the door","play"],["Eastbrook","Pastries warm from 5:30am","play"]]
  }
};
const L = () => LOC[S.ind];
/* the visitor's brand drives every brand-derived string; the demo brand's own values apply only when none is set */
const storePrefix = () => S.brand ? (initials(S.brand).replace(/[^A-Z0-9]/g,"") || L().prefix) : L().prefix;
const storeCode = c => c.replace(/^[A-Z0-9]+-/, storePrefix() + "-");
const brandWeb = web => { const slug = B().toLowerCase().replace(/[^a-z0-9]/g,""); return S.brand && slug ? slug + ".com" + web.slice(web.indexOf("/")) : web; };
const SRC = ["Store / Location Data","Queueing / Aggregate Visitor Data","Visitor / Customer Data","Interaction / Campaign Data","Computer Vision / Webcam Data"];
const ATTR = { "Store / Location Data": ["Store Code(s)","Store Name(s)","Store Segment (Consolidated)","Fixed Store Segments","Variable Store Segments","Display Tag(s)","Languages Spoken by Staff","Display ID","Display Type(s)","Display Name(s)","Store Suburb","Store State","Store Country"], "Queueing / Aggregate Visitor Data": ["Estimated Wait Time","Number of Visitors in Queue","Visitor Type (Aggregate)","Reason for Visit (Aggregate)","Visitor Device Type (Aggregate)"] };
const OPS = { seg: ["includes selected","matches exactly","excludes selected [OR]","excludes selected [AND]"], num: ["equal","not equal","greater than","less than","greater than or equal","less than or equal"] };
const TOKENS = ["Store Name","Localised Copy","Suburb","Closing Time Today"];

function qrSVG(x, y, s, fill) {
  let seed = 7, out = ""; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const fin = (fx, fy) => `<rect x="${fx}" y="${fy}" width="7" height="7" fill="${fill}"/><rect x="${fx+1}" y="${fy+1}" width="5" height="5" fill="#fff"/><rect x="${fx+2}" y="${fy+2}" width="3" height="3" fill="${fill}"/>`;
  for (let r = 0; r < 21; r++) for (let c = 0; c < 21; c++) { if ((r < 8 && c < 8) || (r < 8 && c > 12) || (r > 12 && c < 8)) continue; if (rnd() > .52) out += `<rect x="${c}" y="${r}" width="1" height="1" fill="${fill}"/>`; }
  return `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-2" y="-2" width="25" height="25" rx="2" fill="#fff"/>${fin(0,0)}${fin(14,0)}${fin(0,14)}${out}</g>`;
}
function storesScreen(imported, fresh) {
  const l = L(), rows = l.existing.map(r => ({ code: storeCode(r[0]), name: r[1], region: r[2], disp: r[3], seg: r[4] }));
  const all = rows.concat(imported ? l.results.map((r,i) => ({ code: `${storePrefix()}-${String(11+i).padStart(3,"0")}`, name: r[0], region: r[4], disp: 2 + (i % 2), seg: r[5], isNew: fresh })) : []);
  const count = imported ? l.total + l.existing.length : l.existing.length, disp = imported ? Math.round(count * 2.3) : rows.reduce((a,r)=>a+r.disp,0);
  const body = all.map((r,i) => `<div class="sgr ${r.isNew?"new":""}" style="${r.isNew?`animation-delay:${i*90}ms`:""}"><div><span class="cb"></span></div><div class="code">${r.code}<span class="ms">content_copy</span></div><div>${esc(B())}</div><div class="b" data-store="${esc(r.name)}">${esc(r.name)}</div><div>${r.region}</div><div>${r.disp}</div><div class="muted">⋯</div></div>`).join("");
  return shell(`<div class="row"><div class="title">Stores / Branches</div><div>Total connected displays <b>${disp}</b> <span class="ms" style="font-size:18px">desktop_windows</span></div></div><div class="hr"></div>
    <div class="row" style="margin-bottom:12px"><div><b>${count}</b> Stores</div><span class="txtbtn" id="addstores">Add New Store(s)</span></div>
    <div class="grid" id="sgrid"><div class="sgh"><div><span class="cb"></span></div><div>Store Code</div><div>Brand Name</div><div>Store Name</div><div>State</div><div>Enabled Features</div><div></div></div>${body}</div>
    <div class="pager"><span>‹</span><span class="pg">1</span><span>›</span><span class="muted">50 / page</span></div>`, `Home &gt; <b>Stores / Branches</b>`, "Stores / Branches");
}
const PINS = [[120,150],[330,96],[96,330],[300,300],[384,206],[206,404]];
function mapSVG(show, sel) {
  const c = C(), pins = show ? PINS.map(([x,y],i) => `<g transform="translate(${x} ${y})"><g class="pinin" style="animation-delay:${i*110}ms"><path d="M0 0 C-9 -13 -13 -19 -13 -27 A13 13 0 1 1 13 -27 C13 -19 9 -13 0 0Z" fill="${sel?c:"#e5484d"}" stroke="#fff" stroke-width="2"/><circle cy="-27" r="5" fill="#fff"/></g></g>`).join("") : "";
  return `<svg viewBox="0 0 460 470" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="460" height="470" fill="#e9eef1"/>
    <path d="M300 0 C330 80 420 110 460 120 L460 0Z" fill="#cfe2ec"/><path d="M0 400 C80 380 120 430 170 470 L0 470Z" fill="#cfe2ec"/>
    <rect x="40" y="40" width="120" height="70" rx="8" fill="#d7e9d3"/><rect x="250" y="360" width="140" height="80" rx="8" fill="#d7e9d3"/>
    <g stroke="#fff" stroke-linecap="round"><path d="M0 200 L460 170" stroke-width="12"/><path d="M180 0 L240 470" stroke-width="12"/><path d="M0 300 L460 330" stroke-width="7"/><path d="M60 0 L120 470" stroke-width="6"/><path d="M340 0 L380 470" stroke-width="7"/><path d="M0 90 L460 60" stroke-width="5"/></g>
    ${pins}</svg>`;
}
function addStoresHTML(st) {
  const l = L(), rs = st.results ? l.results.map((r,i) => `<div class="rr ${st.all?"on":""}" style="animation-delay:${i*80}ms"><span class="cb ${st.all?"on":""}"></span><div><b>${esc(B())} ${esc(r[0])}</b><small>${esc(r[1])}</small><small class="hrs">${r[2]} · ★ ${r[3]}</small></div></div>`).join("") : `<div class="empty"><span class="ms" style="font-size:28px">travel_explore</span>Search for your brand or a store address</div>`;
  return `<div class="mask" style="padding-top:22px"><div class="modal wide"><h3>Add New Stores<span class="ms muted">close</span></h3>
    <div class="as"><div class="asl"><div class="srch"><div class="in" id="srch">${st.q?esc(st.q):`<span class="ph">Search for your stores</span>`}</div><span class="sbtn"><span class="ms">search</span></span></div>
      <div class="reslist" id="res">${rs}</div><div id="selw">${st.results?`<div class="selall" id="selall"><span class="cb ${st.all?"on":""}"></span>Select all ${l.total} results</div>`:""}</div></div>
      <div class="map" id="map">${mapSVG(st.results, st.all)}</div></div>
    <div class="row" style="margin-top:14px"><span class="btn pri" id="addman">Add Store Manually</span><div class="row" style="gap:10px"><span class="btn">Cancel</span><span class="btn ${st.all?"pri":"dis"}" id="addst">Add Stores</span></div></div></div></div>`;
}
function refreshAdd(st) { const tmp = document.createElement("div"); tmp.innerHTML = addStoresHTML(st); ["#srch","#res","#selw","#map","#addst"].forEach(s => { const a = q(s), b = tmp.querySelector(s); if (a && b) { a.innerHTML = b.innerHTML; a.className = b.className; } }); }
const crumbS = () => `Home &gt; Stores / Branches &gt; <b>${esc(L().focus.name)}</b>`;
function storeDetailScreen(o) {
  const l = L(), f = l.focus, tabs = ["Store Details","Store Hours","Enabled Features"].map((t,i) => `<div class="${i?"":"on"}">${t}</div>`).join("");
  const P = t => `<span class="ph" style="color:#bfbfbf">${t}</span>`, tags = a => a.map(x => `<span class="tag">${esc(x)} ×</span>`).join("");
  const F = (lab, val, req=false, cls="") => `<div class="f"><label>${req?"<i>*</i>":""}${lab}</label><div class="in ${cls}">${val}</div></div>`;
  const dd = (id, ph, vals) => `<div class="in tags sdd" id="${id}">${vals.length?tags(vals):P(ph)}<span class="ms chev">expand_more</span></div>`;
  return shell(`<div class="row"><div class="title">${esc(B())} ${esc(f.name)}</div><span class="row" style="gap:6px"><span class="ms" style="font-size:18px">open_in_new</span>Visit Retail Manager's Website</span></div>
    <div class="stabs" id="stabs">${tabs}</div><div class="slogo"><div>${logoSVG(70)}</div></div><div class="form" id="sfmain" style="margin-top:6px">
    ${F("Store Name", `${esc(B())} ${esc(f.name)}`, true)}${F("Brand Name", esc(B()))}${F("Business Categories", `<span class="tag">${l.category} ×</span>`, true, "tags")}
    ${F("Store Code", esc(storeCode(f.code)))}${F("Maximum People in Store", P("Maximum People in Store"))}${F("Localised Copy", P("Localised Copy"))}
    ${F("Address", esc(f.addr))}${F("Phone Number", esc(f.phone))}${F("Website", esc(brandWeb(f.web)))}
    <div class="f"><label>Languages Spoken by Store Staff</label><div class="in" style="background:#f5f5f5">&nbsp;</div></div>
    <div id="segs"><div class="f"><label>Store Segments</label>${dd("vs","Segments",o.variable||[])}</div><div class="f" style="margin-top:16px"><label>Fixed Store Segments</label>${dd("fs","Fixed Segments",o.fixed||[])}</div></div>
    <div class="row" style="justify-content:flex-start;gap:8px"><span class="btn ${o.dirty?"pri":"dis"}" id="ssave">Save Changes</span><span class="btn">Cancel</span></div><div style="height:320px"></div></div>`, crumbS(), "Stores / Branches");
}
function segScreen(st) {
  const tbl = (lab, add, k, items) => `<div class="sgsec"><div class="sglab">${lab} <span class="ms muted" style="font-size:16px">info</span></div>
    <div class="sgbar"><span class="muted" id="${k}n">${items.length} items</span><span class="txtbtn" id="${k}add">${add}</span></div>
    <div id="${k}t"><div class="sgth">Name</div>${items.length ? items.map(n => `<div class="sgtr"><span>${esc(n)}</span><span class="ms">delete</span></div>`).join("") : `<div class="sgte">No data</div>`}</div></div>`;
  return shell(`<div class="cset"><div class="csub">${["Platform Set-up","Brand / Logo / Guidelines","Campaign Settings","Retail Admin Set-up"].map(x => `<div>${x}</div>`).join("")}
      <div class="cs-open">Retail Settings<span class="ms" style="font-size:18px">expand_less</span></div><div class="cs-item on">Store Segments</div><div class="cs-item">Display Tags</div><div class="cs-item">CTA Settings</div></div>
    <div class="cmain"><div class="title" id="segtitle">Store Segments</div><div class="hr"></div><p>Manage the list of Store Segments that can be used to Localise your Campaigns for specific Stores. <b>Variable Store Segments</b> can be controlled by Store Managers whereas <b>Fixed Store Segments</b> can only be viewed and updated by HQ Admin.</p><div class="hr" style="margin-bottom:0"></div>
    ${tbl("Variable Store Segments","Add New Variable Store Segment","vr",st.variable)}${tbl("Fixed Store Segments","Add New Fixed Store Segment","fx",st.fixed)}<div style="height:200px"></div></div></div>`,
    `Home &gt; Company Settings &gt; Retail Settings &gt; <b>Store Segments</b>`, "Company Settings");
}
const segModalHTML = kind => `<div class="mask"><div class="modal" style="width:460px"><h3>Add New ${kind} Store Segment<span class="ms muted">close</span></h3><div class="fm" style="margin-top:-6px"><label><i>*</i>Name</label><div class="in" id="segin"><span class="ph" style="color:#bfbfbf">Name</span></div></div><div class="foot"><span class="btn">Cancel</span><span class="btn pri" id="segok">OK</span></div></div></div>`;
async function addSeg(kind, name, id, cps) {
  const k = kind === "Fixed" ? "fx" : "vr", ab = q(`#${k}add`); await reveal(q(`#${k}t`), id); await click(ab, id);
  q("#layer").innerHTML = segModalHTML(kind); await wait(380, id);
  const inp = q("#segin"); await click(inp, id); inp.classList.add("focus"); await typeInto(inp, name, id, cps); inp.querySelector(".caret")?.remove();
  await click(q("#segok"), id); q("#layer").innerHTML = "";
  const t = q(`#${k}t`); t.querySelector(".sgte")?.remove(); t.insertAdjacentHTML("beforeend", `<div class="sgtr new"><span>${esc(name)}</span><span class="ms">delete</span></div>`);
  q(`#${k}n`).textContent = `${t.querySelectorAll(".sgtr").length} items`; await wait(350, id);
}
function qdots(n) { const t = L().twin; let s = ""; for (let k = 0; k < n; k++) s += `<circle cx="${t.qd[0] + k*22}" cy="${t.qd[1]}" r="7" fill="${n >= t.max ? "#ff7875" : "#38b0cf"}"/>`; return s; }
function planSVG(n) {
  const t = L().twin, z = t.zones.map(([nm,x,y,w,h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#f4f7f9" stroke="#dfe6eb"/><text x="${x+12}" y="${y+22}" font-family="Roboto,Arial" font-size="13" fill="#7a8791">${esc(nm)}</text>`).join("");
  return `<svg viewBox="0 0 560 320" aria-hidden="true"><rect x="6" y="6" width="548" height="308" rx="10" fill="#fff" stroke="#c9d3da" stroke-width="2"/>${z}<rect x="60" y="305" width="150" height="14" fill="#fbfcfd"/><text x="135" y="317" text-anchor="middle" font-family="Roboto,Arial" font-size="11" fill="#9aa5ae">▲ Entrance</text><g id="qd">${qdots(n)}</g></svg>`;
}
function dthumb(kind, busy) { return busy ? art(kind, "queue", S.bright) : art(kind, "first", S.bright, { line: L().focus.local }); }
function twinHTML(n, busy) {
  const l = L(), t = l.twin, over = n >= t.max;
  const tiles = [["storefront","Store status",`Open · closes ${t.close}`],["groups","In store now",String(t.inStore)],["hourglass_top","People waiting",String(n)],[t.wIcon,"Weather",t.weather]];
  return `<div class="tiles" id="tiles">${tiles.map((x,i) => `<div class="tile ${i===2&&over?"alert":""}" id="tile${i}"><span class="ms">${x[0]}</span><div><small>${x[1]}</small><b ${i===2?'id="twn"':""}>${x[2]}</b></div></div>`).join("")}</div>
    <div class="segline"><span class="muted">Active segments</span>${t.active.map(s => `<span class="tag">${esc(s)}</span>`).join("")}<span class="live"><i></i>Live · updated just now</span></div>
    <div class="twgrid"><div class="plan" id="plan">${planSVG(n)}${t.displays.map((dp,i) => `<div class="dcard" id="dc${i}" style="left:${dp[2]}%;top:${dp[3]}%"><div class="dth ${dp[1]}">${dthumb(dp[1], busy)}</div><small><span class="ms" style="font-size:13px">tv</span>${dp[0]}</small></div>`).join("")}</div>
      <div class="nowp" id="nowp"><div class="nh">Now playing</div>${t.displays.map((dp,i) => nowRow(dp, i, busy)).join("")}
      <div class="rulebox" id="rulebox"><span>People Waiting less than ${t.max}</span><span class="rs ${over?"no":"ok"}" id="rs">${over?"Not met":"Met"}</span></div></div></div>`;
}
function nowRow(dp, i, busy) { const l = L(); return `<div class="np" id="np${i}"><b>${dp[0]}</b><span>${esc(busy ? l.q.name : D().name)}</span><small>${busy ? "Next in priority while the queue is long" : "Localised: " + esc(l.focus.local)}</small></div>`; }
function setSel(sel, v) { const el = q(sel); el.querySelector(".v").textContent = v; el.querySelector(".v").classList.remove("ph"); }
function addTag(sel, v) { const el = q(sel); el.querySelector(".ph")?.remove(); el.insertAdjacentHTML("beforeend", `<span class="tag">${esc(v)} ×</span>`); }
async function pick(el, opts, choice, id) {
  await click(el, id); el.classList.add("open");
  const r = rel(el), dd = document.createElement("div"); dd.className = "dd"; dd.style.left = r.x + "px"; dd.style.top = (r.y + r.h + 4) + "px"; dd.style.minWidth = r.w + "px";
  dd.innerHTML = opts.map(o => `<div class="ddo ${o===choice?"tg":""}">${esc(o)}</div>`).join(""); stage.appendChild(dd);
  try { await wait(450, id); const t = dd.querySelector(".tg"); await moveTo(t, id); t.classList.add("hov"); await wait(160, id); await click(t, id); }
  finally { dd.remove(); el.classList.remove("open"); }
}
async function pickMany(el, opts, choices, sel, id) {
  await click(el, id); el.classList.add("open");
  const r = rel(el), dd = document.createElement("div"); dd.className = "dd"; dd.style.left = r.x + "px"; dd.style.top = (r.y + r.h + 4) + "px"; dd.style.minWidth = r.w + "px";
  dd.innerHTML = opts.map(o => `<div class="ddo">${esc(o)}</div>`).join(""); stage.appendChild(dd);
  try { await wait(450, id);
    for (const ch of choices) { const t = [...dd.children].find(x => x.textContent === ch); await moveTo(t, id); t.classList.add("hov"); await wait(160, id); await click(t, id); t.classList.remove("hov"); t.classList.add("sel"); addTag(sel, ch); await wait(220, id); }
    await wait(600, id); }
  finally { dd.remove(); el.classList.remove("open"); }
}
function rowHTML(id, r) {
  const v = (k, ph) => r[k] ? `<span class="v">${esc(r[k])}</span>` : `<span class="v ph">${ph}</span>`;
  const last = Array.isArray(r[3]) ? (r[3].length ? r[3].map(t => `<span class="tag">${esc(t)} ×</span>`).join("") : `<span class="ph">Select values</span>`) : (r[3] ? esc(r[3]) : `<span class="ph">Enter value</span>`);
  return `<div class="rrow" id="rr${id}"><span class="sel w1" id="s${id}a">${v(0,"Data source")}<span class="ms">expand_more</span></span><span class="sel w2" id="s${id}b">${v(1,"Category")}<span class="ms">expand_more</span></span><span class="sel w3" id="s${id}c">${v(2,"Operator")}<span class="ms">expand_more</span></span><span class="sel w4" id="s${id}d">${last}${IS_RM ? `<span class="ms dchev">expand_more</span>` : ""}</span><span class="ms trash">delete</span></div>`;
}
function ruleRow(g, r) {
  const v = (k, ph) => r[k] ? `<span class="v">${esc(r[k])}</span>` : `<span class="v ph">${ph}</span>`;
  const main = r.pct ? `<div class="rrow" id="rr${g}"><span class="sel w1" id="s${g}a">${v(0,"Data source")}<span class="ms">expand_more</span></span><span class="sel w2" id="s${g}b">${v(1,"Category")}<span class="ms">expand_more</span></span><span class="sel w5" id="s${g}e">${r[4]?`<span class="v">${esc(r[4])}</span>`:`<span class="v ph">Sub Category</span>`}${r.sub==="select"?`<span class="ms">expand_more</span>`:""}</span><span class="sel w6" id="s${g}c">${v(2,"")}<span class="ms">expand_more</span></span><span class="sel w4" id="s${g}d">${r[3]?esc(r[3]):""}<span class="pct">%</span></span><span class="ms trash">delete</span></div>` : rowHTML(g, r);
  const ors = (r.ors || []).map((o, k) => `<div class="orl">OR</div>` + rowHTML(`${g}o${k}`, o)).join("");
  return `<div class="rgroup" id="rg${g}">${main}${ors}<div class="orbw"><span class="orb" id="orb${g}">+ Add new "OR" Condition</span></div></div>`;
}
const rulesHTML = rules => rules.map((r,g) => (g ? `<div class="and">AND</div>` : "") + ruleRow(g, r)).join("");
function targetScreen(rules) {
  return shell(detailTop("Targeting", !IS_RM, null) + `<div class="tgt"><div class="row" style="margin-top:20px"><span class="sec" style="margin:0">Defined campaign targeting rules</span><span class="row" style="gap:8px">Override current campaign <span class="ms muted" style="font-size:16px">help</span><span class="sw"></span></span></div>
    <div class="muted" style="margin:12px 0">Select 'Add New AND/OR Condition' to Add Targeting Rules</div><div id="rules">${rulesHTML(rules)}</div>
    <span class="andbtn" id="addand">+ Add New "AND" Condition</span><div class="hr"></div>
    <div class="row" style="justify-content:flex-start;gap:8px"><span class="btn pri" id="save">Save Changes</span><span class="btn">Cancel</span></div><div style="height:380px"></div></div>`, crumbD());
}
function localPreviewHTML() {
  const l = L();
  return `<div class="lp">${l.previews.map((p,i) => `<div class="lpc" id="lp${i}" style="animation-delay:${i*180}ms"><div class="ch"><span><span class="ms" style="font-size:16px">storefront</span> ${esc(p[0])}</span><span class="chip2 ${p[2]}">${p[2]==="busy"?`Queue at ${l.twin.wait[1]}`:"Playing now"}</span></div><div class="asset" style="aspect-ratio:16/9">${p[2]==="busy" ? art("land","queue",S.bright) : art("land","first",S.bright,{line:p[1]})}${PLAY}</div><small>${p[2]==="busy" ? `Showing ${esc(l.q.name)} until fewer than ${l.twin.max} are waiting` : `Localised Copy: ${esc(p[1])}`}</small></div>`).join("")}</div>`;
}

function scheduleScreen(rows) {
  const sc = L().sched;
  const body = rows ? `<div class="str"><div>${esc(sc.name)}</div><div>Master Schedule (All Touchpoints)</div><div>—</div><div>${sc.mode || "When Store OPEN"}</div><div>${sc.start}</div><div>${sc.repeat || "Does not repeat"}</div><div><span class="ms" style="font-size:18px">edit</span> <span class="ms" style="font-size:18px">delete</span></div></div>`
    : `<div class="sempty"><span class="ms" style="font-size:40px;color:#d9d9d9">inbox</span>No Schedule(s) Assigned. When Activated, this campaign will run continuously.</div>`;
  return shell(detailTop("Scheduling", true, null) + `<div class="sec" style="margin-top:20px">Campaign scheduling</div>
    <div class="row" style="margin-top:12px"><div>${rows?1:0} Schedule(s) Assigned</div><span class="txtbtn" id="addsch">Add New Schedule</span></div>
    <div class="stbl" id="stbl"><div class="sth"><div>Name</div><div>Touch Point</div><div>Playlist(s)</div><div>Mode</div><div>Start Time</div><div>Repeat Option</div><div>Actions</div></div><div id="srows">${body}</div></div>`, crumbD());
}
function schedModalHTML() {
  return `<div class="mask" style="padding-top:40px"><div class="modal" style="width:780px"><h3>Add a New Schedule<span class="ms muted">close</span></h3><div class="fm">
    <label><i>*</i>Name</label><div class="in" id="sname"><span class="ph" style="color:#bfbfbf">&nbsp;</span></div>
    <label><i>*</i>Touchpoint(s)</label><div class="sel" style="width:100%"><span class="v">Master Schedule (All Touchpoints)</span><span class="ms">expand_more</span></div>
    <label><i>*</i>Mode</label><div class="modes" id="modes"><span class="on">None</span><span>All Day</span><span id="mopen">When Store OPEN</span><span>When Store CLOSED</span></div>
    <div><span class="tzb">Time Zone</span> <span class="muted" style="margin-left:8px">Local Store Timezone</span></div>
    <div class="dts"><div><label><i>*</i>Start Date &amp; Time</label><div class="dtr"><div class="in" id="sd"><span class="v">05 Nov 2026</span><span class="ms muted" style="font-size:16px">calendar_today</span></div><div class="in tm"><span>08:00</span><span class="ms muted" style="font-size:16px">schedule</span></div></div></div>
      <div><label><i>*</i>End Date &amp; Time</label><div class="dtr"><div class="in" id="ed"><span class="v">05 Nov 2026</span><span class="ms muted" style="font-size:16px">calendar_today</span></div><div class="in tm"><span>17:00</span><span class="ms muted" style="font-size:16px">schedule</span></div></div></div></div>
    <div class="sel" style="width:220px;margin-top:20px"><span class="v">Does not repeat</span><span class="ms">expand_more</span></div>
    <div class="foot"><span class="btn">Cancel</span><span class="btn pri" id="schok">OK</span></div></div></div></div>`;
}
const STEPS2 = [
 { t:"Bring in your stores", s:"Stores / Branches holds every store in your network. Add them all at once with Add New Store(s).",
   enter(){ paint(storesScreen(false)); },
   async play(id){ await wait(500,id); const b=q("#addstores"); await moveTo(b,id); tip(b,this.t,this.s,1); await wait(2600,id); hideTip(); await click(b,id); q("#layer").innerHTML = addStoresHTML({}); } },
 { t:"Import from Google Maps", s:"Search for your brand and every matching store appears with its address, opening hours and rating. Select them all and add them in one go. Stores can also come from your own internal systems or be added manually.",
   enter(){ paint(storesScreen(false)); q("#layer").innerHTML = addStoresHTML({}); },
   async play(id){ const sr=q("#srch"); await click(sr,id); await typeInto(sr, B(), id, reduce?999:16);
     await wait(300,id); refreshAdd({ q:B(), results:true }); await wait(900,id);
     tip(q("#res"),this.t,"Every matching store with its address, opening hours and rating, plotted on the map.",2); await wait(2800,id); hideTip();
     tip(q("#addman"),"Not just Google","Google Maps is one source. Stores can also be imported from your own internal systems, or added manually.",2); await wait(3200,id); hideTip();
     await click(q("#selall"),id); refreshAdd({ q:B(), results:true, all:true }); await wait(800,id);
     const ad=q("#addst"); await moveTo(ad,id); tip(ad,"Add them all",`${L().total} stores selected and ready to add.`,2); await wait(2000,id); hideTip(); await click(ad,id);
     paint(storesScreen(true,true)); await wait(1200,id); tip(q("#sgrid"),"Your store network",`${L().total} stores imported in seconds, each with its own store code.`,2); await wait(2800,id); hideTip(); } },
 { t:"Every store becomes a digital twin", s:"Each store you add becomes a digital twin of that store. Localisation happens at store level: every campaign is matched to each store's twin, so what plays is decided store by store.",
   enter(){ paint(storesScreen(true)); },
   async play(id){ await wait(500,id); const row=q(`[data-store="${L().focus.name}"]`).closest(".sgr"); await moveTo(row,id,.3,.5);
     tip(row,`${L().focus.name}, as a digital twin`,"Its address, phone number, website and opening hours come from the import. Store segments, displays and live queue data join the twin as you add them.",3); await wait(3800,id); hideTip();
     tip(q("#sgrid"),this.t,"Targeting rules are checked against every store's twin, so one campaign plays differently in each store, based on what's true in that store right now.",3); await wait(3800,id); hideTip(); } },
 { t:"Create your store segments", s:"In Company Settings, under Retail Settings, Store Segments lists the segments your campaigns can use. Add the ones this campaign needs: Variable Store Segments that store managers control, and Fixed Store Segments that only HQ Admin sets.",
   enter(){ paint(segScreen({ fixed: [], variable: [] })); },
   async play(id){ const l=L(); await wait(500,id); tip(q("#segtitle"),this.t,"Store segments are defined once for the whole company, then assigned to stores and used in campaign targeting.",4); await wait(3000,id); hideTip();
     tip(q("#vradd"),"Variable Store Segments",`Conditions the store knows first, like ${l.segs.variable[0]}. Store managers switch them on and off for their own store.`,4); await wait(3200,id); hideTip();
     for (const [i,n] of l.segs.variable.entries()) await addSeg("Variable", n, id, i ? 26 : 18);
     await reveal(q("#fxt"),id); tip(q("#fxadd"),"Fixed Store Segments","Permanent groupings like Metro, Regional and Airport. Only HQ Admin can see and set them. They're not visible in Retail Admin or to store staff.",4); await wait(3800,id); hideTip();
     for (const [i,n] of l.segs.fixed.entries()) await addSeg("Fixed", n, id, i ? 26 : 16);
     tip(q("#fxt"),"Ready to assign",`${l.segs.fixed.length + l.segs.variable.length} store segments, ready to assign to stores and to use in the campaign's targeting rules.`,4); await wait(3000,id); hideTip(); } },
 { t:"Assign segments to each store", s:"Open a store from Stores / Branches. On Store Details, choose its Fixed Store Segments and any Variable Store Segments that apply today, then save.",
   enter(){ paint(storesScreen(true)); },
   async play(id){ const l=L(), f=l.focus; await wait(400,id); const nm=q(`[data-store="${f.name}"]`); await moveTo(nm,id); tip(nm,this.t,`Open ${f.name} to assign its store segments.`,5); await wait(2400,id); hideTip(); await click(nm,id);
     paint(storeDetailScreen({})); setTop(0,0); await wait(700,id);
     tip(q("#stabs"),"Store Details",`${f.name}'s address, phone number, website and opening hours came from Google Maps. Store segments are set here.`,5); await wait(3000,id); hideTip();
     await focusRow(q("#segs"),id);
     await pick(q("#fs"), l.segs.fixed, f.fixed[0], id); addTag("#fs", f.fixed[0]); q("#ssave").className="btn pri"; await wait(300,id);
     tip(q("#fs"),"Fixed Store Segments",`${f.name} is a ${f.fixed[0]} store. Only HQ Admin can see and set fixed segments. They're not visible in Retail Admin or to store staff.`,5); await wait(3800,id); hideTip();
     tip(q("#vs"),"Store Segments",`Variable segments stay empty until they apply. If ${f.name} runs out of stock, its store manager switches on ${l.segs.variable[0]} in Retail Admin, or HQ sets it here.`,5); await wait(3800,id); hideTip();
     const sv=q("#ssave"); await click(sv,id); sv.className="btn dis"; await wait(500,id);
     tip(q("#segs"),"Every store, its own segments","Each store carries its own segments, so the same campaign targeting plays out differently in every store.",5); await wait(3000,id); hideTip(); } },
 { t:"Target by store segment", s:"Open the campaign's Targeting tab and add a rule from Store / Location Data. The Fixed Store Segments you created and assigned to stores appear as values.",
   enter(){ paint(targetScreen([])); },
   async play(id){ const tb=q("#addand"); await moveTo(tb,id); tip(tb,this.t,this.s,4); await wait(2800,id); hideTip(); await click(tb,id);
     q("#rules").innerHTML = rulesHTML([[,,,[]]]); await focusRow(q("#rg0"),id); const r=L().rule1;
     await pick(q("#s0a"), SRC, r[0], id); setSel("#s0a", r[0]);
     await pick(q("#s0b"), ATTR[r[0]], r[1], id); setSel("#s0b", r[1]);
     await pick(q("#s0c"), OPS.seg, r[2], id); setSel("#s0c", r[2]);
     await pickMany(q("#s0d"), L().segs.fixed, r[3], "#s0d", id);
     tip(q("#rg0"),"Fixed Store Segments",`The campaign plays only in ${r[3].join(" and ")} stores.`,4); await wait(2800,id); hideTip(); } },
 { t:"Suppress when stock runs out", s:"Add a Variable Store Segments rule. Store staff switch these segments on and off, so when a store runs out of stock the campaign stops playing in that store.",
   enter(){ paintRules(targetScreen([L().rule1])); },
   async play(id){ const tb=q("#addand"); await moveTo(tb,id); tip(tb,this.t,this.s,5); await wait(3000,id); hideTip(); await click(tb,id);
     q("#rules").innerHTML = rulesHTML([L().rule1, [,,,[]]]); await focusRow(q("#rg1"),id); const r=L().rule3;
     await pick(q("#s1a"), SRC, r[0], id); setSel("#s1a", r[0]);
     await pick(q("#s1b"), ATTR[r[0]], r[1], id); setSel("#s1b", r[1]);
     await pick(q("#s1c"), OPS.seg, r[2], id); setSel("#s1c", r[2]);
     await pickMany(q("#s1d"), L().segs.variable, r[3], "#s1d", id);
     tip(q("#rg1"),"Variable Store Segments",`If staff in a store switch on ${r[3].join(" or ")}, the campaign is suppressed in that store until they switch it off.`,5); await wait(3200,id); hideTip(); } },
 { t:"Respond to who's in store", s:"Add a rule from Queueing / Aggregate Visitor Data. It describes everyone in the store or queue right now, not one person, so the campaign plays when the mix suits it.",
   enter(){ paintRules(targetScreen([L().rule1, L().rule3])); },
   async play(id){ const tb=q("#addand"); await moveTo(tb,id); tip(tb,this.t,this.s,6); await wait(3200,id); hideTip(); await click(tb,id);
     const l=L(), r=l.rule2, blank=Object.assign([], {pct:true, sub:l.subMode});
     q("#rules").innerHTML = rulesHTML([l.rule1, l.rule3, blank]); await focusRow(q("#rg2"),id);
     await pick(q("#s2a"), SRC, r[0], id); setSel("#s2a", r[0]);
     await pick(q("#s2b"), ATTR[r[0]], r[1], id); setSel("#s2b", r[1]);
     const sub=q("#s2e");
     if (l.subMode === "select") { await pick(sub, l.subOpts, r[4], id); setSel("#s2e", r[4]); }
     else { await click(sub,id); sub.classList.add("open"); const vv=sub.querySelector(".v"); vv.classList.remove("ph"); await typeInto(vv, r[4], id, 12); vv.querySelector(".caret")?.remove(); sub.classList.remove("open"); }
     await pick(q("#s2c"), OPS.num, r[2], id); setSel("#s2c", r[2]);
     const v=q("#s2d"); await click(v,id); v.innerHTML = `<span class="vv"></span><span class="pct">%</span>`; await typeInto(v.querySelector(".vv"), r[3], id, 8); v.querySelector(".caret")?.remove();
     tip(q("#rg2"), r[1], `The campaign plays when more than ${r[3]}% of people in the store right now are ${l.subLabel}.`,6); await wait(3200,id); hideTip();
     const sv=q("#save"); await click(sv,id); sv.className="btn dis"; sv.nextElementSibling.className="btn dis"; await wait(1200,id); } },
 { t:"Schedule it", s:"On Scheduling, add a schedule. When Store OPEN follows each store's own opening hours in its local time zone, so the schedule is localised too.",
   enter(){ paint(scheduleScreen(false)); },
   async play(id){ const sc=L().sched, ab=q("#addsch"); await moveTo(ab,id); tip(ab,this.t,"Without a schedule the campaign runs continuously once activated. Add New Schedule sets when it plays.",7); await wait(2800,id); hideTip(); await click(ab,id);
     q("#layer").innerHTML = schedModalHTML(); await wait(500,id);
     const nm=q("#sname"); await click(nm,id); await typeInto(nm, sc.name, id, 18); nm.querySelector(".caret")?.remove();
     if (sc.times) { const tms=q("#layer").querySelectorAll(".tm span:first-child"); tms[0].textContent = sc.times[0]; tms[1].textContent = sc.times[1];
       tip(q("#modes"),"Weekday mornings","Plays from "+sc.times[0]+" to "+sc.times[1]+" in each store's local time zone, the commuter coffee rush.",7); await wait(3000,id); hideTip(); }
     else { const mo=q("#mopen"); await click(mo,id); [...q("#modes").children].forEach(x=>x.classList.toggle("on", x===mo)); q("#layer").querySelectorAll(".tm").forEach(x=>x.remove()); await wait(400,id);
     tip(q("#modes"),"When Store OPEN","Plays only while each store is open, using that store's opening hours and local time zone.",7); await wait(3000,id); hideTip(); }
     for (const [sel,val] of [["#sd",sc.start],["#ed",sc.end]]) { const el=q(sel); await click(el,id); el.classList.add("focus"); const vv=el.querySelector(".v"); await typeInto(vv, val, id, 16); vv.querySelector(".caret")?.remove(); el.classList.remove("focus"); await wait(250,id); }
     if (sc.repeat) { const rp=q('#layer .sel[style*="220px"]'); const rv=rp.querySelector(".v"); await click(rp,id); rv.textContent = sc.repeat; await wait(300,id); }
     tip(q(".dts"),"From and to",`Runs from ${sc.range}, in every store the targeting rules allow.`,7); await wait(2800,id); hideTip();
     await click(q("#schok"),id); paint(scheduleScreen(true)); await wait(600,id);
     tip(q("#stbl"),"Scheduled",`${sc.range}${sc.times ? "" : ", while each store is open"}. Combined with the targeting rules, every store's digital twin decides what plays and when.`,7); await wait(3400,id); hideTip(); showEnd(); } }
];

/* ================= flow 3: personalisation ================= */
const PERS = {
  telco: { person: "Sarah", store: "Northgate Mall", time: "10:42", display: "Smart shelf", shelf: "iPhone aisle", reasons: ["New phone","Trade-in","Bill enquiry","Returns"], reason: "Trade-in",
    first: "notif", conn: false, top: ["#2E6FD8","blue"], staffP: ["he","his"], findAt: "in the iPhone aisle", email: "sarah@example.com", mid: ["Jordan Miles","JM"], ins: [["price_check","Trading In My iPhone"],["language","My Account - Upgrade Eligible"],["phone_iphone","iPhone 13"],["workspace_premium","Loyalty Gold"],["payments","$85/month"]], look: ["#e2b59a","#3b2a20","m"], others: [["N0283","Tom","New phone",4],["N0284","Mei","Returns",2]], mobile: "0412 345 678", line: 2, waitMin: 5, pos: 3, staff: "Alex", ticket: "N0281",
    methods: [["near_me","Detected by proximity in your app",true],["groups","Joins the queue",true],["qr_code_scanner","Scans the QR code on a screen",false],["event_available","Arrives for a Click & Collect appointment",false]],
    attrs: [["Reason for Visit (Individual)","Trade-in","Queue check-in",1],["Device Type (Individual)","iPhone","Queue check-in",1],["Product Holdings","iPhone 13","Your CRM",0],["Audience / Segments","Loyalty Gold","Your loyalty program",1]],
    r1: ["Visitor / Customer Data","Reason for Visit (Individual)","includes selected",["Trade-in"]],
    r2: ["Visitor / Customer Data","Device Type (Individual)","includes selected",["iPhone"]], r2mode: "tags",
    r3: ["Visitor / Customer Data","Audience / Segments","includes selected","Loyalty Gold"], match: "Trade-in, iPhone and Loyalty Gold" },
  pharmacy: { person: "Emma", store: "Bayview", time: "10:31", display: "Sun care bay display", reasons: ["Skin & sun advice","Travel health advice","Click & Collect","Other"], reason: "Skin & sun advice",
    first: "home0", conn: true, top: ["#7B4FA0","purple"], staffP: ["she","her"], findAt: "near the sun care bay", email: "emma@example.com", mid: ["Kate Tran","KT"], ins: [["edit_note","Skin & sun advice"],["workspace_premium","Loyalty Gold"],["shopping_bag","Sun care range"],["sell","Offer shown: Extra 20% off sun care"]], look: ["#c68c6b","#1f1a17","f"], others: [["H0148","John","Travel health advice",3],["H0149","Lena","Skin & sun advice",1]], mobile: "0423 456 789", line: 1, waitMin: 3, pos: 2, staff: "Priya", ticket: "H0146",
    methods: [["qr_code_scanner","Scans the QR code on a screen",true],["groups","Joins the queue",true],["near_me","Detected by proximity in your app",false],["event_available","Arrives for a Click & Collect appointment",false]],
    attrs: [["Reason for Visit (Individual)","Skin & sun advice","Queue check-in",1],["Device Type (Individual)","Android","Queue check-in",0],["Audience / Segments","Loyalty Gold","Your loyalty program",1],["Purchase History","Sun care range","Your POS",1]],
    r1: ["Visitor / Customer Data","Reason for Visit (Individual)","includes selected",["Skin & sun advice"]],
    r2: ["Visitor / Customer Data","Audience / Segments","includes selected","Loyalty Gold"], r2mode: "text",
    r3: ["Visitor / Customer Data","Purchase History","includes selected","Sun care range"], match: "Skin & sun advice, Loyalty Gold and a sun care purchase history" },
  convenience: { person: "Sam", store: "Highway 9 Services", time: "7:42", display: "Forecourt display", reasons: ["Loyalty Gold","Loyalty Silver","Fleet card","Occasional visitor"], reason: "Fuel and coffee", conv: true, ci: "Pump check-in",
    first: "notif", conn: false, top: ["#2E6FD8","blue"], staffP: ["she","her"], findAt: "at the coffee bar", email: "sam@example.com", mid: ["Jordan Reyes","JR"], ins: [["local_gas_station","Fuelling at pump 4"],["workspace_premium","Loyalty Gold"],["local_cafe","Usual: flat white and pastry"],["sell","Offer shown: your usual coffee + pastry, $6"]], look: ["#c68c6b","#1f1a17","f"], others: [], mobile: "0434 567 890", line: 0, waitMin: 0, pos: 0, staff: "Jordan", ticket: "Pump 4",
    methods: [["near_me","Loyalty app at the pump",true],["credit_card","Loyalty card at the pump",false],["qr_code_scanner","Scans the QR code on a screen",false],["badge","Fleet card",false]],
    attrs: [["Location","Pump 4, Highway 9 Services","Pump check-in",0],["Check-in method","Loyalty app","Pump check-in",0],["Audience / Segments","Loyalty Gold","Your loyalty program",1],["Purchase History","Coffee","Your POS",1]],
    r1: ["Visitor / Customer Data","Audience / Segments","includes selected",["Loyalty Gold"]],
    r2: ["Visitor / Customer Data","Purchase History","includes selected","Coffee"], r2mode: "text",
    r3: null, match: "Loyalty Gold and a coffee purchase history" }
};
PERS["retail-media"] = { ...PERS.convenience, person: "Emma", reason: "Fuel and a cold drink", findAt: "at the coolers", email: "emma@example.com", look: ["#e0b49a","#6b3b1f","f"],
  ins: [["local_gas_station","Fuelling at pump 4"],["workspace_premium","Loyalty Gold"],["local_drink","Usually buys: cold drinks"],["sell","Offer shown: a free Frostline upsize"]],
  attrs: [["Location","Pump 4, Highway 9 Services","Pump check-in",0],["Check-in method","Loyalty app","Pump check-in",0],["Audience / Segments","Loyalty Gold","Retailer's loyalty program",1],["Purchase History","Cold drinks","Retailer's POS",1]],
  r2: ["Visitor / Customer Data","Purchase History","includes selected",["Cold drinks"]], r2mode: "tags", match: "Loyalty Gold and a cold drinks purchase history" };
LOC["retail-media"] = LOC.convenience;
const P3 = () => PERS[S.ind];
const baseRules = ors => { const l = L(); return [l.rule1, l.rule3, Object.assign([...l.rule2], { pct: true, sub: l.subMode, ors: ors || [] })]; };
ATTR["Visitor / Customer Data"] = ["First Name","Company Name","Purchase Intent","Visitor Type (Individual)","Reason for Visit (Individual)","Device Type (Individual)","Age","Gender","Audience / Segments","Product Type(s)","Plan Type(s)","Plan Value(s)","Page Views","Events","Product Holdings","Purchase History","SKU(s)"].filter(x => (S.ind !== "pharmacy" && S.ind !== "convenience" && S.ind !== "retail-media") || !/^(Plan |Age$)/.test(x));
const BARS = [38,48,45,40,40,36,45,58,66,58,53,72,33,16];
function promoHTML(which) {
  const d = D(), c = IS_RM ? ADV().color : C(), a = IS_RM ? ADV().accent : d.accent, ini = esc(initials(AB())), on = S.ind === "telco" ? "#0d1114" : "#fff";
  const logo = `<div class="pc-logo"><span style="color:${c}">${ini}</span>${esc(AB())}</div>`;
  if (which === "camp") { gid++;
    return `<div class="ss-card" id="pcard" style="background:linear-gradient(160deg,${c},${mix(c,"#000000",.4)})">${logo}
      <svg class="pc-illo" viewBox="0 0 240 250" aria-hidden="true"><defs><linearGradient id="scr${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(c,"#ffffff",.35)}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs>${illo(0,0,1,a,mix(c,"#000000",.55))}</svg>
      <div class="pc-big"${d.big.length > 6 ? ' style="font-size:30px"' : ""}>${esc(d.big)}</div><div class="pc-bs" style="color:${a}">${esc(d.bigSub)}</div><div class="pc-h">${esc(d.headline)}</div><div class="pc-tag">Picked for you</div></div>`; }
  const [t1, t2] = d.rows[0][1].split(" | "), ic = { home:"router", leaf:"eco" }[d.thumbs[0]] || "sell";
  return `<div class="ss-card" id="pcard" style="background:linear-gradient(160deg,${mix(c,"#000000",.15)},${mix(c,"#000000",.5)})">${logo}<span class="ms pc-ic" style="color:${a}">${ic}</span>
    <div class="pc-h2">${esc(t1)}</div><div class="pc-bs" style="color:${a}">${esc(t2)}</div><div class="pc-cta" style="background:${a};color:${on}">Find out more</div></div>`;
}
function shelfSVG(on) {
  gid++; const d = D(), c = C(), a = d.accent, ini = esc(initials(B()));
  const T = (x,y,size,txt,fill,w=900,anchor="start") => `<text x="${x}" y="${y}" font-family="Roboto,Arial" font-weight="${w}" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${esc(txt)}</text>`;
  const phones = [["#1b1f23",34],["#d9d4cc",134],["#c9a96e",234],["#2d3b4f",334],["#e9e9e9",434]].map(([col,x],i) => `<g transform="translate(${x+12} ${78+(i%2)*8})"><rect x="22" y="104" width="24" height="12" rx="2" fill="#b9c2c9"/><rect width="68" height="112" rx="12" fill="${col}"/><rect x="4" y="4" width="60" height="104" rx="9" fill="url(#ss${gid})"/><rect x="26" y="9" width="16" height="4" rx="2" fill="#0d1114"/></g>`).join("");
  const [t1, t2] = d.rows[0][1].split(" | ");
  const scr = on
    ? `<g class="scr"><rect x="16" y="222" width="528" height="84" rx="4" fill="url(#sb${gid})"/><rect x="32" y="248" width="30" height="30" rx="7" fill="#fff"/>${T(47,268,11,initials(B()),c,900,"middle")}${T(70,268,12,B(),"#fff",700)}
       ${T(178,276,40,d.big,"#fff")}${T(180,294,9.5,d.bigSub,a,800)}${T(318,258,16,d.headline,"#fff",800)}${T(318,278,10.5,d.sub,mix("#ffffff",c,.15),500)}<rect x="318" y="285" width="96" height="14" rx="7" fill="${a}"/>${T(366,295,7.5,"PICKED FOR YOU",S.ind==="telco"?"#0d1114":"#fff",800,"middle")}</g>`
    : `<g class="scr"><rect x="16" y="222" width="528" height="84" rx="4" fill="url(#sd${gid})"/><rect x="32" y="248" width="30" height="30" rx="7" fill="#fff"/>${T(47,268,11,initials(B()),c,900,"middle")}${T(178,264,22,t1,"#fff",800)}${T(178,286,12,t2,a,700)}</g>`;
  return `<svg viewBox="0 0 560 320" role="img" aria-label="Smart shelf with phones on display"><defs>
    <linearGradient id="ss${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(c,"#ffffff",.35)}"/><stop offset="1" stop-color="${a}"/></linearGradient>
    <linearGradient id="sb${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${mix(c,"#000000",.4)}"/></linearGradient>
    <linearGradient id="sd${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mix(c,"#000000",.15)}"/><stop offset="1" stop-color="${mix(c,"#000000",.5)}"/></linearGradient>
    <linearGradient id="sw${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3f6f8"/><stop offset="1" stop-color="#e2e8ec"/></linearGradient></defs>
    <rect width="560" height="320" fill="url(#sw${gid})"/>${T(280,44,20,"iPhone","#55626d",800,"middle")}<rect x="250" y="54" width="60" height="3" rx="1.5" fill="${c}"/>
    <path d="M0 196 H560 V214 H0 Z" fill="#fafbfc"/><path d="M0 196 H560" stroke="#d5dde3" stroke-width="2"/>${phones}
    <rect id="shelfedge" x="10" y="216" width="540" height="96" rx="8" fill="#11161b"/>${scr}</svg>`;
}
function avatarSVG() {
  const c = C(), a = D().accent, [skin, hair, k] = P3().look, sk2 = mix(skin, "#000000", .12);
  const back = k === "f" ? `<path d="M34 56 C32 26 88 26 86 56 L90 100 C78 106 42 106 30 100 Z" fill="${hair}"/>` : "";
  const top = k === "f" ? `<path d="M37 50 C38 26 84 24 84 52 C76 38 56 34 37 50 Z" fill="${hair}"/>` : `<path d="M38 48 C36 26 84 22 83 47 C80 38 70 33 60 34 C50 34 43 39 38 48 Z" fill="${hair}"/>`;
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><rect width="120" height="120" fill="${mix(c,"#ffffff",.78)}"/>${back}
    <rect x="52" y="66" width="16" height="20" rx="6" fill="${sk2}"/><path d="M12 124 C14 96 36 84 60 84 C84 84 106 96 108 124 Z" fill="${c}"/>
    <path d="M49 84 L60 99 L71 84 Z" fill="#fff"/><path d="M47 86 L56 120 M73 86 L64 120" stroke="${a}" stroke-width="3"/><rect x="66" y="104" width="16" height="12" rx="2" fill="#fff"/>
    <ellipse cx="38.5" cy="52" rx="4" ry="6" fill="${sk2}"/><ellipse cx="81.5" cy="52" rx="4" ry="6" fill="${sk2}"/>
    <ellipse cx="60" cy="50" rx="21" ry="24" fill="${skin}"/>${top}
    <circle cx="52" cy="52" r="2.2" fill="#2b2b2b"/><circle cx="68" cy="52" r="2.2" fill="#2b2b2b"/><path d="M53 62 Q60 67 67 62" stroke="${mix(skin,"#000000",.4)}" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;
}
function screenHTML(st) {
  const p = P3(), c = C(), ini = esc(initials(B()));
  if (st === "notif") return `<div class="ph-lock"><div class="ph-time">${p.time.replace(/\d$/, d => String(Math.max(0, +d - 1)))}</div><div class="ph-date">${IS_RM ? "Tuesday 8 December" : "Friday 6 November"}</div>
      <div class="ph-note" id="pnote"><div class="pn-top"><span class="ph-logo sm" style="background:${c}">${ini}</span>${esc(B())}<small>now</small></div>
      ${p.conv ? `<b>Welcome to ${IS_RM ? esc(p.store) : "pump 4"}, ${p.person}</b><span>Tap to check in and earn rewards.</span>` : `<b>Welcome to ${esc(p.store)}, ${p.person}</b><span>Tap to join the queue.</span>`}</div></div>`;
  if (st === "pump") { const camp = promoHTML("camp");
    return `<div class="ss" style="--bc:${c};--bg2:${mix(c,"#ffffff",.86)}"><div class="ss-top home"><span class="ss-brand">${logoSVG(28)}<span>${esc(B())}</span></span></div><div class="ss-store">Pump 4 · ${esc(p.store)}</div><div class="ss-body">
      <div class="ss-lab" id="pcheck">CHECKED IN WITH YOUR LOYALTY APP</div>
      <div class="ss-car">${camp}</div><div class="ss-dots"><i class="on"></i><i></i><i></i><i></i></div>
      <div class="ss-li"><span class="ms" style="color:${c}">workspace_premium</span><b>Gold member</b><span class="ss-chip">1,240 points</span></div>
      <div class="ss-foot">© 2026 ${esc(B())}</div></div></div>`; }
  const right = p.conn && st !== "served" ? `<span class="ss-pill"><span class="ms">tv</span><i class="ok"></i><span class="x" style="background:${c}">✕</span></span>` : `<span class="ss-qr" style="background:${c}"><span class="ms">qr_code_2</span></span>`;
  const sub = `<div class="ss-top"><span class="ss-back" style="color:${c}"><span class="ms">chevron_left</span>Back</span><b class="t">Join the Queue</b>${right}</div>`;
  let body;
  if (st === "home0" || st === "home1" || st === "home2") {
    const joined = st !== "home0";
    body = `<div class="ss-top home"><span class="ss-brand">${logoSVG(28)}<span>${esc(B())}</span></span>${right}</div><div class="ss-store">${esc(p.store)}</div><div class="ss-body">
      ${p.conn ? `<div class="ss-lab">CONNECTED TO STORE DISPLAY</div>` : ""}
      <div class="ss-car">${promoHTML(st === "home2" ? "camp" : "brand")}<span class="ss-arr"><span class="ms">chevron_right</span></span></div>
      <div class="ss-dots"><i class="on"></i><i></i><i></i><i></i></div>
      <div class="ss-li" id="pjoin"><span class="ms" style="color:${c}">groups</span><b>Join the Queue</b>${joined ? `<span class="ss-chip">Current position ${p.pos}</span>` : ""}<span class="ms ch">chevron_right</span></div>
      <div class="ss-foot">© 2026 ${esc(B())}</div></div>`;
  } else if (st === "queue") {
    const mx = Math.max(...BARS);
    body = sub + `<div class="ss-body"><div class="ss-wel"><h4>Welcome to<br>${esc(p.store)}</h4><p>If you would like to speak to a member of staff, please select 'Join the Queue' below</p>
      <div class="ss-stats" id="pstats"><div><b>${p.line}</b><span class="ms">person</span><small>People in line</small></div><div><b>${p.waitMin}</b><em>min</em><small>Estimated Waiting Time</small></div></div>
      <div class="ss-chart"><div class="ss-bars">${BARS.map(v => `<i style="height:${Math.round(v/mx*92)}%;background:${mix(c,"#ffffff",.25)}"></i>`).join("")}</div><div class="ss-ax"><span>9am</span><span>11am</span><span>1pm</span><span>3pm</span><span>5pm</span><span>7pm</span><span>9pm</span><span>11pm</span></div></div>
      <div class="ss-cap">Estimated waiting time (by minutes)</div></div>
      <div class="ss-btns"><div class="ss-btn" id="pq" style="background:${c}">Join the Queue</div><div class="ss-btn2">Cancel</div></div></div>`;
  } else if (st === "form") {
    const F = (lab, req, id, sel) => `<div class="ss-f"><label>${req ? "<i>*</i>" : ""}${lab}:</label><div class="ss-in" ${id ? `id="${id}"` : ""}>${sel ? `<span class="val"></span><span class="ms chev">expand_more</span>` : ""}</div></div>`;
    body = sub + `<div class="ss-body"><div class="ss-form">${F("First Name",1,"pf1")}${F("Last Name")}${F("Email Address")}${F("Mobile Number",1,"pf2")}${F("Reason for Visit",1,"pf3",1)}
      <div class="ss-hint">Best way for staff to find you when it's your turn</div><div class="ss-colour">Colour of your Top<span class="ss-sw" id="psw"><i></i></span></div></div>
      <div class="ss-btns"><div class="ss-btn" id="pj2" style="background:${c}">Join the Queue</div><div class="ss-btn2">Cancel</div></div></div>`;
  } else {
    body = sub + `<div class="ss-body"><div class="ss-served" id="pserved"><h4>Being served by</h4><small>TICKET NUMBER</small><div class="tk">${p.ticket}</div><small>ATTENDED BY</small>
      <div class="ss-av">${avatarSVG()}</div><div class="ss-nm"><b>${esc(p.staff)}</b><span>is helping you today</span></div></div></div>`;
  }
  return `<div class="ss" style="--bc:${c};--bg2:${mix(c,"#ffffff",.86)}">${body}</div>`;
}
function visitorHTML() {
  const p = P3(), d = D(), av = `<span class="av">${avatarSVG()}</span>`;
  return `<div class="vd"><aside class="vd-rail"><span class="on"><span class="ms">groups</span></span><span><span class="ms">desktop_windows</span></span><span><span class="ms">store</span></span><span><span class="ms">person</span></span><span class="bt"><span class="ms">crop_square</span></span></aside>
    <div class="vd-main"><div class="vd-hd"><span class="ms">menu</span><span class="vd-me">${av}<i></i></span></div>
      <div class="vd-top"><div class="vd-crumb">Retail Admin / ${p.conv ? "Visitors" : "Queueing &amp; Appointments"} / Visitor Details</div>
        <div class="vd-tr"><h2>Visitor Details</h2><span class="vd-st">${av}<span class="vd-pill">In Progress <b>00:00:15</b></span></span></div></div>
      <div class="vd-body"><div class="vd-left"><div><small>Name</small><span class="nm">${esc(p.person)}</span></div><div><small>Phone Number</small>${esc(p.mobile)}</div><div><small>Email</small><u>${esc(p.email)}</u></div><div><small>${p.conv ? "Checked in at" : "Queue Ticket"}</small>${p.ticket}</div><div><small>${p.conv ? "Check-in time" : "Joined Queue"}</small>Fri, 06 Nov 2026<br>${p.time} AM</div></div>
        <div class="vd-r"><div class="vd-lab">Today's Visit</div>
          <div class="vd-visit" id="vdvisit"><div><span class="ms">edit_note</span><span><small>Reason for Visit</small><b>${esc(p.reason)}</b></span></div><div>${p.conv ? `<span class="ms">local_gas_station</span><span><small>Fuel</small><b>Unleaded, pump 4</b></span>` : `<span class="ms">checkroom</span><span><small>Colour of Top</small><b><span class="vd-sw" style="background:${p.top[0]}"></span>${p.top[1][0].toUpperCase() + p.top[1].slice(1)}</b></span>`}</div></div>
          <div class="vd-cols"><div><div class="vd-lab">Visitor Insights</div><div class="vd-ins" id="vdins">${p.ins.map(x => `<div><span class="ms">${x[0]}</span>${esc(x[1])}</div>`).join("")}</div></div>
            <div><div class="vd-lab">Mid Sale Check-In</div><div class="vd-sub">Mid Sale Check-In with</div><div class="vd-sel"><span class="ini">${p.mid[1]}</span>${esc(p.mid[0])}<span class="ms">expand_more</span></div>
              <div class="vd-lab" style="margin-top:16px">Recommendations</div><div class="vd-rec" id="vdrec">${art("land","first",S.bright)}</div><div class="vd-dots"><i class="on"></i><i></i><i></i><i></i><i></i></div>
              <div style="display:flex;justify-content:flex-end;margin-right:22px"><span class="aibtn" id="vdplay" style="height:36px;padding:0 16px"><span class="ms">auto_awesome</span><span>Play Promo on Video Wall</span></span></div></div></div></div></div>
      <div class="vd-bar">${p.conv ? `<span>Add Additional Info</span>` : `<span>Place "On Hold"</span><span>Add Additional Info</span><span>Back to Queue</span>`}<span class="pri">Finish</span></div></div></div>`;
}
const phoneHTML = st => `<div class="phone"><div class="ph-notch"></div><div class="ph-screen" id="pscreen">${screenHTML(st)}</div></div>`;
const setPhone = st => { q("#pscreen").innerHTML = screenHTML(st); };
function sceneHTML(st, panel) {
  const p = P3();
  const right = panel === "attrs"
    ? `<div class="tp-eyebrow">Arrives with the check-in</div><h3>What the screens now know about ${p.person}</h3>
       <div class="tp-tbl" id="ptbl"><div class="tp-h"><span>Targeting attribute</span><span>Value</span><span>From</span><span>Campaign rule</span></div>${(() => { const row = (a,i) => `<div class="tp-r ${a[3]?"hit":""}" style="animation-delay:${i*260}ms"><span><b>${esc(a[0])}</b></span><span>${esc(a[1])}</span><span class="mut">${esc(a[2])}</span><span>${a[3]?`<span class="tp-ok"><span class="ms">check_circle</span>Matches</span>`:`<span class="mut">—</span>`}</span></div>`;
         const k = p.attrs.filter(a => a[2] === (p.ci || "Queue check-in")).length; return `<div id="pchk">${p.attrs.slice(0,k).map(row).join("")}</div>` + p.attrs.slice(k).map((a,i) => row(a,i+k)).join(""); })()}</div>
       <p class="tp-note">Personalisation Hub doesn't hold the customer record. It runs inside your own virtual private cloud, such as your AWS VPC, and activates the data and attributes you already hold at the moment of check-in. Customer data never leaves your environment.</p>`
    : panel === "promo"
    ? `<div class="tp-eyebrow">Personalised in the moment</div><h3>The targeted campaign reaches ${p.person}</h3>
       ${p.shelf ? `<div class="tp-shelf" id="pdisp">${shelfSVG(false)}</div>` : ""}<div class="tp-tv" id="${p.shelf ? "ptv" : "pdisp"}" ${p.shelf ? "hidden" : ""}><div class="tv-in">${(([t1,t2]) => `<div class="tv-idle" style="background:linear-gradient(135deg,${mix(C(),"#000000",.15)},${mix(C(),"#000000",.5)})">${esc(t1)}<small style="color:${D().accent}">${esc(t2)}</small></div>`)(D().rows[0][1].split(" | "))}</div></div>
       <div class="tp-cap"><span class="ms">${p.shelf ? "shelves" : "tv"}</span>${esc(p.display)} · ${p.shelf ? `${esc(p.shelf)} · where she's browsing` : `${esc(p.store)} · the screen she scanned`}</div>`
    : panel === "served"
    ? `<div class="tp-eyebrow">When it's their turn</div><h3>${esc(p.staff)} is helping ${p.person}</h3>
       <p class="tp-note" style="margin-top:0">The store site shows ${p.person}'s ticket number and who is serving her. Staff find her by the colour of her top, which she added when she joined the queue.</p>`
    : `<div class="tp-eyebrow">Check-in</div><h3>${p.person} arrives at ${esc(p.store)}</h3>
       <div class="tp-methods" id="pmeth">${p.methods.map(m => `<div class="tp-m ${m[2]?"on":""}"><span class="ms">${m[0]}</span>${esc(m[1])}</div>`).join("")}</div>
       <p class="tp-note">Every check-in identifies the customer ${p.conv ? "at the pump" : "in store"}, so screens can respond to them.</p>`;
  return `<div class="scene3"><div class="sc-left">${phoneHTML(st)}</div><div class="sc-right" id="sright">${right}</div></div>`;
}
function playbackScreen(withNew) {
  const p = P3(), d = D(), rows = [["10:38","LOCALISED","ON ROTATION",d.name,8],["10:37","LOCALISED","ON ROTATION",L().q ? D().rows[0][1] : "",6],["10:36","LOCALISED","ON ROTATION",d.name,8],["10:35","LOCALISED","ON ROTATION",D().rows[0][1],6]];
  const r = (t,a,b,n,dur,isNew) => `<div class="pbr ${isNew?"new":""}"><div>06/11/2026 <b>${t}</b></div><div class="pills"><span class="pill">${a}</span>${b?`<span class="pill">${b}</span>`:""}</div><div class="b">${esc(n)}</div><div>${dur}</div><div>Video</div></div>`;
  const kp = [["groups","#fff8e1","#d59b00","Passerby","214"],["wc","#f3f0ff","#7c5cff","Gender (Male | Female)","48% | 52%"],["visibility","#fef2f2","#e5484d","Views","96"],["timer","#ecfdf5","#22a06b","Avg view duration","3.4s"]];
  return shell(`<div class="row"><div class="title">${esc(p.store)} / ${esc(p.display)}</div><div class="status"><span class="btn">Delete Display</span><span class="muted" style="margin-left:12px">Status</span><b>Online</b><span class="sd"></span></div></div>
    <div style="font-weight:600;margin-top:16px">Playback Insights <span class="muted" style="font-weight:400">· Past 7 days</span></div>
    <div class="kpis">${kp.map(k=>`<div class="kpi"><div class="ic" style="background:${k[1]};color:${k[2]}"><span class="ms">${k[0]}</span></div><div><small>${k[3]}</small><b>${k[4]}</b></div></div>`).join("")}</div>
    <div class="stabs"><div>Display Details</div><div class="on">Campaign Playback</div><div>Device Status</div><div>Enabled Features</div></div>
    <div class="pbt" id="pbt"><div class="pbh"><div>Date/Time ↓</div><div>Playback Strategy</div><div>Campaign Name</div><div>Duration (seconds)</div><div>File Type</div></div>
    ${withNew ? r(p.time,"TARGETED","",d.name,8,true) : ""}${rows.map(x => r(...x)).join("")}</div>`,
    `Home &gt; Devices &amp; Displays Management &gt; <b>${esc(p.store)} / ${esc(p.display)}</b>`, "Displays & Devices");
}
async function typeTag(sel, v, id) { const el = q(sel); await click(el, id); el.querySelector(".ph")?.remove(); el.insertAdjacentHTML("beforeend", `<span class="tyx"></span>`); const tx = el.querySelector(".tyx"); await typeInto(tx, v, id, 14); tx.remove(); addTag(sel, v); }
async function focusRow(el, id) { const sc = q("#sc"); if (!sc) return; const r = el.getBoundingClientRect(), s = sc.getBoundingClientRect(); await scrollTo(TOP + (r.top - s.top)/S.scale - sc.clientHeight*0.2, id); }

const STEPS3 = [
 { t:"Target the reason for visit", s:"Open the Gold members campaign's Targeting tab. Add a Visitor / Customer Data rule on Reason for Visit (Individual), using the same reasons customers choose when they join the queue.",
   enter(){ paint(targetScreen([])); },
   async play(id){ const p=P3(), r=p.r1; await wait(500,id);
     tip(q("#ctitle"),"A campaign for high-value customers",`${D().name} is a separate campaign, only for Loyalty Gold members. It gets its own visitor-level targeting rules.`,1); await wait(3600,id); hideTip();
     const tb=q("#addand"); await moveTo(tb,id); tip(tb,this.t,this.s,1); await wait(3000,id); hideTip(); await click(tb,id);
     q("#rules").innerHTML = rulesHTML([[,,,[]]]); await focusRow(q("#rg0"),id);
     await pick(q("#s0a"), SRC, r[0], id); setSel("#s0a", r[0]);
     await pick(q("#s0b"), ATTR[r[0]], r[1], id); setSel("#s0b", r[1]);
     await pick(q("#s0c"), OPS.seg, r[2], id); setSel("#s0c", r[2]);
     await pick(q("#s0d"), p.reasons, r[3][0], id); addTag("#s0d", r[3][0]);
     tip(q("#rg0"),"Linked to the check-in",`The values are the reasons on your queue form, so the campaign targets visitors who check in for ${r[3][0]}.`,1); await wait(3200,id); hideTip(); } },
 { t:"Add first-party and loyalty data", s:`Add more Visitor / Customer Data rules, ${S.ind === "pharmacy" ? "such as the Loyalty Gold segment from your own data or a front-of-house purchase category from your POS" : "such as the device type captured at check-in, age, or the Loyalty Gold segment from your own data"}, so the campaign plays only for the right customer.`,
   enter(){ paintRules(targetScreen([P3().r1])); },
   async play(id){ const p=P3();
     for (const [g, r, mode] of [[1, p.r2, p.r2mode], [2, p.r3, "text"]]) {
       const tb=q("#addand"); await moveTo(tb,id); if (g===1) { tip(tb,this.t,this.s,2); await wait(3000,id); hideTip(); } await click(tb,id);
       const rules=[p.r1]; if (g===2) rules.push(p.r2); rules.push([,,,[]]); q("#rules").innerHTML = rulesHTML(rules); await focusRow(q("#rg"+g),id);
       await pick(q(`#s${g}a`), SRC, r[0], id); setSel(`#s${g}a`, r[0]);
       await pick(q(`#s${g}b`), ATTR[r[0]], r[1], id); setSel(`#s${g}b`, r[1]);
       await pick(q(`#s${g}c`), mode==="num" ? OPS.num : OPS.seg, r[2], id); setSel(`#s${g}c`, r[2]);
       q(`#s${g}d .ph`).textContent = mode==="tags" ? "Press Enter to add multiple values" : "Enter value"; await wait(500,id);
       if (mode!=="tags") { const v=q(`#s${g}d`); await click(v,id); v.innerHTML=""; await typeInto(v, r[3], id, mode==="num"?8:16); v.querySelector(".caret")?.remove(); }
       else await typeTag(`#s${g}d`, r[3][0], id);
       await wait(300,id);
     }
     tip(q("#rules"),"Visitor-level targeting",`Groups are joined with AND, so a visitor matches when all three are true: ${p.match}. Next, follow ${p.person} as she checks in.`,2); await wait(3800,id); hideTip();
     const sv=q("#save"); await click(sv,id); sv.className="btn dis"; sv.nextElementSibling.className="btn dis"; await wait(1000,id); } },
 { t:"The customer checks in", s:"Customers check in by joining a queue, scanning the QR code on a screen, arriving for a Click & Collect appointment, or being detected by proximity in your app. Each check-in identifies them in store.",
   enter(){ screen.innerHTML = sceneHTML(P3().first); hideTip(); },
   async play(id){ const p=P3(); await wait(700,id);
     if (p.first === "notif") { const n=q("#pnote"); n.classList.add("in"); await wait(900,id); tip(q("#pmeth"),this.t,`${p.person}'s phone is detected by proximity as she walks into ${p.store}, and your app invites her to join the queue.`,1); await wait(3400,id); hideTip(); await click(n,id); setPhone("home0"); await wait(1000,id); }
     else { tip(q("#pmeth"),this.t,`${p.person} scans the QR code on the ${p.display.toLowerCase()}, and your store site opens connected to that screen.`,1); await wait(3600,id); hideTip(); }
     await click(q("#pjoin"),id); setPhone("queue"); await wait(700,id);
     tip(q("#pstats"),"Join the Queue","The store site shows how many people are waiting and the estimated wait.",1); await wait(2600,id); hideTip();
     await click(q("#pq"),id); setPhone("form"); await wait(600,id);
     for (const [sel, val, cps] of [["#pf1", p.person, 14], ["#pf2", p.mobile, 24]]) { const f=q(sel); await click(f,id); f.classList.add("on"); await typeInto(f, val, id, cps); f.querySelector(".caret")?.remove(); f.classList.remove("on"); }
     const f3=q("#pf3"); await click(f3,id); f3.classList.add("on"); f3.insertAdjacentHTML("beforeend", `<div class="ss-dd" id="pdd">${p.reasons.map(r => `<div>${esc(r)}</div>`).join("")}</div>`); await wait(450,id);
     const o=[...q("#pdd").children].find(x => x.textContent === p.reason); await moveTo(o,id); o.classList.add("hov"); await wait(180,id); await click(o,id); q("#pdd").remove(); f3.classList.remove("on"); f3.querySelector(".val").textContent = p.reason; await wait(300,id);
     tip(f3,"Reason for visit",`${p.person} picks ${p.reason}, the value the campaign targets. It travels with her check-in.`,1); await wait(2800,id); hideTip();
     const sw=q("#psw"); await click(sw,id); sw.parentElement.insertAdjacentHTML("beforeend", `<div class="ss-pal" id="ppal">${["#111111","#FFFFFF","#9E9E9E","#D32F2F","#2E6FD8","#2E7D32","#F9A825","#7B4FA0"].map(c => `<i style="background:${c}" data-c="${c}"></i>`).join("")}</div>`); await wait(450,id);
     const ch=q(`#ppal [data-c="${p.top[0]}"]`); await moveTo(ch,id); ch.classList.add("hov"); await wait(200,id); await click(ch,id); q("#ppal").remove(); sw.querySelector("i").style.background = p.top[0]; await wait(300,id);
     tip(sw,"Colour of your top",`${p.person} picks ${p.top[1]}, the colour of her top, so staff can find her in store. She's free to shop and browse while she waits.`,3); await wait(3400,id); hideTip();
     await click(q("#pj2"),id); setPhone("home2"); await wait(700,id);
     tip(q("#pjoin"),"In the queue",`${p.person} is checked in at ${p.store} at ${p.time}, at position ${p.pos} in the queue.`,3); await wait(2800,id); hideTip();
     tip(q("#pcard"),"Her offer, straight away",`The moment she joins, ${D().name} is first in her carousel.`,3); await wait(3200,id); hideTip(); } },
 { t:"Her profile meets the rules", s:"The queue check-in captures the customer's reason for visit and device type, and links to what your CRM and loyalty program already hold. It's checked against every campaign's targeting rules the moment they join.",
   enter(){ screen.innerHTML = sceneHTML("home2","attrs"); hideTip(); },
   async play(id){ const p=P3(); await wait(1700,id); tip(q("#ptbl"),this.t,"Each row is a Visitor / Customer Data attribute. The moment she joins the queue, they're checked against the campaign's visitor rules.",4); await wait(4200,id); hideTip();
     tip(q("#pchk"),"Straight from the queue check-in",`Reason for Visit and Device Type are both captured when she joins the queue. She matches all three rules of the Gold members campaign: ${p.match}.`,4); await wait(3800,id); hideTip(); } },
 { t:"The targeted promotion appears", s:"As soon as the customer joins the queue, the targeted campaign appears in their store site carousel and plays on the screen in store.",
   enter(){ screen.innerHTML = sceneHTML("home2","promo"); hideTip(); },
   async play(id){ const p=P3(), d=D(); await wait(700,id);
     tip(q("#pcard"),this.t,`${d.name} is first in ${p.person}'s store site carousel, picked by the visitor rules.`,5); await wait(3600,id); hideTip();
     const tv=q("#pdisp"); tv.classList.add("on"); if (p.shelf) tv.innerHTML = shelfSVG(true); else tv.querySelector(".tv-in").innerHTML = art("land","first",S.bright); await wait(900,id);
     tip(p.shelf ? q("#shelfedge") : tv, p.display, p.shelf ? `${p.person} is free to browse while she waits. The smart shelf in the ${p.shelf}, where she is now, plays the same campaign for her.` : `The ${p.display.toLowerCase()} she scanned to check in plays the same campaign.`,5); await wait(4000,id); hideTip();
   } },
 { t:"Staff pick them up", s:"When it's their turn, the customer's store site shows who is coming to help. The staff member's Retail Admin opens the Visitor Details view with today's visit, the customer's insights and the offer they were shown.",
   enter(){ screen.innerHTML = sceneHTML("served","served"); hideTip(); },
   async play(id){ const p=P3();
     await wait(900,id); tip(q("#pserved"),"Ready to help",`${p.staff} picks ${p.person} up from the queue, and her store site shows who is coming to help her.`,6); await wait(3800,id); hideTip();
     screen.innerHTML = visitorHTML(); await wait(1000,id);
     tip(q("#vdvisit"),"Today's visit",`Her reason for visit and the colour of her top, so ${p.staff} can find her ${p.findAt}.`,6); await wait(3600,id); hideTip();
     tip(q("#vdins"),"Visitor insights","What your CRM, website and loyalty program hold about her, sent through the Visitor API.",6); await wait(3600,id); hideTip();
     tip(q("#vdrec"),"Her offer, surfaced to staff",`The Gold members offer she was shown is the top recommendation, so ${p.staff} can open with it.`,6); await wait(3800,id); hideTip();
     const pv=q("#vdplay"); await moveTo(pv,id); tip(pv,"Play Promo on Video Wall",`One tap plays the offer on the video wall while ${p.staff} talks ${p.person} through it.`,6); await wait(3400,id); hideTip(); showEnd(); } }
];

/* ================= fuel & convenience walkthrough: the retailer's own campaign, five scenes across four screen locations =================
   Only used on /industries/convenience/tour/. Every asset below is drawn in code (inline SVG and CSS); no raster or video asset is generated. */
const CV = (() => {
  const LOCS = [
    { k: "fore", icon: "local_gas_station", name: "Driveway screens", sub: "Forecourt" },
    { k: "shop", icon: "storefront", name: "Shop front", sub: "Entrance" },
    { k: "cool", icon: "kitchen", name: "Coolers", sub: "Cold drinks" },
    { k: "pos", icon: "point_of_sale", name: "POS", sub: "Checkout" }
  ];
  const CENTERS = [258, 559, 790, 1047]; // x centre of each screen in the scene 4 row
  const GEN = {
    fore: [["local_car_wash", "Car wash $8", "Drive in, drive out clean", "#27508f"], ["lunch_dining", "Fresh sandwiches", "Made this morning", "#7a3b8f"]],
    shop: [["propane_tank", "Gas bottle swap", "Swap and go in two minutes", "#1f6b5d"], ["smartphone", "Phone top-ups", "Any network, any amount", "#8a3a3a"]],
    cool: [["local_drink", "2 for $5", "Energy drinks", "#0d5c7a"], ["water_drop", "3 for $6", "Still water 1.5L", "#2c4f9e"]],
    pos: [["loyalty", "Join rewards", "Ask about our loyalty app", "#6a3d8f"], ["local_fire_department", "Hot food", "Ready now at the counter", "#9a4a14"]]
  };
  const OFFER = {
    fore: { icon: "local_cafe", tag: "Morning deal", head: "Coffee + pastry $6", sub: "Fresh inside, steps from the pump" },
    shop: { icon: "local_cafe", tag: "Morning deal", head: "Coffee + pastry $6", sub: "Fresh from the oven, at the coffee bar" },
    cool: { icon: "local_cafe", tag: "Morning deal", head: "Coffee + pastry $6", sub: "Add a cold drink to go" },
    pos: { icon: "local_cafe", tag: "Morning deal", head: "Coffee + pastry $6", sub: "Ask for the morning deal" }
  };
  const PERS = {
    fore: { icon: "workspace_premium", tag: "Gold member · Pump 4", head: "Welcome back, Sam", sub: "Your usual flat white and pastry, $6 today" },
    shop: { icon: "workspace_premium", tag: "Just for you", head: "Sam, your coffee + pastry is ready to order", sub: "Fresh from the oven, to your left" },
    cool: { icon: "workspace_premium", tag: "Goes with your deal", head: "Sam, add a cold drink", sub: "$1 off with your coffee + pastry" },
    pos: { icon: "workspace_premium", tag: "Deal applied", head: "Coffee + pastry $6.00", sub: "Sam, you saved $2.50 and earned 60 points" }
  };
  const cup = `<svg class="cup" viewBox="0 0 120 90" aria-hidden="true"><ellipse cx="50" cy="80" rx="42" ry="6" fill="rgba(0,0,0,.25)"/><path d="M14 30h64v22c0 14-10 24-32 24S14 66 14 52z" fill="#fff"/><path d="M78 36h8c10 0 10 20 0 20h-9" fill="none" stroke="#fff" stroke-width="6"/><path d="M26 28c0-8 10-8 10-16M44 28c0-8 10-8 10-16" fill="none" stroke="#ffd9a8" stroke-width="4" stroke-linecap="round"/><path d="M84 68c8-16 30-16 36 0-9 9-28 9-36 0z" fill="#f2b45a"/><path d="M93 63l5 11M102 61l3 13M111 63l-1 11" stroke="#c9822a" stroke-width="2.5" stroke-linecap="round"/></svg>`;
  if (IS_RM) {
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
  };
  const tile = (l, mode, i) => `<div class="cv-tile ${l.k}"><div class="cv-scr" id="cvs-${l.k}">${ad(l.k, mode, i)}</div></div>`;
  const label = l => `<div class="cv-lab"><span class="ms">${l.icon}</span><span>${l.name}<small>${l.sub}</small></span></div>`;
  const row = (mode, i) => `<div class="cv-row" id="cvrow">${LOCS.map(l => `<div class="cv-loc" id="cvl-${l.k}">${tile(l, mode, i)}${label(l)}</div>`).join("")}</div>`;
  const head = sc => `<div class="cv-top"><div class="cv-logo"><i style="background:${C()}">${esc(initials(B()))}</i>${esc(B())}</div><div class="cv-sc">${sc}</div></div>`;
  const root = inner => `<div class="cv${IS_RM ? " rm" : ""}" style="--cva:${D().accent}">${inner}</div>`;
  const title = (h, s) => `<div class="cv-title"><b>${esc(h)}</b>${s ? `<span>${esc(s)}</span>` : ""}</div>`;
  const setTile = (k, mode, i) => { const e = q("#cvs-" + k); if (e) e.innerHTML = ad(k, mode, i); };
  const rotate = (i) => LOCS.forEach(l => IS_RM && i % 3 === 0 ? setTile(l.k, "cre") : setTile(l.k, "gen", IS_RM ? (i % 3) - 1 : i));

  /* scene 4: one member, four screens */
  const stops = () => `<div class="cv-track" id="cvtrack"><div class="cv-line" style="left:${CENTERS[0]}px;width:${CENTERS[3] - CENTERS[0]}px"></div><div class="cv-lf" id="cvlf" style="left:${CENTERS[0]}px"></div>
    ${CENTERS.map((x, i) => `<div class="cv-stop" id="cvst${i}" style="left:${x}px">${i + 1}</div>`).join("")}<div class="cv-me" id="cvme" style="left:${CENTERS[0]}px"><i>${esc(P3().person[0])}</i></div></div>`;
  const scene4 = (mode) => root(head("The shopper journey") + title(IS_RM ? "Emma's Frostline offer follows her through the shop" : "Sam's offer follows her through the shop") + stops() + row(mode || "cre", 0));
  async function visit(i, id, fast) {
    const k = LOCS[i].k;
    if (i > 0) { setTile(LOCS[i - 1].k, "cre"); q("#cvl-" + LOCS[i - 1].k).classList.remove("on"); }
    q("#cvme").style.left = CENTERS[i] + "px"; q("#cvlf").style.width = (CENTERS[i] - CENTERS[0]) + "px";
    await wait(fast ? 700 : 1200, id);
    for (let n = 0; n <= i; n++) q("#cvst" + n).classList.add("on");
    q("#cvl-" + k).classList.add("on"); setTile(k, "per");
  }

  const STEP = {
    t: "The offer follows her through the shop", s: "Every screen starts on the generic promotions loop. Once Sam is recognised at pump 4, her offer follows her from the forecourt to the shop front, the coolers and the POS, personalised in real time.",
    enter() { screen.innerHTML = scene4("gen"); hideTip(); },
    async play(id) { await wait(900, id);
      for (let i = 1; i <= 2; i++) { rotate(i); await wait(1500, id); }
      tip(q("#cvrow"), "Before: one loop on every screen", "Forecourt, shop front, coolers and POS play the same generic promotions, whoever is standing in front of them.", 5); await wait(3800, id); hideTip();
      LOCS.forEach(l => setTile(l.k, "cre")); await wait(700, id);
      q("#cvtrack").insertAdjacentHTML("beforeend", `<div class="cv-rec" id="cvrec" style="left:${CENTERS[0]}px"><span class="ms">workspace_premium</span>Sam · Gold member recognised at pump 4</div>`);
      await visit(0, id, true);
      tip(q("#cvl-fore"), "Recognised at the pump", "Sam fuels up and her loyalty app checks her in. The driveway screen greets her by name with her usual order.", 5); await wait(4200, id); hideTip();
      q("#cvrec").remove(); await visit(1, id);
      tip(q("#cvl-shop"), "Waiting at the shop front", "As she walks to the door, the shop front screen takes over with the same deal and where to find it.", 5); await wait(3800, id); hideTip();
      await visit(2, id);
      tip(q("#cvl-cool"), "At the coolers", "Passing the coolers, the screen adds a cold drink to the deal she is already planning to buy.", 5); await wait(3800, id); hideTip();
      await visit(3, id);
      tip(q("#cvl-pos"), "At the POS", "The deal is applied at the till and her points are added, without her asking.", 5); await wait(4200, id); hideTip(); } };

  const RMSTEP = {
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
  const TEASE = [{ cap: IS_RM ? "One brand partner slot in every rotation, personalised for a loyalty member" : "The offer follows a loyalty member from the pump to the till", async run(id) {
    S.flow = 0; screen.innerHTML = scene4(); await wait(600, id);
    for (let i = 0; i < 4; i++) { await visit(i, id, true); await wait(900, id); }
    await wait(900, id); } }];

  return { STEP, TEASE, RMSTEP };
})();

/* Flow 3 for fuel & convenience: loyalty check-in at the pump instead of a queue. Same screens as the other industries, with the four-location shopper scene in the middle. */
const STEPS3C = [
 { t:"Target your loyalty members", s:"Open the Gold members campaign's Targeting tab. Add a Visitor / Customer Data rule on Audience / Segments, using the loyalty tiers from your own program.",
   enter(){ paint(targetScreen([])); },
   async play(id){ const p=P3(), r=p.r1; await wait(500,id);
     tip(q("#ctitle"),"A campaign for loyalty members",`${D().name} is a separate campaign, only for Loyalty Gold members. It gets its own visitor-level targeting rules.`,1); await wait(3600,id); hideTip();
     const tb=q("#addand"); await moveTo(tb,id); tip(tb,this.t,this.s,1); await wait(3000,id); hideTip(); await click(tb,id);
     q("#rules").innerHTML = rulesHTML([[,,,[]]]); await focusRow(q("#rg0"),id);
     await pick(q("#s0a"), SRC, r[0], id); setSel("#s0a", r[0]);
     await pick(q("#s0b"), ATTR[r[0]], r[1], id); setSel("#s0b", r[1]);
     await pick(q("#s0c"), OPS.seg, r[2], id); setSel("#s0c", r[2]);
     await pick(q("#s0d"), p.reasons, r[3][0], id); addTag("#s0d", r[3][0]);
     tip(q("#rg0"),"Linked to your loyalty program",`The values are the tiers your loyalty program already holds, so the campaign targets ${r[3][0]} members.`,1); await wait(3200,id); hideTip(); } },
 { t:"Add purchase history", s:"Add a second rule from your POS data: Purchase History includes coffee. The campaign plays only for loyalty members who buy coffee.",
   enter(){ paintRules(targetScreen([P3().r1])); },
   async play(id){ const p=P3(), r=p.r2;
     const tb=q("#addand"); await moveTo(tb,id); tip(tb,this.t,this.s,2); await wait(3000,id); hideTip(); await click(tb,id);
     q("#rules").innerHTML = rulesHTML([p.r1, [,,,[]]]); await focusRow(q("#rg1"),id);
     await pick(q("#s1a"), SRC, r[0], id); setSel("#s1a", r[0]);
     await pick(q("#s1b"), ATTR[r[0]], r[1], id); setSel("#s1b", r[1]);
     await pick(q("#s1c"), OPS.seg, r[2], id); setSel("#s1c", r[2]);
     q("#s1d .ph").textContent = "Enter value"; await wait(400,id);
     const v=q("#s1d"); await click(v,id); v.innerHTML=""; await typeInto(v, r[3], id, 16); v.querySelector(".caret")?.remove(); await wait(300,id);
     tip(q("#rules"),"Visitor-level targeting",`Groups are joined with AND, so a visitor matches when both are true: ${p.match}. Next, follow ${p.person} to the pump.`,2); await wait(3800,id); hideTip();
     const sv=q("#save"); await click(sv,id); sv.className="btn dis"; sv.nextElementSibling.className="btn dis"; await wait(1000,id); } },
 { t:"The shopper checks in at the pump", s:"Loyalty members check in at the pump with the app, their card or a QR code. Each check-in identifies them, so the screens can respond to them.",
   enter(){ screen.innerHTML = sceneHTML(P3().first); hideTip(); },
   async play(id){ const p=P3(); await wait(700,id);
     const n=q("#pnote"); n.classList.add("in"); await wait(900,id);
     tip(q("#pmeth"),this.t,`${p.person}'s phone is detected by proximity at pump 4, and your loyalty app invites her to check in.`,3); await wait(3400,id); hideTip();
     await click(n,id); setPhone("pump"); await wait(900,id);
     tip(q("#pcheck"),"Checked in",`${p.person} is checked in at pump 4 of ${p.store} at ${p.time} AM as a Gold member.`,3); await wait(2800,id); hideTip();
     tip(q("#pcard"),"Her offer, straight away",`The moment she checks in, ${D().name} is first in her app.`,3); await wait(3200,id); hideTip(); } },
 { t:"Her profile meets the rules", s:"The pump check-in links to what your loyalty program and POS already hold. It is checked against every campaign's targeting rules the moment she checks in.",
   enter(){ screen.innerHTML = sceneHTML("pump","attrs"); hideTip(); },
   async play(id){ const p=P3(); await wait(1700,id); tip(q("#ptbl"),this.t,"Each row is a Visitor / Customer Data attribute. The moment she checks in, they are checked against the campaign's visitor rules.",4); await wait(4200,id); hideTip();
     tip(q("#ptbl"),"A match on both rules",`She matches both rules of the Gold members campaign: ${p.match}.`,4); await wait(3600,id); hideTip(); } },
 CV.STEP,
 { t:"Staff see the visit in Retail Admin", s:"In Retail Admin, the Visitor Details view shows today's visit, her insights from your loyalty program and the offer she was shown, so staff can greet her with it at the coffee bar.",
   enter(){ screen.innerHTML = visitorHTML(); hideTip(); },
   async play(id){ const p=P3();
     await wait(1000,id);
     tip(q("#vdvisit"),"Today's visit",`Her reason for visit and the fuel she bought, so ${p.staff} can greet ${p.person} ${p.findAt}.`,6); await wait(3600,id); hideTip();
     tip(q("#vdins"),"Visitor insights","What your loyalty program and POS hold about her, sent through the Visitor API.",6); await wait(3600,id); hideTip();
     tip(q("#vdrec"),"Her offer, surfaced to staff",`The Gold members offer she was shown is the top recommendation, so ${p.staff} can open with it.`,6); await wait(3800,id); hideTip(); showEnd(); } }
];


/* ================= retail media voiceover =================
   Each step has one or more lines (vo/<step>-<line>-<hash>.mp3, built offline with Kokoro by build_voiceover.py), played
   through a single audio element so two lines can never overlap. A line without a cue starts the step or follows the
   line before it; a line with a cue starts when the tip with that title appears. If a cue comes while a line is still
   playing, the tour holds (S.voHold stops wait() counting) until the line ends, so words and screens stay in step.
   Off by default: it only turns on from the speaker button, and the choice is remembered. The current line is also the
   caption under the tour, timed the same way, so the tour reads the same with audio off. */
const VO = IS_RM ? (() => {
  const CLIPS = {"f1-01": [{"file": "f1-01-1-4e6a1cf7d9.mp3", "text": "The retailer has four screen types: forecourt, shop front, cooler doors and point of sale.", "duration": 5.53, "cue": null}], "f1-02": [{"file": "f1-02-1-019cfa9967.mp3", "text": "Each one has its own playlist.", "duration": 1.71, "cue": null}, {"file": "f1-02-2-e1a1e04b87.mp3", "text": "First, the forecourt playlist is set to rotate three campaigns, one after another.", "duration": 4.8, "cue": "Three campaigns in rotation"}, {"file": "f1-02-3-88a9ceab86.mp3", "text": "New slots belong to Headquarters, for the retailer's own promotions.", "duration": 4.01, "cue": "Three slots, all Headquarters"}, {"file": "f1-02-4-41211815ee.mp3", "text": "Slot one is the one the retailer will sell to brands.", "duration": 3.03, "cue": "Slot 1 goes to advertisers"}, {"file": "f1-02-5-9f9d0e125b.mp3", "text": "Its owner changes from Headquarters to Advertiser.", "duration": 3.01, "cue": "From Headquarters to Advertiser"}, {"file": "f1-02-6-94ca378e3f.mp3", "text": "One slot in three now earns media revenue, and two keep promoting the retailer's own offers.", "duration": 5.65, "cue": "One advertiser slot in three"}], "f1-03": [{"file": "f1-03-1-d4761b039d.mp3", "text": "Shop front, cooler doors and point of sale get the same setup, in a few clicks.", "duration": 4.63, "cue": null}, {"file": "f1-03-2-e70fb76ac7.mp3", "text": "The retailer decides exactly how much screen time it sells.", "duration": 3.26, "cue": null}, {"file": "f1-03-3-b1b956b775.mp3", "text": "Four brand partner slots, one on every screen type, are now ready to sell.", "duration": 4.48, "cue": "Four advertiser slots, ready to sell"}], "f1-04": [{"file": "f1-04-1-5d3ff27ede.mp3", "text": "Frostline Cold Drinks is already set up as a direct advertiser, next to the advertisers synced from DSPs.", "duration": 7.02, "cue": null}], "f1-05": [{"file": "f1-05-1-815ef1fcf7.mp3", "text": "Slots are always sold through deals. A brand is never assigned to a slot directly.", "duration": 4.93, "cue": null}, {"file": "f1-05-2-a895affdb3.mp3", "text": "This direct deal gives Frostline all of December at a fixed CPM, and it's never sent to a DSP.", "duration": 6.04, "cue": "Create a direct deal"}], "f1-06": [{"file": "f1-06-1-bb4dc242cd.mp3", "text": "The four new brand partner slots start unassigned, so nothing plays in them yet.", "duration": 4.46, "cue": null}, {"file": "f1-06-2-b979dd0bac.mp3", "text": "Frostline's deal is saved as a draft, ready to place on the slots.", "duration": 3.97, "cue": "The new deal, not on a slot yet"}, {"file": "f1-06-3-920ae8dfd8.mp3", "text": "Each slot's list offers DSPs for open auction, and deals.", "duration": 3.99, "cue": "Choose the deal"}, {"file": "f1-06-4-70953acd20.mp3", "text": "The retailer picks the Frostline deal for all four.", "duration": 2.75, "cue": null}, {"file": "f1-06-5-9d85756903.mp3", "text": "Direct deals and programmatic demand are managed side by side, in one place.", "duration": 5.08, "cue": null}, {"file": "f1-06-6-0a6c6b9bc2.mp3", "text": "All four slots now carry the deal, and the deal shows four slots. Then, save the changes.", "duration": 5.61, "cue": "All four brand partner slots"}], "f1-07": [{"file": "f1-07-1-1007aa5f04.mp3", "text": "The forecast plays are for reference only: this is a direct buy at a fixed CPM.", "duration": 5.08, "cue": null}, {"file": "f1-07-2-810f46105a.mp3", "text": "Finalising puts the deal live, and its revenue is reported just like DSP revenue.", "duration": 5.55, "cue": "Finalise and go live"}, {"file": "f1-07-3-5dc08dbfb1.mp3", "text": "Every December window on all four screen types is now Frostline's.", "duration": 4.03, "cue": "Live · direct, not sent to a DSP"}], "f1-08": [{"file": "f1-08-1-59e0868c89.mp3", "text": "Finally, the retailer gives Frostline its own login, so the brand can manage its own campaigns.", "duration": 5.67, "cue": null}, {"file": "f1-08-2-37fde762a7.mp3", "text": "Alex gets the Advertiser role, so Alex only ever sees Frostline's campaigns.", "duration": 4.84, "cue": "An Advertiser login for Frostline"}, {"file": "f1-08-3-6623a4af25.mp3", "text": "The invitation goes out, and the retailer's first brand partner deal is done.", "duration": 4.33, "cue": "Send the invitation"}], "f2-01": [{"file": "f2-01-1-15e22e5b99.mp3", "text": "Alex from Frostline signs in with the login the retailer provided. Frostline can run its own campaigns, or leave them to the retailer.", "duration": 8.64, "cue": null}, {"file": "f2-01-2-b34e26f837.mp3", "text": "Everything Alex sees is scoped to Frostline's own campaigns.", "duration": 3.67, "cue": "Only Frostline's campaigns"}], "f2-02": [{"file": "f2-02-1-311f6763bd.mp3", "text": "To start a new campaign, Alex selects Launch a New Campaign, at the top of the list.", "duration": 4.76, "cue": null}], "f2-03": [{"file": "f2-03-1-9af0217766.mp3", "text": "There's no form to fill in. Alex just talks, and the AI campaign agent listens.", "duration": 5.12, "cue": null}, {"file": "f2-03-2-045001ee62.mp3", "text": "As Alex speaks, it captures the campaign name, products, objective, screens and audience.", "duration": 5.4, "cue": null}, {"file": "f2-03-3-31c7a5a55a.mp3", "text": "A whole campaign brief, in the time it takes to describe it.", "duration": 3.24, "cue": null}], "f2-04": [{"file": "f2-04-1-f01e28545d.mp3", "text": "The agent writes the brief from what Alex said, and from how past campaigns performed.", "duration": 4.74, "cue": null}, {"file": "f2-04-2-635ecc078c.mp3", "text": "It's ready in seconds, with nothing typed by hand.", "duration": 2.86, "cue": null}, {"file": "f2-04-3-0335984f58.mp3", "text": "Frostline's deal ID is pre-selected, so the campaign can only use the slots on that deal.", "duration": 5.65, "cue": "Deal ID, pre-selected"}, {"file": "f2-04-4-7ded1c15ea.mp3", "text": "Name, details, products, audience and objective are all filled in.", "duration": 4.22, "cue": "Campaign brief"}, {"file": "f2-04-5-15b9d9f7aa.mp3", "text": "Only the deal's four screen types are switched on.", "duration": 2.47, "cue": "Touchpoints"}], "f2-05": [{"file": "f2-05-1-72ad9f5f21.mp3", "text": "Next, the agent writes the headline and copy from the agreed brand guidelines: Frostline's, the retailer's, or an agreed mix of both.", "duration": 8.36, "cue": null}, {"file": "f2-05-2-67ab4ee24b.mp3", "text": "Every word can be edited before any creative is made.", "duration": 3.01, "cue": "Storyboard and copy"}], "f2-06": [{"file": "f2-06-1-247e067fe8.mp3", "text": "With the copy agreed, the agent generates a creative preview of the first and last frames.", "duration": 5.29, "cue": null}, {"file": "f2-06-2-a80f61db0a.mp3", "text": "The frames follow the agreed brand guidelines, and draw on what worked best in past campaigns.", "duration": 5.59, "cue": "Generating the preview"}, {"file": "f2-06-3-66c9dde6be.mp3", "text": "Not quite right? Alex asks for a change in plain English, like a brighter background for daytime forecourts.", "duration": 6.36, "cue": "Refine in plain English"}, {"file": "f2-06-4-a4c96f7f72.mp3", "text": "And the frame is regenerated with the change.", "duration": 2.5, "cue": "Updated"}], "f2-07": [{"file": "f2-07-1-b40b0f835d.mp3", "text": "Generate Creative Assets builds the final creative for every screen type: forecourt, shop front, cooler doors and point of sale.", "duration": 8.11, "cue": null}, {"file": "f2-07-2-0cb584fce6.mp3", "text": "Once the approved campaign runs, its results feed Frostline's future campaigns, closing the loop.", "duration": 5.82, "cue": "Assets for every touchpoint"}], "f2-08": [{"file": "f2-08-1-c4db39ce74.mp3", "text": "Frostline also wants a second campaign, just for Gold members.", "duration": 3.82, "cue": null}, {"file": "f2-08-2-dff38479d0.mp3", "text": "Targeting is set on the campaign's Targeting tab, exactly as the retailer would.", "duration": 4.8, "cue": "Open the Targeting tab"}, {"file": "f2-08-3-1cdbf597cd.mp3", "text": "Alex adds a rule: Audience Segments includes Loyalty Gold.", "duration": 3.73, "cue": "Target Loyalty Gold members"}, {"file": "f2-08-4-290178c496.mp3", "text": "Every option is a drop-down, so there's nothing to type and nothing to get wrong.", "duration": 4.61, "cue": null}, {"file": "f2-08-5-860c310ff2.mp3", "text": "Only the data sources, attributes and values the retailer has approved for brands appear here.", "duration": 5.55, "cue": null}, {"file": "f2-08-6-5524f565de.mp3", "text": "The retailer controls 100% of the targeting it shares.", "duration": 3.71, "cue": "Controlled by the retailer"}, {"file": "f2-08-7-f3e248ff41.mp3", "text": "The data stays in the retailer's own cloud. Frostline only ever picks a segment.", "duration": 4.78, "cue": "The retailer's loyalty tiers"}], "f2-09": [{"file": "f2-09-1-971fb8ad70.mp3", "text": "A second rule adds purchase history from the retailer's point-of-sale data.", "duration": 4.44, "cue": null}, {"file": "f2-09-2-466469aa88.mp3", "text": "Purchase History includes cold drinks, again picked from a list.", "duration": 3.54, "cue": null}, {"file": "f2-09-3-236dd2d126.mp3", "text": "Targeting on real loyalty and sales data is what makes in-store media so valuable, to brands and to the retailer.", "duration": 7.42, "cue": null}, {"file": "f2-09-4-a1ce565bd2.mp3", "text": "Gold members who buy cold drinks match both rules, and Alex saves the targeting with Save Changes.", "duration": 6.08, "cue": "Both rules in place"}, {"file": "f2-09-5-21b66dfcda.mp3", "text": "Saving doesn't submit anything. Send for approval, at the top right, sends the campaign to the retailer.", "duration": 5.97, "cue": "Send for approval"}, {"file": "f2-09-6-25ad0a8b40.mp3", "text": "It's now awaiting approval, with no activation toggle until the retailer approves it.", "duration": 5.16, "cue": "Awaiting approval"}], "f2-10": [{"file": "f2-10-1-f1dabdfa14.mp3", "text": "Every brand campaign needs the retailer's approval before it can play. Frostline's is waiting in Campaign Approval.", "duration": 7.0, "cue": null}, {"file": "f2-10-2-81cd7ddf45.mp3", "text": "One click on Approve Selected, and Frostline's Gold campaign is approved, with its own creative ID.", "duration": 6.31, "cue": "Approve Selected"}, {"file": "f2-10-3-2dbaa4ce3a.mp3", "text": "Once it's approved, the activation toggle appears in place of Send for approval.", "duration": 4.65, "cue": "Ready to activate"}], "f3-01": [{"file": "f3-01-1-efdcdb2629.mp3", "text": "Emma, a Gold loyalty member, pulls in to Highway 9 Services.", "duration": 3.88, "cue": null}, {"file": "f3-01-2-ca603efc83.mp3", "text": "The retailer's loyalty app welcomes her by name and invites her to check in.", "duration": 4.46, "cue": "Welcome to Highway 9 Services"}, {"file": "f3-01-3-e90e3201e3.mp3", "text": "One tap, and she's checked in.", "duration": 1.64, "cue": "Checked in"}, {"file": "f3-01-4-069ece1be1.mp3", "text": "Frostline's Gold offer is first in her app.", "duration": 2.67, "cue": "Frostline's offer, in the retailer's app"}], "f3-02": [{"file": "f3-02-1-4830a706b9.mp3", "text": "Her check-in links to what the retailer already knows: her loyalty tier and what she buys.", "duration": 5.03, "cue": null}, {"file": "f3-02-2-ad4c89c794.mp3", "text": "She matches both of Frostline's rules, in real time.", "duration": 3.18, "cue": "A match on both rules"}], "f3-03": [{"file": "f3-03-1-97fe869e29.mp3", "text": "Every screen rotates three campaigns: two for the retailer, and the brand partner slot.", "duration": 5.18, "cue": null}, {"file": "f3-03-2-c148af44ba.mp3", "text": "Most shoppers see Frostline's standard creative in that slot.", "duration": 3.14, "cue": "Three campaigns in every rotation"}, {"file": "f3-03-3-ece7bb359f.mp3", "text": "But not Emma.", "duration": 0.94, "cue": null}, {"file": "f3-03-4-70568d93b3.mp3", "text": "Recognised at the pump, she sees Frostline's Gold version, personalised for her.", "duration": 4.71, "cue": "Recognised at the pump"}, {"file": "f3-03-5-1592073a36.mp3", "text": "At the shop front, the same campaign points her to the cooler doors, right next to her.", "duration": 4.67, "cue": "At the shop front"}, {"file": "f3-03-6-21b34710c5.mp3", "text": "At the cooler doors, right where the drinks are: a free upsize on every Frostline.", "duration": 4.61, "cue": "At the cooler doors"}, {"file": "f3-03-7-3874b1ce8d.mp3", "text": "And at the till, her upsize is applied. One shopper, four screens, one joined-up offer.", "duration": 5.27, "cue": "At the POS"}], "f3-04": [{"file": "f3-04-1-80ffd5f1b7.mp3", "text": "Behind the scenes, Frostline holds slot one on all four screen types, every day of December.", "duration": 5.74, "cue": null}, {"file": "f3-04-2-7d6c8730ed.mp3", "text": "Each booking carries the default creative and the personalised Gold version, both approved.", "duration": 5.33, "cue": "Default plus personalised"}], "f3-05": [{"file": "f3-05-1-b9f1e531a3.mp3", "text": "Booking revenue shows what the slots earn: every window sold, at Frostline's fixed CPM.", "duration": 5.61, "cue": null}, {"file": "f3-05-2-59b67e01b8.mp3", "text": "That's over 67 thousand dollars in two weeks, from one slot in three.", "duration": 4.42, "cue": "USD 67,494 in two weeks"}]}, BASE = window.PH_TOUR_VO || RM_ASSETS + "vo/", KEY = "ph_tour_voiceover", GAP = 160;
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
  /* "Enable sound" hint: a flow that starts with the voiceover off first shows, for 3 s, a bubble above the speaker button
     pointing to it while the button pulses. Clicking the button or the bubble turns sound on and starts at once. */
  let hintT = 0, hintGo = null;
  function hideHint() { clearTimeout(hintT); hintGo = null; btn.classList.remove("pulse"); const t = document.getElementById("vohint"); if (t) t.remove(); }
  function hint(start) {
    hideHint(); if (on || grp.hidden) return start();
    const r = RUN, tip = document.createElement("div"); tip.id = "vohint"; tip.className = "vohint"; tip.setAttribute("role", "status");
    tip.innerHTML = `<span class="ms">volume_up</span>Enable sound`;
    grp.appendChild(tip); btn.classList.add("pulse");
    const go2 = () => { const live = hintGo; hideHint(); if (live && RUN === r) start(); };
    hintGo = go2; tip.onclick = () => { if (!on) btn.click(); else go2(); };
    hintT = setTimeout(go2, 3000);
  }
  function stop() { hideHint(); tok++; a.pause(); if (st) log("stop", { k: st.k }); st = null; S.voHold = false; }
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
    const pend = hintGo;
    on = !on; try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) {}
    log("toggle", { on }); paint();
    if (pend) return pend();
    if (!st) return;
    if (on) { warm(); if (st.busy) play(st.i); }
    else { a.pause(); st.q = []; S.voHold = false; if (st.busy) finished(st.t, st.i); }
  });
  S.voCue = cue;
  paint();
  return { step, stop, sync, done, warm, hint, get on() { return on; },
    text: (f, i) => { const k = keyOf(f, i); return st && st.k === k && st.i >= 0 ? st.lines[st.i].text : ((CLIPS[k] || [])[0] || {}).text; } };
})() : null;

/* ================= retail media: a convenience retailer sells its screens to a brand =================
   Retailer steps are screenshots of HQ Admin's retail media screens (img/*.jpg, 1600x950 = the stage at 0.8);
   HOT holds each screenshot's click target and the regions the tips point at. Advertiser steps reuse the PH Core campaign screens. */
const RM = IS_RM ? (() => {
  /* Captions change line by line with the voiceover: two lines are always reserved and, below 1080px, the caption sits on its own row under the controls, so the controls never move. */
  document.documentElement.classList.add("ph-rm");
  const SC = 0.8, HOT = {"P1-display-types":[256,344,249,46],"P1-display-types#list":[524,212,260,342],"P2-playlists":[537,255,24,24],"P3-three-slots":[552,701,1002,32],"P4-owner":[1185,577,353,32],"P5-forecourt":[537,680,24,24],"P5-forecourt#slots":[616,513,926,108],"P6-shopfront":[537,680,24,24],"P6-shopfront#slots":[616,513,926,108],"P7-coolers":[537,680,24,24],"P7-coolers#slots":[616,513,926,108],"P8-pos":[1464,704,118,32],"P8-pos#slots":[616,513,926,108],"P9-saved":[256,390,249,46],"P9-saved#badges":[1189,250,211,202],"01-advertiser":[559,826,101,18],"01-advertiser#row":[525,814,1095,42],"03-users":[1277,184,204,32],"04-add-user":[1056,602,88,32],"05-deals":[1375,171,208,32],"06-new-deal":[924,918,113,32],"06-new-deal#terms":[662,461,532,405],"07-assign-slot":[873,659,362,49],"07b-assigned-all":[1464,908,118,32],"07b-assigned-all#cells":[855,415,400,207],"08-deal-finalise":[1045,874,149,32],"08-deal-finalise#plays":[662,766,532,96],"09-deal-live":[540,305,100,18],"09-deal-live#row":[525,296,1058,52],"14-approval-table":[290,421,16,16],"14-approval-table#row":[275,402,414,56],"15-approve":[1018,233,125,24],"16-booking-schedule":[874,579,126,13],"16b-booking-flight":[450,584,190,18],"16b-booking-flight#rows":[275,376,1307,368],"07a-blank":[870,421,370,24],"07a-blank#cells":[855,415,400,207],"07a-blank#deal":[525,186,1058,52],"07-assign-slot#menu":[869,449,370,264],"07c1":[870,473,370,24],"07d2":[873,711,362,49],"07c2":[870,525,370,24],"07d3":[873,763,362,49],"07c3":[870,577,370,24],"07d4":[873,815,362,49],"22-booking-revenue":[1436,680,146,40],"22-booking-revenue#table":[274,648,1309,284],"22-booking-revenue#rev":[275,680,1307,252],"16-booking-schedule#pop":[802,89,250,544],"22-booking-revenue#total":[275,890,1307,40],"04-add-user#form":[712,338,432,215],"P2b-expanded":[548,534,1010,32],"P4a-slots":[1181,513,361,24],"P4a-slots#table":[616,513,926,108],"16-booking-schedule#top":[802,89,250,140]};
  const img = n => RM_IMG + n + ".jpg";
  /* Every screenshot (and the login background) is fetched and decoded up front and kept, so a swap never waits on the network or a decode. */
  const SHOTS = {};
  const pre = n => { if (!SHOTS[n]) { const i = new Image(); i.src = img(n); SHOTS[n] = i; if (i.decode) i.decode().catch(() => {}); } return SHOTS[n]; };
  ["login-bg", ...Object.keys(HOT).filter(k => !k.includes("#"))].forEach(pre);
  /* The screenshots were taken with the demo retailer's logo (sidebar and header badge, same place on every screen).
     When the visitor's company or colour differs, both are redrawn over the screenshot in its own pixel space. */
  const brandOv = () => {
    const b = B(), c = C(); if (b === RMI().brand && c === RMI().color) return "";
    const w = b.trim().split(/\s+/), ini = esc(initials(b)), l2 = w.slice(1).join(" ");
    return `<div class="rm-ov" aria-hidden="true"><div class="rm-ovb"><span class="rm-ovm" style="background:${c}">${ini}</span><span class="rm-ovn"><b>${esc(w[0])}</b>${l2 ? `<small>${esc(l2)}</small>` : ""}</span></div><div class="rm-ova"><span class="rm-ovm sm" style="background:${c}">${ini}</span></div></div>`;
  };
  /* A new screenshot never fades in over white: the screen on show stays on top until the new one is decoded,
     then fades out over it (a short crossfade). Only the first screen of a flow fades in. */
  let hold = null, holdFor = null;
  const dropHold = fade => { const h = hold; hold = holdFor = null; if (!h) return; if (!fade) return h.remove(); h.classList.add("out"); setTimeout(() => h.remove(), 200); };
  new MutationObserver(() => { if (hold && !screen.contains(holdFor)) dropHold(false); }).observe(screen, { childList: true });
  const show = n => {
    dropHold(false); pre(n);
    const prev = !!screen.firstElementChild;
    if (prev) { hold = document.createElement("div"); hold.className = "rm-hold"; hold.setAttribute("aria-hidden", "true"); while (screen.firstChild) hold.appendChild(screen.firstChild); hold.querySelectorAll(".rm-hs").forEach(e => e.remove()); screen.after(hold); }
    screen.innerHTML = `<div class="rm-shot${prev ? " swap" : ""}"><img src="${img(n)}" alt="" draggable="false">${brandOv()}</div>`; hideTip();
    if (prev) {
      const h = hold, im = screen.querySelector(".rm-shot img"); holdFor = im.parentNode;
      const out = () => { if (hold === h) dropHold(true); };
      (im.decode ? im.decode() : new Promise((ok, no) => { if (im.complete) ok(); else { im.onload = ok; im.onerror = no; } })).then(out, out);
      setTimeout(out, 1500);
    }
  };
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

/* ================= ui wiring ================= */
const FLOWDEF_STD = [
  { h1: "Launch a campaign just by talking", sub: "Talk the AI campaign agent through a campaign and watch it become a brief, copy, creative and screen-ready assets for every touchpoint, in your brand.",
    steps: STEPS, intro: () => paint(listScreen(false)),
    start: () => [`See ${esc(B())} launch a campaign just by talking`, "Talk through the campaign, then follow the AI campaign agent from brief to storyboard, creative and live screens."],
    end: () => { const d = D(); return ["Flow 1 complete", `${esc(B())} has a live campaign on ${IS_CONV ? "4 screen types" : "3 touchpoints"}`, `From a spoken brief to campaign brief, copy, creative and assets in ${d.stores} stores, with every play and view feeding closed-loop optimisation of the next campaign.`, [["1","spoken brief"],["4","asset formats"],[d.stores,"stores live"]], 1]; } },
  { h1: "Localise and schedule every campaign, store by store", sub: "Import your stores from Google Maps. Each one becomes a digital twin. Add store segments and assign them to stores, then localise and schedule campaigns store by store with those segments, opening hours and live data on who's in store.",
    steps: STEPS2, intro: () => paint(storesScreen(false)),
    start: () => [`See ${esc(B())} localise and schedule one campaign across every store`, "Import stores from Google Maps, see each one become a digital twin, create store segments and assign them to stores, localise the campaign with those segments and live data on who's in store, then schedule it around each store's opening hours."],
    end: () => { const l = L(); return ["Flow 2 complete", `${esc(B())} localises and schedules one campaign across ${l.total + l.existing.length} stores`, "Every store imported from Google Maps becomes a digital twin with its own store segments. Fixed segments decide which stores run the campaign, store managers suppress it when stock runs out, who's in store right now decides when it plays, and the schedule follows each store's opening hours.", [[l.total,"stores imported"],[l.segs.fixed.length + l.segs.variable.length,"store segments"],["3","targeting rules"]], 2]; } }
,
  { h1: "Personalise every screen to the customer in front of it", sub: "Target campaigns with your own first-party and loyalty data. When a customer checks in by queue, QR code, appointment or proximity, the targeted campaign reaches them on their phone and on the screen in store.",
    steps: IS_CONV ? STEPS3C : STEPS3, intro: () => paint(targetScreen([])),
    start: () => IS_CONV ? [`See ${esc(B())} personalise every screen for a loyalty member`, "Set up targeting for Loyalty Gold members who buy coffee, then follow Sam from the pump to the shop front, the coolers and the POS, with her offer on every screen."] : [`See ${esc(B())} personalise screens when a customer checks in`, "Set up visitor-level targeting on a campaign for Loyalty Gold members, using the reason for visit and your first-party and loyalty data, then follow a customer from check-in to the targeted promotion on her phone and the screen in store."],
    end: () => { const p = P3(); if (IS_CONV) return ["Walkthrough complete", `${esc(B())} personalises every screen for the member in front of it`, "A campaign for Loyalty Gold members who buy coffee. The moment Sam checks in at the pump, her offer follows her to the shop front, the coolers and the POS. Results are illustrative. The same screens can also be sold to advertisers as a retail media network.", [["3.2×","offer redemption (illustrative)"],["+$2.10","basket with the deal (illustrative)"],["4","screen locations"]], 0]; return ["Flow 3 complete", `${esc(B())} personalises the moment ${p.person} checks in`, "A campaign for Loyalty Gold members targets the reason for visit plus your own first-party and loyalty data. The moment she joins the queue, it appears in her store site carousel and plays on the screen in store, and staff see the offer and her profile when they pick her up.", [["3","visitor rules"],["1","check-in"],["3","touchpoints"]], 0]; } }
];
const FLOWDEF = IS_RM ? RM.FLOWDEF : FLOWDEF_STD;
const FD = () => FLOWDEF[S.flow], ST = () => FD().steps;
const dots = document.getElementById("dots"), flows = document.getElementById("flows");
flows.innerHTML = FLOWS.map((f,i)=>`<button type="button" class="chip" data-k="${i}" ${f[1]?"":'aria-disabled="true"'}><span class="n">${i+1}</span>${f[0]}${f[2]?`<small>${f[2]}</small>`:""}${f[1]?"":"<small>coming next</small>"}</button>`).join("");
flows.addEventListener("click", e => { const b = e.target.closest(".chip"); if (b && FLOWS[+b.dataset.k][1] && +b.dataset.k !== S.flow) setFlow(+b.dataset.k); });
dots.addEventListener("click", e => { const b = e.target.closest(".dot"); if (b) go(+b.dataset.i); });
function marks() {
  [...dots.children].forEach((d,i)=>{ d.setAttribute("aria-current", i===S.step ? "true" : "false"); d.classList.toggle("done", i < S.step); });
  const st = ST()[S.step]; if (st) { document.getElementById("capT").textContent = `${S.step+1}. ${st.t}`; document.getElementById("capS").textContent = (VO && VO.text(S.flow, S.step)) || st.s; }
  else { document.getElementById("capT").textContent = "Ready when you are"; document.getElementById("capS").textContent = "Press Start the tour, or pick a step."; }
  const pz = S.paused || S.step < 0, p = document.getElementById("play"); p.innerHTML = `<span class="ms">${pz?"play_arrow":"pause"}</span>`; p.setAttribute("aria-label", pz ? "Play" : "Pause");
}
async function go(i) {
  const steps = ST(); i = Math.max(0, Math.min(steps.length-1, i)); const id = ++RUN; S.step = i; card.hidden = true; marks(); if (VO) VO.step(); resetScroll = true; tourEvent("step");
  const hadMask = !!q("#layer .mask"); q("#layer") && (q("#layer").innerHTML = ""); stage.querySelectorAll(".dd").forEach(e => e.remove());
  S.bright = S.flow >= 1; steps[i].enter(); if (hadMask) q("#layer .mask")?.classList.add("still");
  try { await steps[i].play(id); if (VO) await VO.done(id); if (i < steps.length-1) { await wait(VO && VO.on ? 350 : 900,id); go(i+1); } }
  catch (e) { if (!(e instanceof Cancel)) console.error(e); }
}
function showEnd() {
  const [eb, h, p, stats, next] = FD().end(), nf = FLOWS[next];
  card.innerHTML = `<div class="in2"><div class="eyebrow">${eb}</div><h2>${h}</h2><p>${esc(p)}</p>
    <div class="stats">${stats.map(x=>`<div><b>${x[0]}</b>${x[1]}</div>`).join("")}</div>
    <div class="acts end">${FD().cta ? `<a class="go" id="cta" href="${FD().cta.href}" target="_top">${FD().cta.label}</a>` : FOCUS ? "" : `<button type="button" class="go" id="nextflow">Next: ${nf[0]}</button>`}<span class="sec"><button type="button" class="quiet" id="again"><span class="ms">replay</span>Replay</button><button type="button" class="quiet fsonly" id="fsexit"><span class="ms">fullscreen_exit</span>Exit full screen</button></span></div></div>`;
  card.hidden = false; marks(); tourEvent("complete");
  card.querySelector("#again").onclick = () => { tourEvent("replay"); go(0); };
  card.querySelector("#fsexit").onclick = () => fsExit();
  const cta = card.querySelector("#cta");
  if (cta) { cta.onclick = () => { tourEvent("cta", { href: FD().cta.href }); }; cta.focus({ preventScroll: true }); return; }
  const nb = card.querySelector("#nextflow");
  if (nb) { nb.onclick = () => { if (nf[1]) { tourEvent("next", { next_flow: nf[0], next_step: 1 }); setFlow(next); startFlow(); } else nb.textContent = "Coming in the next build"; }; nb.focus({ preventScroll: true }); }
  else card.querySelector("#again").focus({ preventScroll: true });
}
/* Starts the chosen flow from the top; on the retail media tour a flow started with sound off shows the "Enable sound" hint first. */
function startFlow() { S.paused = false; card.hidden = true; if (VO) VO.hint(() => go(0)); else go(0); }
function startCard() {
  const [h, p] = FD().start();
  card.innerHTML = `<div class="in2"><div class="eyebrow">${S.welcome ? `Welcome, ${esc(S.welcome)} · ` : ""}Flow ${S.flow+1} · ${ST().length} steps · about 2 minutes</div><h2>${h}</h2><p>${esc(p)}</p>
    <div class="acts split"><button type="button" class="go" id="start"><span class="ms">play_arrow</span>Start the tour</button><button type="button" class="fsbig" id="fsstart"><span class="ms">fullscreen</span>Watch full screen</button></div></div>`;
  card.hidden = false; card.querySelector("#start").onclick = () => startFlow();
  card.querySelector("#fsstart").onclick = () => { fsEnter(); startFlow(); };
}
function setFlow(k) {
  if (VO) VO.stop(); S.flow = k; S.p3 = false; if (VO) VO.warm(); RUN++; S.step = -1; resetScroll = true; hideTip(); S.bright = k >= 1;
  document.getElementById("h1").textContent = FD().h1; document.getElementById("sub").textContent = FD().sub;
  [...flows.children].forEach((c,i) => c.setAttribute("aria-current", i === k ? "true" : "false"));
  dots.innerHTML = ST().map((s,i)=>`<button type="button" class="dot" role="tab" aria-label="Step ${i+1}: ${esc(s.t)}" data-i="${i}"></button>`).join("");
  FD().intro(); startCard(); marks();
}
document.getElementById("prev").onclick = () => go(S.step - 1);
document.getElementById("next").onclick = () => go(S.step + 1);
document.getElementById("play").onclick = () => { if (S.step < 0) { if (document.getElementById("vohint")) { S.paused = false; go(0); } else startFlow(); return; } S.paused = !S.paused; marks(); if (VO) VO.sync(); };
const co = document.getElementById("co"), col = document.getElementById("col");
function restart() { if (S.step < 0) { RUN++; S.bright = S.flow >= 1; FD().intro(); startCard(); } else go(S.step); }
let tmr; co.addEventListener("input", () => { S.custom = true; S.brand = co.value.trim() || null; clearTimeout(tmr); tmr = setTimeout(restart, 500); });
col.addEventListener("input", () => { S.custom = true; S.color = col.value; clearTimeout(tmr); tmr = setTimeout(restart, 300); });
co.value = D().brand; col.value = D().color;
const FOCUSMAP = { "#localisation": 1, "#personalisation": 2 }, FOCUS = location.hash in FOCUSMAP;
if (FOCUS) flows.hidden = true;
/* ================= website gate: teaser, lead capture, unlock ================= */
const AWS_URL = "https://aws.amazon.com/marketplace/pp/prodview-3uiwcnbrpvj76?trk=59c672e4-15c4-4782-aee9-4352db108809&sc_channel=el&source=personalisationhub";
const wrap = document.getElementById("wrap"), gate = document.getElementById("gate"), LEAD_KEY = "ph_lead";
const GFLOWS = IS_RM ? [["storefront","Retailer setup","Open slots to brands and sell them through a deal"],["record_voice_over","Advertiser creates by talking","A whole campaign from a spoken brief"],["person_pin_circle","Shopper journey & outcome","One shopper, four screens"]] : [["auto_awesome","Campaign creation","Talk a campaign into existence, in your brand"],["storefront","Localisation & scheduling","Every store gets its own version"],["person_pin_circle","Personalisation","The right offer the moment they check in"]];
const TEASE_STD = [
  { cap: "A spoken brief becomes creative for every screen", async run(id) { S.flow = 0; S.bright = false; paint(listScreen(false)); q("#layer").innerHTML = modalHTML(null, [], false);
      q("#ta").classList.add("focus"); q("#vrow").style.visibility = "visible"; q("#mic").classList.add("rec"); dictate(q("#tabody"), D().brief, id).catch(() => {});
      await wait(3300, id); S.bright = true; paint(creativeScreen(4, false)); await wait(3300, id); } },
  { cap: "Import every store, then localise store by store", async run(id) { S.flow = 1; S.bright = true; paint(storesScreen(false)); q("#layer").innerHTML = addStoresHTML({ q: B() });
      await wait(700, id); refreshAdd({ q: B(), results: true }); await wait(1700, id); refreshAdd({ q: B(), results: true, all: true }); await wait(900, id);
      q("#layer").innerHTML = ""; paint(storesScreen(true, true)); await wait(3300, id); } },
  { cap: "The right offer, the moment a customer checks in", async run(id) { S.flow = 2; S.bright = true; screen.innerHTML = sceneHTML("home1", "promo");
      await wait(1300, id); setPhone("home2"); await wait(1100, id); const tv = q("#pdisp"); tv.classList.add("on"); if (P3().shelf) tv.innerHTML = shelfSVG(true); else tv.querySelector(".tv-in").innerHTML = art("land","first",S.bright); await wait(4200, id); } }
];
const TEASE = (IS_CONV || IS_RM) ? CV.TEASE : TEASE_STD;
const IN_FRAME = window.parent !== window;
const PCFG = () => { try { return window.PH_TOUR || (IN_FRAME && window.parent.PH_TOUR) || {}; } catch (e) { return window.PH_TOUR || {}; } };
const DL = () => { try { if (IN_FRAME && window.parent.dataLayer) return window.parent.dataLayer; } catch (e) {} return (window.dataLayer = window.dataLayer || []); };
if (/[?&]embed=1/.test(location.search)) document.documentElement.classList.add("embed");
if (IN_FRAME) { try { const w = document.getElementById("wrap"); new ResizeObserver(() => { if (FSON) return; try { window.parent.postMessage({ type: "ph-tour-height", h: Math.ceil(w.getBoundingClientRect().bottom + window.scrollY + 8) }, location.origin); } catch (e) {} }).observe(w); } catch (e) {} }
let LOCKED = false, TSEL = FOCUS ? FOCUSMAP[location.hash] : 0, GMODE = "pick";
S.welcome = "";
function tourEvent(action, extra) { try { DL().push(Object.assign({ event: "ph_tour", action, industry: S.ind, flow: (FLOWS[S.flow] || [])[0], step: S.step + 1 }, extra || {})); } catch (e) {} }
/* ---- full screen. Native Fullscreen API on this document; where it is missing (iPhone Safari) a full-viewport fallback: the page pins this iframe on {type:"ph-tour-fullscreen", on}. ---- */
const fsBtn = document.getElementById("fs"), fsClose = document.getElementById("fsclose"), ROOT = document.documentElement;
/* iPhone, iPad and iPadOS (reports as Macintosh with touch): native full screen shows the system's own X top left, so use the in-page fallback and our top-right close. */
const APPLE_TOUCH = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
let FSON = false, FSMODE = "";
function fsPost(on) { if (IN_FRAME) { try { window.parent.postMessage({ type: "ph-tour-fullscreen", on }, location.origin); } catch (e) {} } }
function fsApply(on, mode) {
  if (on === FSON) return;
  FSON = on; FSMODE = on ? mode : ""; ROOT.classList.toggle("fs", on);
  fsBtn.setAttribute("aria-pressed", on ? "true" : "false"); fsBtn.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
  fsBtn.querySelector(".ms").textContent = on ? "fullscreen_exit" : "fullscreen";
  tourEvent(on ? "fullscreen_enter" : "fullscreen_exit");
  if (on && mode === "fallback") fsPost(true);
  if (!on && mode === "fallback") fsPost(false);
  try { (on ? fsClose : fsBtn).focus({ preventScroll: true }); } catch (e) {}
  if (!on) { try { window.scrollTo(0, 0); } catch (e) {} }
}
function fsEnter() {
  if (FSON || LOCKED) return;
  const de = ROOT, api = !APPLE_TOUCH && document.fullscreenEnabled && de.requestFullscreen;
  if (!api) { fsApply(true, "fallback"); return; }
  let p; try { p = de.requestFullscreen(); } catch (e) { p = Promise.reject(e); }
  if (p && p.then) p.then(() => fsApply(true, "api"), () => fsApply(true, "fallback")); else fsApply(true, "api");
}
function fsExit() {
  if (!FSON) return;
  if (FSMODE === "api" && document.fullscreenElement) { try { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => fsApply(false, "api")); } catch (e) { fsApply(false, "api"); } return; }
  fsApply(false, FSMODE || "fallback");
}
fsBtn.onclick = () => (FSON ? fsExit() : fsEnter());
fsClose.onclick = () => fsExit();
document.addEventListener("fullscreenchange", () => { if (document.fullscreenElement) fsApply(true, "api"); else if (FSON && FSMODE === "api") fsApply(false, "api"); });
document.addEventListener("keydown", e => {
  if (!FSON) return;
  if (e.key === "Escape") { e.preventDefault(); fsExit(); return; }
  if (e.key !== "Tab") return;
  const f = [...document.getElementById("wrap").querySelectorAll("button,a[href],input,select,textarea,[tabindex]")].filter(x => !x.disabled && x.tabIndex >= 0 && x.getClientRects().length && !x.closest("[hidden]"));
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1], a = document.activeElement;
  if (e.shiftKey && (a === first || !document.getElementById("wrap").contains(a))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (a === last || !document.getElementById("wrap").contains(a))) { e.preventDefault(); first.focus(); }
});
function readLead() { try { const l = JSON.parse(localStorage.getItem(LEAD_KEY) || "null"); return l && l.email ? l : null; } catch (e) { return null; } }
function saveLead(l) { try { localStorage.setItem(LEAD_KEY, JSON.stringify(l)); } catch (e) {} }
function sendLead(l) {
  const body = { name: l.name, company: l.company, email: l.email, consent: true, industry: S.ind, source: "Interactive product tour", flow: GFLOWS[l.flow][1], page: location.pathname, test: /[?&]ph_test=1/.test(location.search) };
  try { DL().push({ event: "ph_lead_captured", source: body.source, industry: S.ind }); } catch (e) {}
  const cfg = PCFG();
  if (!cfg.endpoint) return Promise.resolve({ ok: true, prototype: true });
  return fetch(cfg.endpoint, { method: "POST", credentials: "same-origin", headers: Object.assign({ "Content-Type": "application/json" }, cfg.nonce ? { "X-WP-Nonce": cfg.nonce } : {}), body: JSON.stringify(body) }).then(r => ({ ok: r.ok })).catch(() => ({ ok: false }));
}
const FREE_MAIL = /@(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx|mail|zoho|yandex)\./i;
function gateHTML() {
  const head = `<div class="g-eb"><span class="ms">play_circle</span>Interactive product tour</div>`;
  if (GMODE === "pick") return `<div class="g-cap" id="gcap"><span class="ms">visibility</span><span id="gcapt"></span></div><div class="g-panel">${head}
      <h3>${IS_RM ? "Watch a convenience retailer sell its screens to a brand" : `Watch a ${INDLABEL} campaign go from a spoken brief to the right customer`}</h3><p>${`Three short guided demos on real Personalisation Hub screens, run in your brand. Pick one to start.`}</p>
      <div class="g-flows">${GFLOWS.map((f, i) => `<button type="button" class="g-flow" data-f="${i}"><span class="ms">${f[0]}</span><span><b>${f[1]}</b><small>${f[2]}</small></span><span class="g-go">Watch<span class="ms">chevron_right</span></span><i></i></button>`).join("")}</div></div>`;
  const f = GFLOWS[TSEL];
  return `<div class="g-cap" id="gcap"><span class="ms">visibility</span><span id="gcapt"></span></div><div class="g-panel">${head}
      <button type="button" class="g-back" id="gback"><span class="ms">chevron_left</span>Choose another demo</button>
      <div class="g-sel"><span class="ms">${f[0]}</span><span><b>${f[1]}</b><small>${f[2]}</small></span></div>
      <form class="g-form" id="gform" novalidate><label>Full name<input type="text" name="name" autocomplete="name" required></label><label>Company<input type="text" name="company" autocomplete="organization" required></label>
        <label>Work email<input type="email" name="email" autocomplete="email" required></label><span class="g-err" id="gerr"></span>
        <label class="g-cons"><input type="checkbox" name="consent"><span>I agree to Personalisation Hub contacting me about this tour. <a href="/privacy-policy/" target="_blank" rel="noopener">Privacy Policy</a></span></label>
        <button type="submit" class="g-sub" id="gsub">Start the tour</button></form></div>`;
}
function setLive(i) { gate.querySelectorAll(".g-flow").forEach((b, k) => { b.classList.remove("gl-on"); if (k === i) { void b.offsetWidth; b.classList.add("gl-on"); } }); const c = document.getElementById("gcapt"); if (c) c.textContent = TEASE[i].cap; }
async function teaseLoop() {
  const id = ++RUN; if (VO) VO.stop(); S.paused = false; S.step = -1; hideTip(); card.hidden = true; stage.classList.add("teasing"); let i = TSEL;
  try { for (;;) { setLive(i); await TEASE[i].run(id); if (GMODE === "pick") i = (i + 1) % TEASE.length; } } catch (e) { if (!(e instanceof Cancel)) console.error(e); }
}
function renderGate() {
  gate.innerHTML = gateHTML();
  if (GMODE === "pick") { gate.querySelectorAll(".g-flow").forEach(b => b.onclick = () => { TSEL = +b.dataset.f; GMODE = "form"; renderGate(); teaseLoop(); tourEvent("gate_pick", { flow: GFLOWS[TSEL][1] }); gate.querySelector("input[name=name]").focus({ preventScroll: true }); }); return; }
  gate.querySelector("#gback").onclick = () => { GMODE = "pick"; renderGate(); teaseLoop(); };
  const form = gate.querySelector("#gform"), btn = form.querySelector("#gsub"), err = form.querySelector("#gerr");
  const check = show => { const n = form.name.value.trim(), c = form.company.value.trim(), e = form.email.value.trim(), okMail = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e), free = okMail && FREE_MAIL.test(e);
    err.textContent = free ? "Please use your work email." : (show && e && !okMail ? "Please enter a valid email." : ""); const ok = n.length > 1 && c.length > 1 && okMail && !free && form.consent.checked; btn.classList.toggle("ok", ok); return ok; };
  form.addEventListener("input", () => check(false)); form.email.addEventListener("blur", () => check(true));
  form.onsubmit = e => { e.preventDefault(); if (!check(true)) return; const lead = { name: form.name.value.trim(), company: form.company.value.trim(), email: form.email.value.trim(), source: "Interactive product tour", flow: TSEL, ts: Date.now() };
    saveLead(lead); sendLead(lead); unlock(lead, true); };
}
function lock() {
  fsExit(); LOCKED = true; GMODE = "pick"; wrap.classList.add("locked"); gate.hidden = false; S.custom = false; S.brand = null; S.welcome = ""; co.value = IND[S.ind].brand;
  document.getElementById("h1").textContent = IS_RM ? "See a convenience retailer run its own retail media network, end to end" : `See Personalisation Hub run a ${INDLABEL} campaign, end to end`;
  document.getElementById("sub").textContent = IS_RM ? "Short guided demos: a retailer selling its screens, a brand creating a campaign by talking, and one shopper followed from forecourt to checkout." : "Short guided demos built on real Personalisation Hub screens: campaign creation, localisation and personalisation, branded as your company.";
  renderGate(); teaseLoop();
}
function unlock(lead, autostart) {
  LOCKED = false; RUN++; gate.hidden = true; gate.innerHTML = ""; wrap.classList.remove("locked"); stage.classList.remove("teasing");
  if (lead && lead.company) { S.custom = true; S.brand = lead.company.trim().slice(0, 32); co.value = S.brand; }
  S.welcome = lead && lead.name ? lead.name.trim().split(/\s+/)[0] : "";
  flows.hidden = FOCUS; setFlow(TSEL); tourEvent("unlock", { via: autostart ? "tour form" : "existing details" });
  if (autostart) startFlow();
}
const onLead = e => { const l = (e && e.detail && e.detail.email) ? e.detail : readLead(); if (LOCKED && l) unlock(l, false); };
window.addEventListener("ph:lead", onLead); try { if (IN_FRAME) window.parent.addEventListener("ph:lead", onLead); } catch (e) {}
const simc = document.getElementById("simcalc"), simr = document.getElementById("simreset");
if (simc) simc.onclick = () => { const l = { name: "Sam Taylor", company: "Kestrel Mobile", email: "sam.taylor@kestrelmobile.com", source: "Telco business model download", ts: Date.now() }; saveLead(l); window.dispatchEvent(new CustomEvent("ph:lead", { detail: l })); };
if (simr) simr.onclick = () => { try { localStorage.removeItem(LEAD_KEY); } catch (e) {} lock(); };
if (IS_RM) { const fine = document.querySelector(".fine"); if (fine) fine.textContent = "Example companies, stores and figures are illustrative. Retailer screens are Personalisation Hub HQ Admin screens; campaign screens recreate HQ Admin."; }
S.flow = 0; const stored = readLead(); if (window.PH_TOUR_REVIEW) unlock({ name: "", company: "" }, false); else if (stored) unlock(stored, false); else lock();
})();
</script>
</body>
</html>

PHTOUR;
