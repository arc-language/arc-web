'use strict'

// arc-profiler hooks - code strings injected into compiled server.js when --profile is active.
// All exports are functions returning JavaScript source code strings.

const TOOLBAR_JS = `(function(){
  if(typeof window==='undefined')return
  var s=document.createElement('style')
  s.textContent='._arc_prof{position:fixed;bottom:16px;right:16px;z-index:999999;font:12px/1 \\'SF Mono\\',\\'Fira Code\\',monospace;background:#0b0b13;border:1px solid #22223a;color:#e2e2f0;padding:6px 10px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:0 4px 12px rgba(0,0,0,.5);text-decoration:none;user-select:none}._arc_prof:hover{border-color:#00e5ff}._arc_prof._mf{border-left:2px solid #22c55e}._arc_prof._mm{border-left:2px solid #f59e0b}._arc_prof._ms{border-left:2px solid #ef4444}._arc_pd{width:6px;height:6px;border-radius:50%;background:#6868a0}._arc_pd.live{background:#22c55e;animation:_arc_pl 2s infinite}@keyframes _arc_pl{0%,100%{opacity:1}50%{opacity:.4}}'
  document.head.appendChild(s)
  var el=document.createElement('a')
  el.className='_arc_prof'
  el.href='/_arc/profiler'
  el.target='_blank'
  el.title='Alt+P — open arc profiler'
  el.innerHTML='<span>⚡</span><span class="_arc_pd" id="_ap_d"></span><span id="_ap_t">arc profiler</span>'
  document.body.appendChild(el)
  var dot=document.getElementById('_ap_d'),txt=document.getElementById('_ap_t')
  var es=new EventSource('/_arc/profiler/events')
  es.onopen=function(){dot.className='_arc_pd live'}
  es.onerror=function(){dot.className='_arc_pd'}
  es.onmessage=function(e){
    var r=JSON.parse(e.data)
    if(r.type==='connected')return
    var ms=r.total_ms
    txt.textContent=r.method+' '+r.path+' '+ms+'ms'
    el.className='_arc_prof'+(ms<100?' _mf':ms<500?' _mm':' _ms')
  }
  document.addEventListener('keydown',function(e){if(e.altKey&&e.key==='p')window.open('/_arc/profiler','_blank')})
})()`

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>arc profiler</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0b0b13;--sf:#12121e;--sf2:#1a1a2a;--bd:#22223a;--ac:#00e5ff;--ac2:#7c3aed;--tx:#e2e2f0;--mu:#6868a0;--gn:#22c55e;--yw:#f59e0b;--rd:#ef4444}
body{background:var(--bg);color:var(--tx);font:13px/1.4 'SF Mono','Fira Code',monospace;height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.hdr{display:flex;align-items:center;gap:16px;padding:8px 16px;background:var(--sf);border-bottom:1px solid var(--bd);flex-shrink:0}
.logo{color:var(--ac);font-weight:700;font-size:14px;letter-spacing:-.5px}.logo span{color:var(--mu)}
.stat{font-size:11px;color:var(--mu)}.stat b{color:var(--tx)}
.live{width:7px;height:7px;border-radius:50%;background:var(--gn);margin-left:auto;transition:background .3s}
.live.off{background:var(--rd)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.live.on{animation:pulse 2s infinite}
.main{display:grid;grid-template-columns:280px 1fr;flex:1;overflow:hidden}
.sidebar{border-right:1px solid var(--bd);overflow:hidden;display:flex;flex-direction:column}
.sb-hdr{padding:8px 12px;font-size:11px;color:var(--mu);text-transform:uppercase;letter-spacing:.8px;border-bottom:1px solid var(--bd);flex-shrink:0;display:flex;align-items:center;justify-content:space-between}
.req-list{flex:1;overflow-y:auto}
.req-item{display:grid;grid-template-columns:44px 1fr 40px 52px;align-items:center;gap:6px;padding:7px 12px;cursor:pointer;border-bottom:1px solid var(--bd);font-size:12px;transition:background .1s}
.req-item:hover{background:var(--sf2)}
.req-item:focus{outline:2px solid var(--ac);outline-offset:-2px}
.req-item.sel{background:rgba(0,229,255,.07);border-left:2px solid var(--ac)}
.mth{font-size:10px;font-weight:700;padding:2px 4px;border-radius:3px;text-align:center}
.mth.GET{color:var(--gn);background:rgba(34,197,94,.12)}
.mth.POST{color:#60a5fa;background:rgba(96,165,250,.12)}
.mth.PUT{color:var(--yw);background:rgba(245,158,11,.12)}
.mth.DELETE{color:var(--rd);background:rgba(239,68,68,.12)}
.mth.PATCH{color:#a78bfa;background:rgba(167,139,250,.12)}
.rpath{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tx)}
.rst{text-align:right;font-size:11px}
.ok{color:var(--gn)}.warn{color:var(--yw)}.err{color:var(--rd)}
.rms{text-align:right;font-size:11px}
.mf{color:var(--gn)}.mm{color:var(--yw)}.ms{color:var(--rd)}
.detail{overflow:hidden;display:flex;flex-direction:column}
.tabs{display:flex;border-bottom:1px solid var(--bd);flex-shrink:0;background:var(--sf)}
.tab{padding:8px 14px;font-size:12px;cursor:pointer;color:var(--mu);border-bottom:2px solid transparent;transition:color .15s;white-space:nowrap}
.tab:hover{color:var(--tx)}.tab:focus{outline:2px solid var(--ac);outline-offset:-2px}.tab.active{color:var(--ac);border-bottom-color:var(--ac)}
.panel{flex:1;overflow-y:auto;padding:16px}
.panel.h{display:none}
.smry{display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--sf);border-bottom:1px solid var(--bd);font-size:12px;flex-shrink:0}
.smry-path{color:var(--ac);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:13px}
.bdg{padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.bdg.ok{background:rgba(34,197,94,.15);color:var(--gn)}
.bdg.warn{background:rgba(245,158,11,.15);color:var(--yw)}
.bdg.err{background:rgba(239,68,68,.15);color:var(--rd)}
.bdg.neu{background:var(--sf2)}
.tl-row{display:grid;grid-template-columns:80px 1fr 64px;align-items:center;gap:8px;margin-bottom:8px;font-size:12px}
.tl-lbl{color:var(--mu);text-align:right;font-size:11px}
.tl-wrap{height:16px;background:var(--sf2);border-radius:4px;overflow:hidden;position:relative}
.tl-bar{height:100%;border-radius:4px;min-width:2px;transition:width .3s ease}
.tl-bar.tl-db{background:var(--yw)}.tl-bar.tl-handler{background:var(--ac)}.tl-bar.tl-total{background:var(--mu)}
.tl-ms{color:var(--mu);font-size:11px;text-align:right}
.sql-row{padding:10px 12px;border-radius:6px;background:var(--sf2);margin-bottom:8px;font-size:12px}
.sql-q{color:var(--ac);margin-bottom:5px;word-break:break-all;font-size:11px;font-family:inherit}
.sql-m{color:var(--mu);font-size:11px;display:flex;gap:12px}
.sql-row.dup{border-left:3px solid var(--rd)}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:7px 10px;color:var(--mu);font-size:10px;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid var(--bd);font-weight:500}
td{padding:7px 10px;border-bottom:1px solid var(--bd)}
tr:last-child td{border-bottom:none}
tr:hover td{background:var(--sf2)}
canvas{display:block;width:100%;height:120px;border-radius:6px;background:var(--sf2)}
.mem-g{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}
.mem-c{background:var(--sf2);border-radius:8px;padding:14px}
.mem-cl{font-size:11px;color:var(--mu);margin-bottom:6px}
.mem-cv{font-size:22px;font-weight:700;color:var(--ac)}
.mem-cu{font-size:11px;color:var(--mu)}
.ht td:first-child{color:var(--mu);width:200px;padding:5px 10px 5px 0;vertical-align:top}
.ht td:last-child{padding:5px 0;word-break:break-all}
.ht tr{border-bottom:1px solid var(--bd)}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--mu);gap:8px}
.empty-ic{font-size:32px;opacity:.4}
.sh{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--mu);margin-bottom:10px;margin-top:20px}
.sh:first-child{margin-top:0}
.kv{display:grid;grid-template-columns:120px 1fr;gap:5px 12px;font-size:12px;margin-top:6px}
.kv span:nth-child(odd){color:var(--mu)}
.kv span:nth-child(even){color:var(--tx)}
.clr-btn{background:none;border:1px solid var(--bd);color:var(--mu);padding:3px 8px;border-radius:4px;font:11px/1 inherit;cursor:pointer}
.clr-btn:hover{border-color:var(--rd);color:var(--rd)}
</style>
</head>
<body>
<div class="hdr">
  <div class="logo">⚡ arc <span>profiler</span></div>
  <div class="stat">req/s: <b id="rps">—</b></div>
  <div class="stat">p50: <b id="p50">—</b></div>
  <div class="stat">p95: <b id="p95">—</b></div>
  <div class="stat">mem: <b id="mem">—</b></div>
  <div class="live off" id="live" title="Disconnected" role="status" aria-live="polite" aria-label="Disconnected"></div>
