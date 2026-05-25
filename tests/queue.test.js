'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { Lexer } = require('../src/lexer')
const { Parser } = require('../src/parser')
const { Checker } = require('../src/checker')
const { BunServerEmitter } = require('../src/emitters/server-bun')
const { emitQueuePreamble, emitEmailPreamble, emitJobEnqueueWrapper } = require('../src/emitters/queue-helpers')

function parse(src) {
  const tokens = new Lexer(src).tokenize()
  return new Parser(tokens).parse()
}

// ── queue-helpers module ──────────────────────────────────────────────────────

test('emitQueuePreamble: emits _queue, Queue, drain', () => {
  const out = emitQueuePreamble()
  assert.ok(out.includes('const _queue ='), '_queue object emitted')
  assert.ok(out.includes('const Queue ='), 'Queue object emitted')
  assert.ok(out.includes('enqueue'), 'enqueue method emitted')
  assert.ok(out.includes('drain'), 'drain method emitted')
  assert.ok(out.includes('retries < 3'), 'retry logic emitted')
})

test('emitEmailPreamble: emits email.send with Resend + SMTP fallback', () => {
  const out = emitEmailPreamble()
  assert.ok(out.includes('const email ='), 'email object emitted')
  assert.ok(out.includes('RESEND_API_KEY'), 'Resend API key check emitted')
  assert.ok(out.includes('resend.com'), 'Resend endpoint emitted')
  assert.ok(out.includes('nodemailer'), 'SMTP fallback emitted')
  assert.ok(out.includes('SMTP_HOST'), 'SMTP_HOST env var emitted')
})

test('emitJobEnqueueWrapper: emits correct wrapper', () => {
  const out = emitJobEnqueueWrapper('SendWelcomeEmail')
  assert.strictEqual(out, 'const SendWelcomeEmail = (...args) => Queue.enqueue(_job_SendWelcomeEmail, ...args)')
})

// ── BunServerEmitter: queue + email preamble ──────────────────────────────────

test('BunServerEmitter: always emits Queue and email', () => {
  const prog = parse(`
@route get "/posts" -> Response
  json([])
`)
  const emitter = new BunServerEmitter()
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes('const Queue ='), 'Queue emitted')
  assert.ok(out.includes('const email ='), 'email emitted')
})

test('BunServerEmitter: emits job handler + enqueue wrapper', () => {
  const prog = parse(`
job SendWelcomeEmail(userId: Int)
  console.log("sending to", userId)

@route post "/register" -> Response
  json({ ok: true })
`)
  const emitter = new BunServerEmitter()
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes('async function _job_SendWelcomeEmail'), 'job handler emitted')
  assert.ok(out.includes('const SendWelcomeEmail ='), 'enqueue wrapper emitted')
  assert.ok(out.includes('Queue.enqueue(_job_SendWelcomeEmail'), 'wrapper enqueues correct job')
})

test('BunServerEmitter: job called from route uses enqueue wrapper', () => {
  const prog = parse(`
job ProcessOrder(orderId: Int)
  console.log("processing", orderId)

@route post "/orders" -> Response
  ProcessOrder(42)
  json({ ok: true })
`)
  const emitter = new BunServerEmitter()
  const out = emitter.emitProgram(prog)
  // The route body should call ProcessOrder(...) which resolves to the wrapper
  assert.ok(out.includes('ProcessOrder(42)'), 'route calls job wrapper')
  assert.ok(out.includes('const ProcessOrder ='), 'wrapper defined before route handler')
})

test('BunServerEmitter: multiple jobs each get their own wrapper', () => {
  const prog = parse(`
job SendEmail(userId: Int)
  console.log("email", userId)

job GenerateReport(reportId: Int)
  console.log("report", reportId)

@route get "/trigger" -> Response
  json({ ok: true })
`)
  const emitter = new BunServerEmitter()
  const out = emitter.emitProgram(prog)
  assert.ok(out.includes('const SendEmail ='), 'SendEmail wrapper emitted')
  assert.ok(out.includes('const GenerateReport ='), 'GenerateReport wrapper emitted')
})

// ── Checker: Queue + email in scope ──────────────────────────────────────────

test('checker: Queue and email in route scope', () => {
  const prog = parse(`
job Notify(id: Int)
  console.log(id)

@route post "/items" -> Response
  Notify(1)
  email.send({ to: "x@x.com", subject: "hi", text: "body" })
  json({ ok: true })
`)
  const checker = new Checker()
  const { errors } = checker.check(prog)
  assert.strictEqual(errors.length, 0, `unexpected errors: ${errors}`)
})

test('checker: email in job scope', () => {
  const prog = parse(`
job SendWelcome(userId: Int)
  email.send({ to: "user@example.com", subject: "Welcome", text: "Hello" })
`)
  const checker = new Checker()
  const { errors } = checker.check(prog)
  assert.strictEqual(errors.length, 0, `unexpected errors: ${errors}`)
})

// ── Queue runtime logic (pure JS, no Bun needed) ─────────────────────────────

function makeQueueRuntime() {
  const _queue = {
    _items: [],
    _running: false,
    enqueue(fn, args, retries = 0) {
      this._items.push({ fn, args, retries })
      if (!this._running) this._process()
    },
    async _process() {
      this._running = true
      while (this._items.length > 0) {
        const { fn, args } = this._items.shift()
        try { await fn(...args) } catch {}
      }
      this._running = false
    }
  }
  const Queue = {
    enqueue: (fn, ...args) => _queue.enqueue(fn, args),
    drain: () => new Promise(resolve => {
      const check = () => _queue._items.length === 0 && !_queue._running ? resolve() : setTimeout(check, 10)
      check()
    }),
  }
  return { _queue, Queue }
}

test('queue runtime: enqueue and process jobs in order', async () => {
  const { _queue, Queue } = makeQueueRuntime()
  const results = []

  Queue.enqueue(async (n) => results.push(n), 1)
  Queue.enqueue(async (n) => results.push(n), 2)
  Queue.enqueue(async (n) => results.push(n), 3)
  await Queue.drain()

  assert.deepStrictEqual(results, [1, 2, 3], 'jobs processed in FIFO order')
})

test('queue runtime: failed jobs do not block the queue', async () => {
  const { _queue, Queue } = makeQueueRuntime()
  const results = []

  Queue.enqueue(async () => { throw new Error('boom') })
  Queue.enqueue(async (n) => results.push(n), 'after-fail')
  await Queue.drain()

  assert.deepStrictEqual(results, ['after-fail'], 'queue continues after failed job')
})
