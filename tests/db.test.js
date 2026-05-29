'use strict'

const test = require('node:test')
const assert = require('node:assert')

// ── Exports ───────────────────────────────────────────────────────────────────

test('db module exports dbCommand and runSeed', () => {
  const db = require('../src/commands/db')
  assert.strictEqual(typeof db.dbCommand, 'function')
  assert.strictEqual(typeof db.runSeed, 'function')
})

// ── dbCommand help / studio / unknown ─────────────────────────────────────────

test('dbCommand: no args prints help and returns', async () => {
  const { dbCommand } = require('../src/commands/db')
  const logs = []
  const orig = console.log
  console.log = (...a) => logs.push(a.join(' '))
  try {
    await dbCommand([])
  } finally {
    console.log = orig
  }
  assert.ok(logs.some(l => l.includes('arc db')), `expected help output: ${JSON.stringify(logs)}`)
})

test('dbCommand: help subcommand prints help and returns', async () => {
  const { dbCommand } = require('../src/commands/db')
  const logs = []
  const orig = console.log
  console.log = (...a) => logs.push(a.join(' '))
  try {
    await dbCommand(['help'])
  } finally {
    console.log = orig
  }
  assert.ok(logs.some(l => l.includes('arc db')))
  assert.ok(logs.some(l => l.includes('migrate')))
})

test('dbCommand: studio subcommand prints coming-soon message', async () => {
  const { dbCommand } = require('../src/commands/db')
  const logs = []
  const orig = console.log
  console.log = (...a) => logs.push(a.join(' '))
  try {
    await dbCommand(['studio'])
  } finally {
    console.log = orig
  }
  assert.ok(logs.some(l => l.includes('coming')), `expected coming-soon: ${JSON.stringify(logs)}`)
})

test('dbCommand: unknown subcommand calls process.exit(1)', async () => {
  const { dbCommand } = require('../src/commands/db')
  const errors = []
  const origError = console.error
  const origExit = process.exit
  let exitCode = null
  console.error = (...a) => errors.push(a.join(' '))
  process.exit = (code) => { exitCode = code; throw new Error(`process.exit(${code})`) }
  try {
    await dbCommand(['foobar'])
  } catch (e) {
    // expected — process.exit throws in test
  } finally {
    console.error = origError
    process.exit = origExit
  }
  assert.strictEqual(exitCode, 1)
  assert.ok(errors.some(e => e.includes('foobar') || e.includes('unknown')), `expected error about unknown subcommand: ${JSON.stringify(errors)}`)
})

test('dbCommand: seed with nonexistent dir calls process.exit(1)', async () => {
  const { dbCommand } = require('../src/commands/db')
  const origExit = process.exit
  const origError = console.error
  let exitCode = null
  process.exit = (code) => { exitCode = code; throw new Error(`exit(${code})`) }
  console.error = () => {}
  try {
    await dbCommand(['seed', '/tmp/arc-no-such-dir-' + Date.now()])
  } catch (e) {
    // expected
  } finally {
    process.exit = origExit
    console.error = origError
  }
  assert.strictEqual(exitCode, 1)
})