</div>
<div class="main">
  <div class="sidebar">
    <div class="sb-hdr">Recent requests <button class="clr-btn" onclick="clearReqs()">clear</button></div>
    <div class="req-list" id="req-list"><div class="empty"><div class="empty-ic">⚡</div><div>Loading…</div></div></div>
  </div>
  <div class="detail" id="detail"><div class="empty" style="height:100%"><div class="empty-ic">→</div><div>Select a request to inspect</div></div></div>
</div>
<script>
var state={reqs:[],sel:null,routes:[],memH:[],tab:'timeline'}

function connect(){
  var es=new EventSource('/_arc/profiler/events')
  var lv=document.getElementById('live')
  es.onopen=function(){lv.className='live on';lv.title='Connected';lv.setAttribute('aria-label','Connected')}
  es.onerror=function(){lv.className='live off';lv.title='Disconnected';lv.setAttribute('aria-label','Disconnected');setTimeout(connect,3000)}
  es.onmessage=function(e){
    var r=JSON.parse(e.data)
    if(r.type==='connected')return
    state.reqs.unshift(r)
    if(state.reqs.length>300)state.reqs.length=300
    renderList()
    updateStats()
  }
}

var rpsW=[]
function updateStats(){
  var now=Date.now()
  rpsW=rpsW.filter(function(t){return now-t<1000})
  rpsW.push(now)
  document.getElementById('rps').textContent=rpsW.length
  var ms=state.reqs.slice(0,100).map(function(r){return r.total_ms}).sort(function(a,b){return a-b})
  if(ms.length){
    document.getElementById('p50').textContent=ms[Math.ceil(ms.length*.5)-1]+'ms'
    document.getElementById('p95').textContent=ms[Math.ceil(ms.length*.95)-1]+'ms'
  }
  fetch('/_arc/profiler/api/memory').then(function(r){return r.json()}).then(function(m){
    document.getElementById('mem').textContent=(m.rss/1024/1024).toFixed(0)+'MB'
    state.memH.push(m)
    if(state.memH.length>120)state.memH.shift()
    if(state.tab==='memory')renderMemory()
  }).catch(function(_err) { /* intentionally ignored - profiler hook failure must not crash the app */ })
}

