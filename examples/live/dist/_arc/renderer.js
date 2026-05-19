'use strict'
// Arc @live edge renderer — auto-generated
// One request → edge resolves data → full HTML → browser

const BASE_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>Dashboard</title>\n<meta name=\"description\" content=\"Dashboard\">\n<link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n<header><h2>Dashboard</h2>\n<p>Welcome back, <span id=\"_a1\"></span></p></header>\n<main><div class=\"arc-row_3pqs\"><div class=\"arc-card_3pqs\"><h2>Users</h2>\n<p><span id=\"_a2\"></span></p></div>\n<div class=\"arc-card_3pqs\"><h2>Posts</h2>\n<p><span id=\"_a3\"></span></p></div>\n<div class=\"arc-card_3pqs\"><h2>Revenue</h2>\n<p>$<span id=\"_a4\"></span></p></div></div>\n<div class=\"arc-card_3pqs\"><div class=\"arc-row_3pqs\"><button id=\"_a5\">Overview</button>\n<button id=\"_a6\">Analytics</button></div>\n<p>Tab: <span id=\"_a7\"></span></p></div></main>\n</body>\n</html>"
const BASE_CSS = "@layer base {\n  *, *::before, *::after { box-sizing: border-box }\n  :root {\n    --arc-font-sans: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;\n    --arc-font-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;\n    --arc-font-serif: Lora, Georgia, serif;\n    --arc-radius-sm: 4px;\n    --arc-radius-md: 8px;\n    --arc-radius-lg: 12px;\n    --arc-radius-xl: 16px;\n    --arc-radius-2xl: 24px;\n    --arc-radius-full: 9999px;\n    --arc-shadow-sm: 0 1px 2px oklch(0% 0 0 / 0.05);\n    --arc-shadow-md: 0 4px 6px oklch(0% 0 0 / 0.07), 0 1px 3px oklch(0% 0 0 / 0.06);\n    --arc-shadow-lg: 0 10px 15px oklch(0% 0 0 / 0.08), 0 4px 6px oklch(0% 0 0 / 0.05);\n    --arc-shadow-xl: 0 20px 25px oklch(0% 0 0 / 0.10), 0 8px 10px oklch(0% 0 0 / 0.04);\n  }\n  .arc-row { display: flex; flex-direction: row }\n  .arc-col { display: flex; flex-direction: column }\n  .arc-center { display: flex; align-items: center; justify-content: center }\n  .arc-spacer { flex: 1 0 auto }\n  .arc-wrap { display: flex; flex-wrap: wrap }\n}"
const CLIENT_JS = "// ADP mini-runtime (auto-generated)\nfunction _adpEncode(v){const b=[];function w(x){if(x===null||x===undefined){b.push(0);}else if(x===true){b.push(1);}else if(x===false){b.push(2);}else if(typeof x==='number'){if(Number.isInteger(x)&&x>=0&&x<=255){b.push(3,x);}else if(Number.isInteger(x)){b.push(4,(x>>>24)&255,(x>>>16)&255,(x>>>8)&255,x&255);}else{b.push(5);const d=new DataView(new ArrayBuffer(8));d.setFloat64(0,x,false);for(let i=0;i<8;i++)b.push(d.getUint8(i));}}else if(typeof x==='string'){b.push(6);const e=new TextEncoder().encode(x);let l=e.length;while(l>127){b.push((l&127)|128);l>>>=7;}b.push(l);e.forEach(c=>b.push(c));}else if(Array.isArray(x)){b.push(7);let l=x.length;while(l>127){b.push((l&127)|128);l>>>=7;}b.push(l);x.forEach(w);}else if(typeof x==='object'){const ks=Object.keys(x);b.push(8);let l=ks.length;while(l>127){b.push((l&127)|128);l>>>=7;}b.push(l);ks.forEach(k=>{const e=new TextEncoder().encode(k);let kl=e.length;while(kl>127){b.push((kl&127)|128);kl>>>=7;}b.push(kl);e.forEach(c=>b.push(c));w(x[k]);});}}w(v);return new Uint8Array(b);}\nfunction _adpDecode(buf){let p=0;function rv(){const t=buf[p++];if(t===0)return null;if(t===1)return true;if(t===2)return false;if(t===3)return buf[p++];if(t===4){const v=(buf[p]<<24)|(buf[p+1]<<16)|(buf[p+2]<<8)|buf[p+3];p+=4;return v;}if(t===5){const d=new DataView(buf.buffer,buf.byteOffset+p,8);p+=8;return d.getFloat64(0,false);}if(t===6){let l=0,s=0;while(true){const b=buf[p++];l|=(b&127)<<s;if(!(b&128))break;s+=7;}return new TextDecoder().decode(buf.subarray(p,p+=l));}if(t===7){let l=0,s=0;while(true){const b=buf[p++];l|=(b&127)<<s;if(!(b&128))break;s+=7;}return Array.from({length:l},rv);}if(t===8){let l=0,s=0;while(true){const b=buf[p++];l|=(b&127)<<s;if(!(b&128))break;s+=7;}const o={};for(let i=0;i<l;i++){let kl=0,ks=0;while(true){const b=buf[p++];kl|=(b&127)<<ks;if(!(b&128))break;ks+=7;}const k=new TextDecoder().decode(buf.subarray(p,p+=kl));o[k]=rv();}return o;}throw new Error('ADP: unknown tag '+t);}return rv();}\nasync function getUser(id) {\n  const _res = await fetch('/_arc/fn/getUser', {\n    method: 'POST',\n    headers: {'Content-Type': 'application/x-adp'},\n    body: _adpEncode({id})\n  })\n  if (!_res.ok) throw new Error(await _res.text())\n  const _buf = await _res.arrayBuffer()\n  return _adpDecode(new Uint8Array(_buf))\n}\nasync function getStats() {\n  const _res = await fetch('/_arc/fn/getStats', {\n    method: 'POST',\n    headers: {'Content-Type': 'application/x-adp'},\n    body: _adpEncode(null)\n  })\n  if (!_res.ok) throw new Error(await _res.text())\n  const _buf = await _res.arrayBuffer()\n  return _adpDecode(new Uint8Array(_buf))\n}\n(function(){\nlet _activeTab=\"overview\";\nconst _el__a1=document.getElementById('_a1');\nconst _el__a2=document.getElementById('_a2');\nconst _el__a3=document.getElementById('_a3');\nconst _el__a4=document.getElementById('_a4');\nconst _el__a7=document.getElementById('_a7');\nfunction _set_activeTab(v){\n_activeTab=v;\n_el__a7.textContent=_activeTab;\n}\ndocument.getElementById('_a5').addEventListener('click',function(event){_set_activeTab(\"overview\");});\ndocument.getElementById('_a6').addEventListener('click',function(event){_set_activeTab(\"analytics\");});\n_el__a1.textContent=user.name;\n_el__a2.textContent=stats.users;\n_el__a3.textContent=stats.posts;\n_el__a4.textContent=stats.revenue;\n_el__a7.textContent=_activeTab;\n})();"

