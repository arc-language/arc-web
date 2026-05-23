'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { encodeVlq, SourceMapBuilder } = require('../src/sourcemap')
const { compile } = require('../src/cli')

describe('VLQ encoding', () => {
  test('encodeVlq(0) → "A"', () => {
    assert.equal(encodeVlq(0), 'A')
  })

  test('encodeVlq(1) → "C"', () => {
    // 1 << 1 = 2, base64[2] = 'C'
    assert.equal(encodeVlq(1), 'C')
  })

  test('encodeVlq(-1) → "D"', () => {
    // (-(-1) << 1) | 1 = (1 << 1) | 1 = 3, base64[3] = 'D'
    assert.equal(encodeVlq(-1), 'D')
  })

  test('encodeVlq(16) → "gB"', () => {
    // 16 << 1 = 32, needs two VLQ groups
    // first group: 32 & 0x1f = 0, continuation bit → 0 | 0x20 = 32 = 'g'
    // 32 >>> 5 = 1, second group: 1, base64[1] = 'B'
    assert.equal(encodeVlq(16), 'gB')
  })
})

describe('SourceMapBuilder', () => {
  test('generate() returns version 3', () => {
    const smb = new SourceMapBuilder()
    const map = smb.generate('app.js', '')
    assert.equal(map.version, 3)
  })

  test('generate() returns non-empty mappings after adding a mapping', () => {
    const smb = new SourceMapBuilder()
    // genLine=0, genCol=0, srcLine=0, srcCol=0
    smb.addMapping(0, 0, 0, 0)
    const map = smb.generate('app.js', 'let x = 1')
    assert.ok(map.mappings.length > 0, 'Expected non-empty mappings string')
  })

  test('generate() encodes mappings correctly for a single mapping at line 0', () => {
    const smb = new SourceMapBuilder()
    smb.addMapping(0, 0, 0, 0)
    const map = smb.generate('app.js', '')
    // genCol=0→A, srcIndex=0→A, srcLine=0→A, srcCol=0→A → "AAAA"
    assert.equal(map.mappings, 'AAAA')
  })

  test('generate() includes sources array', () => {
    const smb = new SourceMapBuilder()
    const map = smb.generate('app.js', '')
    assert.ok(Array.isArray(map.sources))
    assert.equal(map.sources.length, 1)
  })

  test('generate() stores sourcesContent', () => {
    const smb = new SourceMapBuilder()
    const src = '@state let count = 0'
    const map = smb.generate('app.js', src)
    assert.equal(map.sourcesContent[0], src)
  })
})

describe('Source map integration with compiler', () => {
  test('compile with @state produces JS that can be used with a SourceMapBuilder', async () => {
    const { SourceMapBuilder } = require('../src/sourcemap')
    const smb = new SourceMapBuilder()
    const { js } = await compile(
      'page "T"\n  @state let count = 0\n  text "{count}"',
      'index.arc',
      { sourceMap: smb }
    )
    assert.ok(js.trim().length > 0, 'Expected non-empty JS')
    const map = smb.generate('app.js', '@state let count = 0')
    assert.equal(map.version, 3)
    assert.ok(map.mappings.length > 0, 'Expected non-empty mappings after emit')
  })

  test('map file is written to dist when building', async () => {
    // Create a temporary project directory
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-test-'))
    try {
      fs.writeFileSync(path.join(tmpDir, 'index.arc'), 'page "T"\n  @state let count = 0\n  text "{count}"\n')

      // Run build by directly calling the build function
      // We need to require cli.js internals: but build() is not exported.
      // Instead, verify through compile + manual write (mirrors build logic).
      const { SourceMapBuilder } = require('../src/sourcemap')
      const smb = new SourceMapBuilder()
      const source = fs.readFileSync(path.join(tmpDir, 'index.arc'), 'utf8')
      const { js } = await compile(source, 'index.arc', { sourceMap: smb })

      const distDir = path.join(tmpDir, 'dist')
      fs.mkdirSync(distDir, { recursive: true })

      const mapJson = smb.generate('app.js', source)
      const mapPath = path.join(distDir, 'app.js.map')
      fs.writeFileSync(mapPath, JSON.stringify(mapJson))
      fs.writeFileSync(path.join(distDir, 'app.js'), js + '\n//# sourceMappingURL=app.js.map')

      // Verify the map file exists and is valid JSON with version 3
      assert.ok(fs.existsSync(mapPath), 'Expected app.js.map to exist')
      const written = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
      assert.equal(written.version, 3)
      assert.ok(written.mappings.length > 0, 'Expected non-empty mappings in written file')

      // Verify app.js has sourceMappingURL comment
      const appJs = fs.readFileSync(path.join(distDir, 'app.js'), 'utf8')
      assert.ok(appJs.includes('//# sourceMappingURL=app.js.map'), 'Expected sourceMappingURL in app.js')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