function msCls(ms){return ms<100?'mf':ms<500?'mm':'ms'}
function stCls(s){return s<300?'ok':s<500?'warn':'err'}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}

function renderList(){
  var list=document.getElementById('req-list')
  if(!state.reqs.length){list.innerHTML='<div class="empty"><div class="empty-ic">⚡</div><div>Waiting for requests…</div></div>';return}
  list.innerHTML=state.reqs.map(function(r,i){
    return '<div class="req-item'+(state.sel===i?' sel':'')+'" role="button" tabindex="0" onclick="sel('+i+')" onkeydown="if(event.key===\'Enter\'||event.key===\' \')sel('+i+')">'+
      '<div class="mth '+r.method+'">'+r.method+'</div>'+
      '<div class="rpath" title="'+esc(r.path)+'">'+esc(r.path)+'</div>'+
      '<div class="rst '+stCls(r.status)+'">'+r.status+'</div>'+
      '<div class="rms '+msCls(r.total_ms)+'">'+r.total_ms+'ms</div>'+
      '</div>'
  }).join('')
}

function clearReqs(){
  if(!confirm('Clear all request history?'))return
  state.reqs=[];state.sel=null;renderList()
  document.getElementById('detail').innerHTML='<div class="empty" style="height:100%"><div class="empty-ic">→</div><div>Select a request to inspect</div></div>'
}

function sel(i){state.sel=i;renderList();renderDetail()}

