'use strict'

// Standalone metric ring buffer + percentile tracking.
// Used by proxy mode; the injected server code uses an inline version.

class Collector {
  constructor(maxSize = 500) {
    this.maxSize = maxSize
    this.ring = []
    this.routeStats = new Map()
  }

  push(entry) {
    this.ring.push(entry)
    if (this.ring.length > this.maxSize) this.ring.shift()

    const key = `${entry.method} ${entry.route ?? entry.path}`
    let s = this.routeStats.get(key)
    if (!s) {
      s = { method: entry.method, route: entry.route ?? entry.path, hits: 0, errors: 0, samples: [] }
      this.routeStats.set(key, s)
    }
    s.hits++
    if (entry.status >= 400) s.errors++
    s.samples.push(entry.total_ms)
    if (s.samples.length > 300) s.samples.shift()
  }

  recent(limit = 100) {
    return this.ring.slice(-Math.min(limit, this.maxSize)).reverse()
  }

  routeTable() {
    return Array.from(this.routeStats.values()).map(s => {
      const sorted = [...s.samples].sort((a, b) => a - b)
      return {
        method: s.method,
        route: s.route,
        hits: s.hits,
        errors: s.errors,
        avg: sorted.length ? +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2) : 0,
        p50: this._pct(sorted, 50),
        p95: this._pct(sorted, 95),
        p99: this._pct(sorted, 99),
      }
    }).sort((a, b) => b.hits - a.hits)
  }

  _pct(sorted, p) {
    if (!sorted.length) return 0
    return +(sorted[Math.ceil(p / 100 * sorted.length) - 1].toFixed(2))
  }
}

module.exports = { Collector }