// @server functions — run at request time on the edge
async function getUser(id) {
  return {"name":"Alex Chen","role":"admin"};
}

async function getStats() {
  return {"users":12483,"posts":3721,"revenue":94200};
}

async function _resolveData(request) {
  const _session = request._arc_session ?? {}
  try {
  const user = await (getUser("current"))
  const stats = await (getStats())
    return { user, stats }
  } catch (e) {
    return { _error: e.message }
  }
}

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function _fillHtml(data) {
  const { user, stats } = data
  let html = BASE_HTML
  html = html.replace('<span id="_a1"></span>', _esc(String(user.name ?? '')))
  html = html.replace('<span id="_a2"></span>', _esc(String(stats.users ?? '')))
  html = html.replace('<span id="_a3"></span>', _esc(String(stats.posts ?? '')))
  html = html.replace('<span id="_a4"></span>', _esc(String(stats.revenue ?? '')))
  html = html.replace('<link rel="stylesheet" href="styles.css">', `<style>${BASE_CSS}</style>`)
  if (CLIENT_JS) html = html.replace('<script src="app.js"></script>', `<script>${CLIENT_JS}</script>`)
  return html
}

// WinterCG fetch handler (Cloudflare Workers / Deno Deploy / Bun)
export default {
  async fetch(request, env, ctx) {
    try {
      const data = await _resolveData(request)
      if (data._error) {
        return new Response('Internal Server Error: ' + data._error, { status: 500 })
      }
      const html = _fillHtml(data)
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, no-cache',
        },
      })
    } catch (e) {
      return new Response(e.message, { status: 500 })
    }
  }
}

// Node.js / Bun / Deno adapter
if (typeof module !== 'undefined') module.exports = { _resolveData, _fillHtml }