function setTab(t){
  state.tab=t
  document.querySelectorAll('.tab').forEach(function(el){el.classList.toggle('active',el.dataset.tab===t)})
  document.querySelectorAll('.panel').forEach(function(el){el.classList.toggle('h',el.dataset.panel!==t)})
  if(t==='routes')fetchRoutes()
  if(t==='memory')renderMemory()
}

function renderDetail(){
  var req=state.reqs[state.sel]
  if(!req)return
  var d=document.getElementById('detail')
  var sc=stCls(req.status),mc=msCls(req.total_ms)
  d.innerHTML=
    '<div class="smry">'+
      '<div class="mth '+req.method+'">'+req.method+'</div>'+
      '<div class="smry-path">'+esc(req.path)+'</div>'+
      '<div class="bdg '+sc+'">'+req.status+'</div>'+
      '<div class="bdg neu"><span class="'+mc+'">'+req.total_ms+'ms</span></div>'+
      '<div style="font-size:11px;color:var(--mu)">'+new Date(req.ts).toLocaleTimeString()+'</div>'+
    '</div>'+
    '<div class="tabs" role="tablist">'+
      ['timeline','sql','routes','memory','headers'].map(function(t){
        var label=t.charAt(0).toUpperCase()+t.slice(1)
        if(t==='sql'&&req.queries&&req.queries.length)label+=' ('+req.queries.length+')'
        return '<div class="tab'+(state.tab===t?' active':'')+'" data-tab="'+t+'" role="tab" tabindex="0" onclick="setTab(\''+t+'\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \')setTab(\''+t+'\')">'+label+'</div>'
      }).join('')+
    '</div>'+
    '<div class="panel'+(state.tab==='timeline'?'':' h')+'" data-panel="timeline">'+renderTimeline(req)+'</div>'+
    '<div class="panel'+(state.tab==='sql'?'':' h')+'" data-panel="sql">'+renderSql(req)+'</div>'+
    '<div class="panel'+(state.tab==='routes'?'':' h')+'" data-panel="routes"><table><thead><tr><th>Method</th><th>Route</th><th>Hits</th><th>Avg</th><th>p50</th><th>p95</th><th>p99</th><th>Errors</th></tr></thead><tbody id="rtbody"><tr><td colspan="8" style="color:var(--mu);text-align:center;padding:20px">Loading…</td></tr></tbody></table></div>'+
    '<div class="panel'+(state.tab==='memory'?'':' h')+'" data-panel="memory"><canvas id="mc"></canvas><div class="mem-g" id="mg"></div></div>'+
    '<div class="panel'+(state.tab==='headers'?'':' h')+'" data-panel="headers">'+renderHeaders(req)+'</div>'
  if(state.tab==='routes')fetchRoutes()
  if(state.tab==='memory')renderMemory()
}

function renderTimeline(req){
  var total=req.total_ms||0.1
  var dbMs=0
  ;(req.queries||[]).forEach(function(q){dbMs+=q.ms||0})
  dbMs=+dbMs.toFixed(2)
  var handlerMs=+(total-dbMs).toFixed(2)
  var rows=[
    {label:'Total',ms:total,pct:100,cls:'tl-total'},
    {label:'Handler',ms:Math.max(0,handlerMs),pct:Math.max(0,handlerMs)/total*100,cls:'tl-handler'},
    {label:'DB',ms:dbMs,pct:dbMs/total*100,cls:'tl-db'},
  ]
  var html='<div class="sh">Request phases</div>'+rows.map(function(p){
    return '<div class="tl-row">'+
      '<div class="tl-lbl">'+p.label+'</div>'+
      '<div class="tl-wrap"><div class="tl-bar '+p.cls+'" style="width:'+Math.min(100,p.pct).toFixed(1)+'%"></div></div>'+
      '<div class="tl-ms">'+p.ms+'ms</div>'+
    '</div>'
  }).join('')
  html+='<div class="sh">Request detail</div><div class="kv">'
  var pairs=[
    ['Timestamp',new Date(req.ts).toLocaleString()],
    ['Method',req.method],
    ['Path',esc(req.path)],
    ['Status',String(req.status)],
    ['DB Queries',String((req.queries||[]).length)],
    ['Memory (RSS)',req.mem?(req.mem/1024/1024).toFixed(1)+'MB':'—'],
  ]
  pairs.forEach(function(p){html+='<span>'+p[0]+'</span><span>'+p[1]+'</span>'})
  html+='</div>'
  if(req.queries&&req.queries.length){
    html+='<div class="sh">DB Breakdown</div>'
    var totalDb=dbMs,n=req.queries.length
    html+='<div class="kv"><span>Total DB time</span><span class="'+msCls(totalDb)+'">'+totalDb+'ms</span><span>Queries</span><span>'+n+'</span></div>'
  }
  return html
}

