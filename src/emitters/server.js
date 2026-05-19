'use strict'

// @server function compiler.
// Input:  ServerFn AST nodes from the program
// Output: { edgeFunctions: string, clientStubs: string }
//
// Each @server fn becomes:
//   1. An edge handler at /_arc/fn/<name> (runs server-side)
//   2. A typed client stub (runs browser-side, fetches the endpoint via ADP)

const { JsEmitter } = require('./js')

// Inlined ADP encode/decode for generated edge workers (no require() in CF Workers ESM)
const ADP_EDGE_RUNTIME = `
// ADP encode/decode — inlined by Arc compiler (singletons avoid per-call allocation)
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
// ADP decode — inlined by Arc compiler
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
      case 8:{const n=vi();const o={};for(let i=0;i<n;i++){const k=rv();o[k]=rv()}return o}
      case 9:{const hi=((buf[p]<<24)|(buf[p+1]<<16)|(buf[p+2]<<8)|buf[p+3])>>>0;const lo=((buf[p+4]<<24)|(buf[p+5]<<16)|(buf[p+6]<<8)|buf[p+7])>>>0;p+=8;return new Date(hi*4294967296+lo)}
      default:throw new Error('ADP: unknown tag '+t)
    }
  }
  function vi(){let r=0,s=0;while(true){if(p>=buf.length)throw new Error('ADP: varint end');const b=buf[p++];r|=(b&0x7f)<<s;if(!(b&0x80))break;s+=7;if(s>35)throw new Error('ADP: varint overflow')}return r>>>0}
  return rv()
}
`

class ServerEmitter {
  constructor(options = {}) {
    this.options = options
    this.componentHash = options.hash ?? 'arc'
    this.jsEmitter = new JsEmitter(options)
  }

  emitProgram(program) {
    const serverFns = program.declarations.filter(d => d.type === 'ServerFn')
    if (serverFns.length === 0) return { edgeFunctions: '', clientStubs: '' }

    const edgeFunctions = this.emitEdgeFunctions(serverFns)
    const clientStubs = this.emitClientStubs(serverFns)

    return { edgeFunctions, clientStubs }
  }

  // ── Edge functions ─────────────────────────────────────────────────────────
  // Generated file: dist/_arc/fn/<name>.js
  // Compatible with Cloudflare Workers, Deno Deploy, Bun, Node.js (via adapters)

  emitEdgeFunctions(serverFns) {
    const parts = [
      ADP_EDGE_RUNTIME,
      ``,
    ]

    for (const fn of serverFns) {
      parts.push(this.emitEdgeHandler(fn))
    }

    // Router: dispatch by function name in path
    parts.push(this.emitEdgeRouter(serverFns))

    return parts.join('\n')
  }

  emitEdgeHandler(fn) {
    const SAFE_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
    if (!SAFE_IDENT.test(fn.name)) throw new Error(`Arc codegen: unsafe @server fn name: ${JSON.stringify(fn.name)}`)
    const params = (fn.params ?? []).map(p => p.name ?? p).join(', ')
    const body = this.jsEmitter.emitBody(fn.body?.body ?? fn.body)
    // Extract only own-property values to prevent prototype pollution via destructuring
    const paramExtract = (fn.params ?? []).map(p => {
      const name = p.name ?? p
      if (!SAFE_IDENT.test(name)) throw new Error(`Arc codegen: unsafe @server param name: ${JSON.stringify(name)}`)
      return `const ${name} = Object.prototype.hasOwnProperty.call(_body,'${name}') ? _body['${name}'] : undefined`
    }).join('; ')

    return [
      `// @server fn ${fn.name}`,
      `async function _handler_${fn.name}(req) {`,
      `  try {`,
      `    // Parse ADP or JSON request body`,
      `    const _body = req.method === 'POST' ? await _parseBody(req) : {}`,
      paramExtract ? `    ${paramExtract}` : '',
      `    const _session = req._arc_session ?? {}  // injected by auth middleware`,
      `    const _result = await (async function() {`,
      `      ${body}`,
      `    })()`,
      `    const _encoded = Array.isArray(_result) ? _adpEncodeArray(_result) : _adpEncode(_result)`,
      `    return new Response(_encoded, {`,
      `      headers: { 'Content-Type': 'application/x-adp', 'Content-Length': String(_encoded.length) }`,
      `    })`,
      `  } catch (_e) {`,
      `    console.error('[arc] @server ${fn.name} error:', _e)`,
      `    return new Response(JSON.stringify({ error: 'Internal server error' }), {`,
      `      status: 500, headers: { 'Content-Type': 'application/json' }`,
      `    })`,
      `  }`,
      `}`,
      ``,
    ].filter(s => s !== '').join('\n')
  }

