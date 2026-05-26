'use strict'

// Queue and email helpers emitted into generated server.js.
// Zero external dependencies — works in Bun and Node 18+.
//
// Queue: in-process async queue with retry (exponential backoff, max 3 retries).
//   IMPORTANT: this queue is NOT persistent — jobs enqueued during a crash or restart
//   will be lost. For durable queues, use arc build --target cloudflare (CF Queues)
//   or integrate a persistent queue adapter (BullMQ + Redis, etc.).
// Email: Resend API (HTTP) primary, nodemailer SMTP fallback.

function emitQueuePreamble() {
  return `
// ── Queue ─────────────────────────────────────────────────────────────────────

const _JOB_TIMEOUT_MS = 30000
function _jobTimeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('job timed out after ' + ms + 'ms')), ms))
}

const _queue = {
  _items: [],
  _dead: [],
  _running: false,
  _pendingRetries: 0,
  _drainResolvers: [],
  enqueue(fn, args, retries = 0) {
    this._items.push({ fn, args, retries })
    if (!this._running) this._process()
  },
  async _process() {
    // Set _running before any await so re-entrant enqueue() calls don't spawn a second _process()
    this._running = true
    try {
      while (this._items.length > 0) {
        const { fn, args, retries } = this._items.shift()
        try {
          await Promise.race([fn(...args), _jobTimeout(_JOB_TIMEOUT_MS)])
        } catch (_e) {
          console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', queue: fn?.name ?? 'unknown', msg: _e?.message ?? String(_e) }))
          if (retries < 3) {
            // Jitter prevents all failed jobs from retrying simultaneously (thundering herd)
            const delay = Math.pow(2, retries) * 1000 + Math.random() * 500
            this._pendingRetries++
            setTimeout(() => { this._pendingRetries--; this.enqueue(fn, args, retries + 1); this._maybeDrain() }, delay)
          } else {
            console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', queue: fn?.name ?? 'unknown', event: 'dlq', msg: '[arc:queue] job permanently failed after 3 retries — moved to dead letter queue', error: _e?.message ?? String(_e) }))
            if (this._dead.length >= 1000) { this._dead.shift(); console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', msg: '[arc:queue] DLQ cap reached — oldest entry evicted' })) }
            this._dead.push({ fn, args, error: _e?.message ?? String(_e), failedAt: new Date().toISOString() })
          }
        }
      }
    } finally {
      this._running = false
    }
    // Notify drain waiters AFTER _running is false so any work enqueued from within
    // a drain callback correctly starts a new _process() rather than being dropped.
    this._maybeDrain()
  },
  _maybeDrain() {
    // Called from both _process() end and retry callbacks so drain resolvers fire
    // only when the queue is truly idle (no items, not running, no pending retries).
    if (this._items.length === 0 && !this._running && this._pendingRetries === 0) {
      const resolvers = this._drainResolvers.splice(0)
      for (const resolve of resolvers) resolve()
    }
  }
}

const Queue = {
  enqueue: (fn, ...args) => _queue.enqueue(fn, args),
  size: () => _queue._items.length,
  dead: () => [..._queue._dead],
  drain: (timeoutMs = 30000) => new Promise((resolve, reject) => {
    if (_queue._items.length === 0 && !_queue._running && _queue._pendingRetries === 0) return resolve()
    const timer = setTimeout(() => reject(new Error('[arc:queue] drain timed out after ' + timeoutMs + 'ms')), timeoutMs)
    _queue._drainResolvers.push(() => { clearTimeout(timer); resolve() })
  }),
}`.trim()
}

function emitEmailPreamble() {
  return `
// ── Email ─────────────────────────────────────────────────────────────────────

const email = {
  send: async ({ to, subject, text, html, from, replyTo }) => {
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      const _body = JSON.stringify({
        from: from ?? process.env.EMAIL_FROM ?? 'noreply@example.com',
        to: Array.isArray(to) ? to : [to],
        subject, text, html, reply_to: replyTo,
      })
      let res = null
      for (let _attempt = 0; _attempt <= 1; _attempt++) {
        if (_attempt > 0) await new Promise(r => setTimeout(r, 1000 + Math.random() * 500))
        try {
          res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: \`Bearer \${resendKey}\`, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(15000),
            body: _body,
          })
          if (res.ok || res.status < 500) break
        } catch (_fetchErr) {
          if (_attempt >= 1) throw _fetchErr
          // network error — retry once
        }
      }
      if (res && !res.ok) {
        const _errBody = await res.text().catch(() => '')
        throw new Error(\`[arc:email] Resend error: HTTP \${res.status}\${_errBody ? ' — ' + _errBody.slice(0, 120) : ''}\`)
      }
      return res ? res.json() : null
    }
    // SMTP fallback via nodemailer
    try {
      const nodemailer = require('nodemailer')
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? 'localhost',
        port: +(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      })
      return await transport.sendMail({
        from: from ?? process.env.EMAIL_FROM ?? 'noreply@example.com',
        to, subject, text, html,
        replyTo,
      })
    } catch (_smtpErr) {
      if (_smtpErr?.code === 'MODULE_NOT_FOUND') {
        console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', msg: '[arc:email] No provider configured — set RESEND_API_KEY or SMTP_HOST.' }))
      } else {
        throw _smtpErr
      }
    }
  },
}`.trim()
}

// Emit the public enqueue wrapper for a job: `const JobName = (...args) => Queue.enqueue(_job_JobName, ...args)`
function emitJobEnqueueWrapper(jobName) {
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(jobName)) throw new Error(`Arc codegen: unsafe job name: ${JSON.stringify(jobName)}`)
  return `const ${jobName} = (...args) => Queue.enqueue(_job_${jobName}, ...args)`
}

module.exports = { emitQueuePreamble, emitEmailPreamble, emitJobEnqueueWrapper }