function renderSql(req){
  var qs=req.queries||[]
  if(!qs.length)return'<div class="empty" style="height:200px"><div class="empty-ic">🗄️</div><div>No SQL queries</div></div>'
  var counts={}
  qs.forEach(function(q){counts[q.sql]=(counts[q.sql]||0)+1})
  return qs.map(function(q){
    var dup=counts[q.sql]>1
    return'<div class="sql-row'+(dup?' dup':'')+'">'+'<div class="sql-q">'+esc(q.sql)+'</div>'+'<div class="sql-m"><span>'+q.ms+'ms</span>'+(dup?'<span style="color:var(--rd)">⚠ duplicate query</span>':'')+'</div></div>'
  }).join('')
}

function renderHeaders(req){
  var html=''
  if(req.reqHeaders&&Object.keys(req.reqHeaders).length){
    html+='<div class="sh">Request headers</div><table class="ht">'+Object.entries(req.reqHeaders).map(function(e){return'<tr><td>'+esc(e[0])+'</td><td>'+esc(e[1])+'</td></tr>'}).join('')+'</table>'
  }
  if(req.resHeaders&&Object.keys(req.resHeaders).length){
    html+='<div class="sh">Response headers</div><table class="ht">'+Object.entries(req.resHeaders).map(function(e){return'<tr><td>'+esc(e[0])+'</td><td>'+esc(e[1])+'</td></tr>'}).join('')+'</table>'
  }
  return html||'<div class="empty" style="height:200px"><div>No header data captured</div></div>'
}

function fetchRoutes(){
  fetch('/_arc/profiler/api/routes').then(function(r){return r.json()}).then(function(routes){
    var tb=document.getElementById('rtbody')
    if(!tb)return
    if(!routes.length){tb.innerHTML='<tr><td colspan="8" style="color:var(--mu);text-align:center;padding:20px">No routes hit yet</td></tr>';return}
    tb.innerHTML=routes.map(function(r){
      return'<tr>'+
        '<td><div class="mth '+r.method+'" style="display:inline-block">'+r.method+'</div></td>'+
        '<td style="color:var(--ac)">'+esc(r.route)+'</td>'+
        '<td>'+r.hits+'</td>'+
        '<td class="'+msCls(r.avg)+'">'+r.avg+'ms</td>'+
        '<td class="'+msCls(r.p50)+'">'+r.p50+'ms</td>'+
        '<td class="'+msCls(r.p95)+'">'+r.p95+'ms</td>'+
        '<td class="'+msCls(r.p99)+'">'+r.p99+'ms</td>'+
        '<td style="color:'+(r.errors?'var(--rd)':'var(--mu)')+'">'+r.errors+'</td>'+
      '</tr>'
    }).join('')
  }).catch(function(){
    var tb=document.getElementById('rtbody')
    if(tb)tb.innerHTML='<tr><td colspan="8" style="color:var(--rd);text-align:center;padding:20px">Failed to load routes</td></tr>'
  })
}

