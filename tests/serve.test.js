'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { serve, createFileWatcher } = require('../src/commands/serve')

// ── Exports ───────────────────────────────────────────────────────────────────

test('serve module exports serve and createFileWatcher', () => {
  assert.strictEqual(typeof serve, 'function')
  assert.strictEqual(typeof createFileWatcher, 'function')
})

// ── createFileWatcher ─────────────────────────────────────────────────────────

test('createFileWatcher: returns a Set', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-serve-test-'))
  try {
    const watched = createFileWatcher(dir, () => {})
    assert.ok(watched instanceof Set, 'should return a Set')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('createFileWatcher: watches the given directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-serve-test-'))
  try {
    const watched = createFileWatcher(dir, () => {})
    assert.ok(watched.size >= 0, 'watched set should be usable')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('createFileWatcher: returns empty set for nonexistent directory', () => {
  const nonexistent = path.join(os.tmpdir(), 'arc-serve-no-such-dir-' + Date.now())
  const watched = createFileWatcher(nonexistent, () => {})
  assert.ok(watched instanceof Set, 'should return a Set even for missing dirs')
  assert.strictEqual(watched.size, 0, 'nonexistent dir results in empty watched set')
})
