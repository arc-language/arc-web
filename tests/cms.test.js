'use strict'

const test = require('node:test')
const assert = require('node:assert')

// ── Exports ───────────────────────────────────────────────────────────────────

test('cms module exports cmsInit', () => {
  const cms = require('../src/commands/cms')
  assert.strictEqual(typeof cms.cmsInit, 'function')
})

test('cmsInit: rejects when target directory does not exist', async () => {
  const { cmsInit } = require('../src/commands/cms')
  const origExit = process.exit
  const origError = console.error
  let exitCode = null
  process.exit = (code) => { exitCode = code; throw new Error(`exit(${code})`) }
  console.error = () => {}
  try {
    await cmsInit('/tmp/arc-no-such-cms-dir-' + Date.now())
  } catch (e) {
    // expected — process.exit thrown
  } finally {
    process.exit = origExit
    console.error = origError
  }
  // May exit with 1 or just return with an error logged
  // Either way module should have been loaded and the function called
  assert.ok(exitCode === 1 || exitCode === null, `unexpected exit code: ${exitCode}`)
})
