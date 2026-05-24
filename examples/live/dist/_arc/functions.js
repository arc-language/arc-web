
// ADP encode/decode: inlined by Arc compiler (singletons avoid per-call allocation)
const _adpTenc=new TextEncoder();const _adpTdec=new TextDecoder()
function _adpEncode(val){
  const b=[]
  function w(v){
    if(v===null||v===undefined){b.push(0);return}
    if(v===true){b.push(1);return}
    if(v===false){b.push(2);return}
    if(v instanceof Date){b.push(9);const n=v.getTime();const hi=Math.floor(n/0x100000000);const lo=n>>>0;b.push((hi>>>24)&0xff,(hi>>>16)&0xff,(hi>>>8)&0xff,hi&0xff,(lo>>>24)&0xff,(lo>>>16)&0xff,(lo>>>8)&0xff,lo&0xff);return}
    if(Array.isArray(v)){b.push(7);vi(v.length);for(const x of v)w(x);return}
    if(typeof v==='number'){if(Number.isInteger(v)&&v>=0&&v<=255){b.push(3,v)}else if(Number.isInteger(v)&&v>=-2147483648&&v<=2147483647){b.push(4);b.push((v>>>24)&0xff,(v>>>16)&0xff,(v>>>8)&0xff,v&0xff)}else{b.push(5);const dv=new DataView(new ArrayBuffer(8));dv.setFloat64(0,v,false);for(let i=0;i<8;i++)b.push(dv.getUint8(i))};return}
    if(typeof v==='string'){b.push(6);ws(v);return}
    if(typeof v==='object'){const ks=Object.keys(v);b.push(8);vi(ks.length);for(const k of ks){ws(k);w(v[k])};return}
    b.push(6);ws(String(v))
  }
  function ws(s){const e=_adpTenc.encode(s);vi(e.length);for(const x of e)b.push(x)}
  function vi(n){while(n>127){b.push((n&0x7f)|0x80);n>>>=7}b.push(n)}
  w(val);return new Uint8Array(b)
}
function _adpEncodeArray(items){
  const b=[7];function vi(n){while(n>127){b.push((n&0x7f)|0x80);n>>>=7}b.push(n)}
  vi(items.length);for(const item of items){const r=_adpEncode(item);for(const x of r)b.push(x)}
  return new Uint8Array(b)
}
// ADP decode: inlined by Arc compiler
function _adpDecode(buf){
  let p=0
  function rv(){
    if(p>=buf.length)throw new Error('ADP: unexpected end')
    const t=buf[p++]
    switch(t){
      case 0:return null
      case 1:return true
      case 2:return false
      case 3:return buf[p++]
      case 4:{const v=(buf[p]<<24)|(buf[p+1]<<16)|(buf[p+2]<<8)|buf[p+3];p+=4;return v}
      case 5:{const dv=new DataView(buf.buffer,buf.byteOffset+p,8);p+=8;return dv.getFloat64(0,false)}
      case 6:{const l=vi();if(p+l>buf.length)throw new Error('ADP: string overflow');const s=_adpTdec.decode(buf.subarray(p,p+l));p+=l;return s}
      case 7:{const n=vi();const a=new Array(n);for(let i=0;i<n;i++)a[i]=rv();return a}
      case 8:{const n=vi();const o=Object.create(null);for(let i=0;i<n;i++){const k=rv();const v=rv();if(k!=='__proto__'&&k!=='constructor'&&k!=='prototype')o[k]=v;}return o}
      case 9:{const hi=(buf[p]<<24)|(buf[p+1]<<16)|(buf[p+2]<<8)|buf[p+3];const lo=((buf[p+4]<<24)|(buf[p+5]<<16)|(buf[p+6]<<8)|buf[p+7])>>>0;p+=8;return new Date(hi*4294967296+lo)}
      default:throw new Error('ADP: unknown tag '+t)
    }
  }
  function vi(){let r=0,s=0;while(true){if(p>=buf.length)throw new Error('ADP: varint end');const b=buf[p++];r|=(b&0x7f)<<s;if(!(b&0x80))break;s+=7;if(s>35)throw new Error('ADP: varint overflow')}return r>>>0}
  return rv()
}


// @server fn getUser
async function _handler_getUser(req) {
  try {
    // Parse ADP or JSON request body
    const _body = req.method === 'POST' ? await _parseBody(req) : {}
    const id = Object.prototype.hasOwnProperty.call(_body,'id') ? _body['id'] : undefined
    const _session = req._arc_session ?? {}  // injected by auth middleware
    const _result = await (async function() {
      return {"name":"Alex Chen","role":"admin"};
    })()
    const _encoded = Array.isArray(_result) ? _adpEncodeArray(_result) : _adpEncode(_result)
    return new Response(_encoded, {
      headers: { 'Content-Type': 'application/x-adp', 'Content-Length': String(_encoded.length) }
    })
  } catch (_e) {
    console.error('[arc] @server getUser error:', _e)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
}
// @server fn getStats
async function _handler_getStats(req) {
  try {
    // Parse ADP or JSON request body
    const _body = req.method === 'POST' ? await _parseBody(req) : {}
    const _session = req._arc_session ?? {}  // injected by auth middleware
    const _result = await (async function() {
      return {"users":12483,"posts":3721,"revenue":94200};
    })()
    const _encoded = Array.isArray(_result) ? _adpEncodeArray(_result) : _adpEncode(_result)
    return new Response(_encoded, {
      headers: { 'Content-Type': 'application/x-adp', 'Content-Length': String(_encoded.length) }
    })
  } catch (_e) {
    console.error('[arc] @server getStats error:', _e)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
}
async function _parseBody(req) {
  const ct = req.headers.get?.('content-type') ?? req.headers['content-type'] ?? ''
  const cl = parseInt(req.headers.get?.('content-length') ?? req.headers['content-length'] ?? '0')
  if (Number.isFinite(cl) && cl > 1048576) throw new Error('Request body too large (max 1MB)')
  const buf = await req.arrayBuffer()
  if (buf.byteLength > 1048576) throw new Error('Request body too large (max 1MB)')
  if (ct.includes('application/x-adp')) {
    const decoded = _adpDecode(new Uint8Array(buf))
    return (decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)) ? decoded : {}
  }
  const text = _adpTdec.decode(buf) || '{}'
  try { const p = JSON.parse(text); return (p !== null && typeof p === 'object' && !Array.isArray(p)) ? p : {} } catch { throw new Error('Invalid request body: expected JSON or ADP') }
}

// Cloudflare Workers / WinterCG fetch handler
export default {
  async fetch(req) {
    let _path; try { _path = new URL(req.url).pathname } catch { return new Response('Bad Request', { status: 400 }) }
  if (_path === '/_arc/fn/getUser') return _handler_getUser(req)
  if (_path === '/_arc/fn/getStats') return _handler_getStats(req)
    return new Response('Not Found', { status: 404 })
  }
}

// Node.js / Bun / Deno adapter
if (typeof module !== 'undefined') module.exports = { _handler_getUser, _handler_getStats }