  emitEdgeRouter(serverFns) {
    const cases = serverFns.map(fn =>
      `  if (_path === '/_arc/fn/${fn.name}') return _handler_${fn.name}(req)`
    ).join('\n')

    return [
      `async function _parseBody(req) {`,
      `  const ct = req.headers.get?.('content-type') ?? req.headers['content-type'] ?? ''`,
      `  const cl = parseInt(req.headers.get?.('content-length') ?? req.headers['content-length'] ?? '0')`,
      `  if (Number.isFinite(cl) && cl > 1048576) throw new Error('Request body too large (max 1MB)')`,
      `  const buf = await req.arrayBuffer()`,
      `  if (buf.byteLength > 1048576) throw new Error('Request body too large (max 1MB)')`,
      `  if (ct.includes('application/x-adp')) {`,
      `    const decoded = _adpDecode(new Uint8Array(buf))`,
      `    return (decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)) ? decoded : {}`,
      `  }`,
      `  const text = _adpTdec.decode(buf) || '{}'`,
      `  try { return JSON.parse(text) } catch { throw new Error('Invalid request body: expected JSON or ADP') }`,
      `}`,
      ``,
      `// Cloudflare Workers / WinterCG fetch handler`,
      `export default {`,
      `  async fetch(req) {`,
      `    let _path; try { _path = new URL(req.url).pathname } catch { return new Response('Bad Request', { status: 400 }) }`,
      `${cases}`,
      `    return new Response('Not Found', { status: 404 })`,
      `  }`,
      `}`,
      ``,
      `// Node.js / Bun / Deno adapter`,
      `if (typeof module !== 'undefined') module.exports = { ${serverFns.map(f => `_handler_${f.name}`).join(', ')} }`,
    ].join('\n')
  }

  // ── Client stubs ────────────────────────────────────────────────────────────
  // Injected into the browser JS bundle.
  // Each stub is a typed async function that calls the edge endpoint via ADP.

  emitClientStubs(serverFns) {
    const parts = []

    for (const fn of serverFns) {
      parts.push(this.emitClientStub(fn))
    }

    return parts.join('\n')
  }

  emitClientStub(fn) {
    const params = (fn.params ?? []).map(p => {
      const name = p.name ?? p
      const def = p.defaultValue ? `=${this.jsEmitter.emitExpr(p.defaultValue)}` : ''
      return `${name}${def}`
    }).join(', ')

    const argNames = (fn.params ?? []).map(p => p.name ?? p)
    const argObj = argNames.length > 0
      ? `{${argNames.join(',')}}`
      : 'null'

    return [
      `async function ${fn.name}(${params}) {`,
      `  const _ctrl = new AbortController()`,
      `  const _tid = setTimeout(() => _ctrl.abort(), 30000)`,
      `  try {`,
      `    const _res = await fetch('/_arc/fn/${fn.name}', {`,
      `      method: 'POST',`,
      `      headers: {'Content-Type': 'application/x-adp'},`,
      `      body: _adpEncode(${argObj}),`,
      `      signal: _ctrl.signal`,
      `    })`,
      `    if (!_res.ok) {`,
      `      const _et = await _res.text()`,
      `      let _em; try { _em = JSON.parse(_et).error ?? _et } catch { _em = _et }`,
      `      throw new Error(_em)`,
      `    }`,
      `    const _buf = await _res.arrayBuffer()`,
      `    if (_buf.byteLength > 10 * 1024 * 1024) throw new Error('Response too large')`,
      `    return _adpDecode(new Uint8Array(_buf))`,
      `  } finally { clearTimeout(_tid) }`,
      `}`,
    ].join('\n')
  }
}

module.exports = { ServerEmitter }