function renderMemory(){
  var cv=document.getElementById('mc')
  if(!cv)return
  if(!state.memH.length){
    var ctx0=cv.getContext('2d')
    cv.width=cv.offsetWidth||600;cv.height=cv.offsetHeight||120
    ctx0.clearRect(0,0,cv.width,cv.height)
    ctx0.fillStyle='rgba(104,104,160,.5)';ctx0.font='12px monospace';ctx0.textAlign='center'
    ctx0.fillText('No memory data yet — make some requests',cv.width/2,60)
    return
  }
  var ctx=cv.getContext('2d')
  var W=cv.offsetWidth||600,H=cv.offsetHeight||120
  var dpr=window.devicePixelRatio||1
  cv.width=W*dpr;cv.height=H*dpr;ctx.scale(dpr,dpr)
  ctx.clearRect(0,0,W,H)
  var data=state.memH,pad=12
  var maxV=Math.max.apply(null,data.map(function(d){return d.rss}))
  maxV=Math.max(maxV,1)
  function line(vals,color){
    ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=1.5
    vals.forEach(function(v,i){
      var x=pad+(i/(data.length-1||1))*(W-2*pad)
      var y=H-pad-(v/maxV)*(H-2*pad)
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)
    })
    ctx.stroke()
  }
  line(data.map(function(d){return d.rss}),'rgba(0,229,255,0.85)')
  line(data.map(function(d){return d.heapUsed}),'rgba(124,58,237,0.85)')
  var mg=document.getElementById('mg'),lat=data[data.length-1]
  if(mg&&lat){mg.innerHTML=[{l:'RSS',v:(lat.rss/1048576).toFixed(1),u:'MB'},{l:'Heap Used',v:(lat.heapUsed/1048576).toFixed(1),u:'MB'},{l:'Heap Total',v:(lat.heapTotal/1048576).toFixed(1),u:'MB'}].map(function(s){return'<div class="mem-c"><div class="mem-cl">'+s.l+'</div><div class="mem-cv">'+s.v+'<span class="mem-cu"> '+s.u+'</span></div></div>'}).join('')}
  ctx.font='10px monospace';ctx.fillStyle='rgba(104,104,160,.7)'
  ctx.fillText('— RSS',pad,H-2);ctx.fillText('— Heap',pad+60,H-2)
}

// Boot
fetch('/_arc/profiler/api/requests').then(function(r){return r.json()}).then(function(reqs){
  state.reqs=reqs;renderList();updateStats()
}).catch(function(){
  document.getElementById('req-list').innerHTML='<div class="empty"><div class="empty-ic">⚠️</div><div>Failed to load requests</div></div>'
})
connect()
setInterval(updateStats,5000)
document.addEventListener('keydown',function(e){if(e.altKey&&e.key==='p')window.close()})
</script>
</body>
</html>`

/**
 * Returns JavaScript source injected at the top of compiled server.js when --profile is active.
 * Contains: AsyncLocalStorage, ring buffer, SSE client Set, route stats Map, header redaction,
 * _arc_p_push(), _arc_p_handle() (serves dashboard, toolbar.js, SSE, REST APIs).
 * Production guard: _arc_p_handle returns null when NODE_ENV=production.
 */
function profilerPreamble() {
  return `
// ── arc-profiler - injected by arc serve --profile ────────────────────────────
const { AsyncLocalStorage } = require('node:async_hooks')
const _arc_p_als = new AsyncLocalStorage()
const _arc_p_ring = []
const _arc_p_sse = new Set()
const _arc_p_stats = new Map()
const _arc_p_enc = new TextEncoder()
const _arc_p_dashboard = ${JSON.stringify(DASHBOARD_HTML)}
const _arc_p_toolbar = ${JSON.stringify(TOOLBAR_JS)}
const _arc_p_REDACT = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key'])
function _arc_p_redact(h) {
  const _o = {}
  for (const _k in h) _o[_k] = _arc_p_REDACT.has(_k.toLowerCase()) ? '[redacted]' : h[_k]
  return _o
}

function _arc_p_push(entry) {
  _arc_p_ring.push(entry)
  if (_arc_p_ring.length > 500) _arc_p_ring.shift()
  const _k = entry.method + ' ' + entry.route
  let _s = _arc_p_stats.get(_k)
  if (!_s) {
    if (_arc_p_stats.size >= 500) { const _fk = _arc_p_stats.keys().next().value; _arc_p_stats.delete(_fk) }
    _s = { method: entry.method, route: entry.route, hits: 0, errors: 0, samples: [] }
    _arc_p_stats.set(_k, _s)
  }
  _s.hits++
  if (entry.status >= 400) _s.errors++
  _s.samples.push(entry.total_ms)
  if (_s.samples.length > 300) _s.samples.shift()
  if (_arc_p_sse.size > 0) queueMicrotask(() => {
    const _msg = 'data: ' + JSON.stringify(entry) + '\\n\\n'
    const _buf = _arc_p_enc.encode(_msg)
    for (const _c of [..._arc_p_sse]) { try { _c.enqueue(_buf) } catch { _arc_p_sse.delete(_c) } }
  })
}

