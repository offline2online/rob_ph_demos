/* Test page for the mock DSPs (a tester tool, never shipped with the
   product): edits seats, advertisers, auth behaviour and bidder behaviour
   through the control API. Plain HTML, ph-designer tokens. */
export const controlPage = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mock DSPs — test controls</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap">
<style>
:root{--primary:#169bc2;--text:#333;--muted:rgba(0,0,0,.45);--micro:#9ca3af;--border:#d9d9d9;--subtle:#f0f0f0;--alt:#fafafa;--success:#52c41a;--error:#ff4d4f;--warning:#faad14}
*{box-sizing:border-box}body{margin:0;padding:20px;font:14px Roboto,"Helvetica Neue",Helvetica,Arial,sans-serif;color:var(--text);background:#fff}
h1{font-size:20px;font-weight:700;margin:0}.rule{height:1px;background:rgba(5,5,5,.06);margin:16px 0}
.ms{font-family:'Material Symbols Outlined';font-size:18px;vertical-align:middle;line-height:1}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--subtle);margin-bottom:16px}.tab{padding:12px 8px;cursor:pointer;border:0;background:none;font:inherit;color:var(--text);border-bottom:2px solid transparent}
.tab[aria-selected=true]{color:var(--primary);font-weight:500;border-bottom-color:var(--primary);background:rgba(22,155,194,.1)}
.label{text-transform:uppercase;font-size:12px;letter-spacing:.5px;color:var(--muted);margin:24px 0 12px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid rgba(24,29,31,.15);font-size:13px}th{font-weight:700;color:#181d1f}
input,select{height:32px;padding:4px 11px;border:1px solid var(--border);border-radius:6px;font:inherit}
button.btn{height:32px;padding:0 15px;border-radius:6px;border:1px solid var(--border);background:#fff;font:inherit;cursor:pointer}
button.primary{background:var(--primary);border-color:var(--primary);color:#fff}button.danger{color:var(--error);border-color:var(--error)}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.muted{color:var(--muted)}.err{color:var(--error)}
.pill{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:9999px;border:1px solid;font-size:12px}
</style></head><body>
<div class="row" style="justify-content:space-between"><h1>Mock DSPs</h1><button class="btn" id="reset">Reset to seed</button></div>
<div class="muted" style="margin-top:4px">Test controls for the mock Google DV360, Amazon Ads and The Trade Desk APIs. Not a product screen.</div>
<div class="rule"></div>
<div class="tabs" role="tablist"></div>
<div id="panel"></div>
<p class="err" id="msg" role="alert"></p>
<script>
const DSPS=[['google_dv360','Google DV360'],['amazon_dsp','Amazon Ads'],['the_trade_desk','The Trade Desk']];
let cur='google_dv360', state=null;
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function call(method,path,body){$('#msg').textContent='';const r=await fetch('/_control'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok){$('#msg').textContent=j.error||'Request failed';return null}return j}
async function load(){state=await call('GET','/state');render()}
function render(){
  $('.tabs').innerHTML=DSPS.map(([k,l])=>'<button class="tab" role="tab" aria-selected="'+(k===cur)+'" data-k="'+k+'">'+l+'</button>').join('');
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{cur=b.dataset.k;render()});
  const s=state[cur];
  $('#panel').innerHTML=
   '<div class="label">Account</div><div class="muted">Account ID (DV360 partner / Amazon profile / TTD partner): <b style="color:var(--text)">'+esc(s.accountId)+'</b></div>'+
   '<div class="label">Auth</div><div class="row"><span class="pill" style="color:'+(s.auth.accept?'var(--success)':'var(--error)')+'">'+(s.auth.accept?'Accepting credentials':'Rejecting: '+esc(s.auth.error)+' — '+esc(s.auth.description))+'</span>'+
     (s.auth.accept?'<input id="authErr" placeholder="error (e.g. invalid_grant)" value="invalid_grant"><input id="authDesc" placeholder="description" style="min-width:320px" value="The request has an invalid grant parameter : refresh_token"><button class="btn danger" id="authOff">Reject credentials</button>':'<button class="btn primary" id="authOn">Accept credentials</button>')+'</div>'+
   '<div class="label">Seats</div><table><thead><tr><th>Seat ID</th><th>Name</th><th></th></tr></thead><tbody>'+s.seats.map(x=>'<tr><td>'+esc(x.seatId)+'</td><td>'+esc(x.name)+'</td><td><button class="btn danger" data-del-seat="'+esc(x.seatId)+'">Remove</button></td></tr>').join('')+'</tbody></table>'+
   '<div class="row" style="margin-top:8px"><input id="seatId" placeholder="Seat ID"><input id="seatName" placeholder="Name"><button class="btn primary" id="addSeat">Add seat</button></div>'+
   '<div class="label">Advertisers</div><table><thead><tr><th>ID</th><th>Name</th><th>Seat</th><th>Domain</th><th>Categories</th><th>Currency</th><th></th></tr></thead><tbody>'+s.advertisers.map(a=>'<tr><td>'+esc(a.id)+'</td><td>'+esc(a.name)+'</td><td>'+esc(a.seatId)+'</td><td>'+esc(a.domain)+'</td><td>'+esc(a.categories.join(', '))+'</td><td>'+esc(a.currency)+'</td><td><button class="btn danger" data-del-adv="'+esc(a.id)+'">Remove</button></td></tr>').join('')+'</tbody></table>'+
   '<div class="row" style="margin-top:8px"><input id="advName" placeholder="Name"><select id="advSeat">'+s.seats.map(x=>'<option>'+esc(x.seatId)+'</option>').join('')+'</select><input id="advDomain" placeholder="Domain (adomain)"><input id="advCats" placeholder="Categories, comma separated"><input id="advCur" placeholder="Currency" value="AUD" style="width:80px"><button class="btn primary" id="addAdv">Add advertiser</button></div>'+
   '<div class="label">Bidder</div><div class="row"><select id="bidMode">'+[['bid','Bids at a fixed price'],['no_bid','No bid'],['below_floor','Bids below the floor']].map(([v,l])=>'<option value="'+v+'"'+(s.bidder.mode===v?' selected':'')+'>'+l+'</option>').join('')+'</select><input id="bidPrice" type="number" step="1" value="'+esc(s.bidder.priceCpm)+'" style="width:110px"><span class="muted">CPM</span>'+
     '<select id="bidAdv">'+s.advertisers.map(a=>'<option value="'+esc(a.id)+'"'+(a.id===(s.bidder.advertiserId||s.advertisers[0]?.id)?' selected':'')+'>'+esc(a.name)+'</option>').join('')+'</select>'+
     '<input id="bidCrid" placeholder="crid (default crid-<advertiser id>)" value="'+esc(s.bidder.crid)+'" style="min-width:240px"><input id="bidDomain" placeholder="adomain override" value="'+esc(s.bidder.adomain)+'"><button class="btn primary" id="saveBid">Save bidder</button></div>';
  const upd=j=>{if(j){load()}};
  $('#addSeat').onclick=async()=>upd(await call('POST','/'+cur+'/seats',{seatId:$('#seatId').value,name:$('#seatName').value}));
  document.querySelectorAll('[data-del-seat]').forEach(b=>b.onclick=async()=>upd(await call('DELETE','/'+cur+'/seats/'+encodeURIComponent(b.dataset.delSeat))));
  $('#addAdv').onclick=async()=>upd(await call('POST','/'+cur+'/advertisers',{name:$('#advName').value,seatId:$('#advSeat').value,domain:$('#advDomain').value,categories:$('#advCats').value.split(',').map(x=>x.trim()).filter(Boolean),currency:$('#advCur').value}));
  document.querySelectorAll('[data-del-adv]').forEach(b=>b.onclick=async()=>upd(await call('DELETE','/'+cur+'/advertisers/'+encodeURIComponent(b.dataset.delAdv))));
  if($('#authOff'))$('#authOff').onclick=async()=>upd(await call('PUT','/'+cur+'/auth',{accept:false,error:$('#authErr').value,description:$('#authDesc').value}));
  if($('#authOn'))$('#authOn').onclick=async()=>upd(await call('PUT','/'+cur+'/auth',{accept:true}));
  $('#saveBid').onclick=async()=>upd(await call('PUT','/'+cur+'/bidder',{mode:$('#bidMode').value,priceCpm:Number($('#bidPrice').value),advertiserId:$('#bidAdv').value||undefined,crid:$('#bidCrid').value,adomain:$('#bidDomain').value}));
}
$('#reset').onclick=async()=>{await call('POST','/reset');load()};
load();
</script></body></html>`
