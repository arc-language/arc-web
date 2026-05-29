#!/usr/bin/env bun
'use strict'

// arc-profiler proxy mode — zero-config HTTP profiling wrapper.
// Usage: bunx arc-profiler [target-port] [--port <profiler-port>]
//
// Starts a proxy on --port (default 3001) that forwards to the Arc server at target-port (default 3000).
// Measures HTTP-level latency. For deep SQL/DB profiling use `arc serve --profile` instead.

const { Collector } = require('./collector')
const { DASHBOARD_HTML, TOOLBAR_JS } = require('../../src/profiler/hooks')

const args = process.argv.slice(2)
const targetPort = +(args.find(a => /^\d+$/.test(a)) ?? 3000)
const profilePortIdx = args.indexOf('--port')
const profilePort = profilePortIdx !== -1 ? +(args[profilePortIdx + 1] ?? 3001) : 3001

const collector = new Collector()
const sseClients = new Set()
const enc = new TextEncoder()
const REDACT = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key'])

function redactHeaders(h) {
  const out = {}
  for (const [k, v] of Object.entries(h)) out[k] = REDACT.has(k.toLowerCase()) ? '[redacted]' : v
  return out
}

function pushEntry(entry) {
  collector.push(entry)
  if (sseClients.size > 0) {
    queueMicrotask(() => {
      const msg = `data: ${JSON.stringify(entry)}\n\n`
      const buf = enc.encode(msg)
      for (const c of [...sseClients]) { try { c.enqueue(buf) } catch { sseClients.delete(c) } }
    })
  }
}

const TARGET = `http://127.0.0.1:${targetPort}`

const server = Bun.serve({
  port: profilePort,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url)
    const pathname = url.pathname

    // Profiler routes
    if (pathname === '/_arc/profiler' || pathname === '/_arc/profiler/') {
      return new Response(DASHBOARD_HTML, { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } })
    }
    if (pathname === '/_arc/profiler/toolbar.js') {
      return new Response(TOOLBAR_JS, { headers: { 'content-type': 'application/javascript', 'cache-control': 'no-store' } })
    }
    if (pathname === '/_arc/profiler/api/requests') {
      const limit = Math.min(+(url.searchParams.get('limit') ?? 100), 500)
      return new Response(JSON.stringify(collector.recent(limit)), { headers: { 'content-type': 'application/json' } })
    }
    if (pathname === '/_arc/profiler/api/routes') {
      return new Response(JSON.stringify(collector.routeTable()), { headers: { 'content-type': 'application/json' } })
    }
    if (pathname === '/_arc/profiler/api/memory') {
      let m
      try { m = process.memoryUsage() } catch { m = { rss: 0, heapUsed: 0, heapTotal: 0 } }
      return new Response(JSON.stringify({ rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, ts: Date.now() }), { headers: { 'content-type': 'application/json' } })
    }
    if (pathname === '/_arc/profiler/events') {
      let ctrl
      const stream = new ReadableStream({
        start(c) {
          ctrl = c
          try { ctrl.enqueue(enc.encode('data: {"type":"connected"}\n\n')); sseClients.add(ctrl) } catch {}
        },
        cancel() { if (ctrl) sseClients.delete(ctrl) }
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' } })
    }

    // Proxy to target
    const t0 = performance.now()
    const proxyUrl = TARGET + url.pathname + url.search
    let resp
    try {
      resp = await fetch(proxyUrl, {
        method: req.method,
        headers: Object.fromEntries(req.headers),
        body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      })
    } catch (e) {
      return new Response(
        `arc-profiler: upstream unavailable — is the Arc server running on port ${targetPort}?\n${e?.message ?? String(e)}`,
        { status: 502, headers: { 'content-type': 'text/plain' } }
      )
    }

    const total_ms = +(performance.now() - t0).toFixed(3)
    let mem = 0; try { mem = process.memoryUsage().rss } catch {}
    const entry = {
      id: Date.now().toString(36).slice(-6),
      ts: Date.now(),
      method: req.method,
      path: pathname,
      route: pathname,
      status: resp.status,
      total_ms,
      queries: [],
      mem,
      reqHeaders: redactHeaders(Object.fromEntries(req.headers)),
      resHeaders: redactHeaders(Object.fromEntries(resp.headers)),
    }
    pushEntry(entry)
    return resp
  },
})

process.on('SIGTERM', () => { server.stop(true); process.exit(0) })
process.on('SIGINT', () => { server.stop(true); process.exit(0) })

console.log(`\n  \x1b[36marc-profiler\x1b[0m  (proxy mode)`)
console.log(`  \x1b[2m●  proxying http://localhost:${targetPort}\x1b[0m`)
console.log(`  \x1b[2m◆  dashboard   http://localhost:${profilePort}/_arc/profiler\x1b[0m\n`)
console.log(`  \x1b[2mNote: proxy mode measures HTTP latency only. For SQL/DB profiling, use \`arc serve --profile\`.\x1b[0m\n`)