function _arc_p_pct(arr, p) {
  if (!arr.length) return 0
  return +(arr[Math.ceil(p / 100 * arr.length) - 1].toFixed(2))
}

let _arc_p_rt_cache = null, _arc_p_rt_ts = 0
function _arc_p_route_table() {
  const _now = Date.now()
  if (_arc_p_rt_cache && _now - _arc_p_rt_ts < 1000) return _arc_p_rt_cache
  _arc_p_rt_cache = Array.from(_arc_p_stats.values()).map(_s => {
    const sorted = [..._s.samples].sort((a, b) => a - b)
    return { method: _s.method, route: _s.route, hits: _s.hits, errors: _s.errors,
      avg: sorted.length ? +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2) : 0,
      p50: _arc_p_pct(sorted, 50), p95: _arc_p_pct(sorted, 95), p99: _arc_p_pct(sorted, 99) }
  }).sort((a, b) => b.hits - a.hits)
  _arc_p_rt_ts = _now
  return _arc_p_rt_cache
}

function _arc_p_handle(req, _pathname) {
  if (process.env.NODE_ENV === 'production') return null
  if (_pathname === '/_arc/profiler' || _pathname === '/_arc/profiler/') {
    return new Response(_arc_p_dashboard, { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } })
  }
  if (_pathname === '/_arc/profiler/toolbar.js') {
    return new Response(_arc_p_toolbar, { headers: { 'content-type': 'application/javascript', 'cache-control': 'no-store' } })
  }
  if (_pathname === '/_arc/profiler/api/requests') {
    const _url = new URL(req.url)
    const _lim = Math.min(+(_url.searchParams.get('limit') ?? 100), 500)
    return new Response(JSON.stringify(_arc_p_ring.slice(-_lim).reverse()), { headers: { 'content-type': 'application/json' } })
  }
  if (_pathname === '/_arc/profiler/api/routes') {
    return new Response(JSON.stringify(_arc_p_route_table()), { headers: { 'content-type': 'application/json' } })
  }
  if (_pathname === '/_arc/profiler/api/memory') {
    let _m
    try { _m = process.memoryUsage() } catch { _m = { rss: 0, heapUsed: 0, heapTotal: 0 } }
    return new Response(JSON.stringify({ rss: _m.rss, heapUsed: _m.heapUsed, heapTotal: _m.heapTotal, ts: Date.now() }), { headers: { 'content-type': 'application/json' } })
  }
  if (_pathname === '/_arc/profiler/events') {
    let _ctrl
    const _stream = new ReadableStream({
      start(_c) {
        _ctrl = _c
        try { _ctrl.enqueue(_arc_p_enc.encode('data: {"type":"connected"}\\n\\n')); _arc_p_sse.add(_ctrl) } catch {}
      },
      cancel() { if (_ctrl) _arc_p_sse.delete(_ctrl) }
    })
    return new Response(_stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' } })
  }
  return null
}
// ── end arc-profiler preamble ─────────────────────────────────────────────────`
}

function profilerDbWrapper() {
  return `
// arc-profiler: SQLite query interceptor
if (typeof _db !== 'undefined' && _db && typeof _db.query === 'function' && typeof _db.prepare === 'function') {
  const _arc_p_oq = _db.query.bind(_db)
  _db.query = (_arc_p_sql) => {
    const _arc_p_stmt = _arc_p_oq(_arc_p_sql)
    const _arc_p_w = (fn) => function(..._arc_p_a) {
      const _arc_p_t = performance.now()
      try {
        return fn.apply(this, _arc_p_a)
      } finally {
        const _arc_p_store = _arc_p_als.getStore()
        if (_arc_p_store) _arc_p_store.queries.push({ sql: _arc_p_sql.slice(0, 400), ms: +(performance.now() - _arc_p_t).toFixed(3) })
      }
    }
    _arc_p_stmt.all = _arc_p_w(_arc_p_stmt.all.bind(_arc_p_stmt))
    _arc_p_stmt.run = _arc_p_w(_arc_p_stmt.run.bind(_arc_p_stmt))
    _arc_p_stmt.get = _arc_p_w(_arc_p_stmt.get.bind(_arc_p_stmt))
    return _arc_p_stmt
  }
}`
}

module.exports = { profilerPreamble, profilerDbWrapper, DASHBOARD_HTML, TOOLBAR_JS }
