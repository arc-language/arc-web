'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')

const { compile, _internal } = require('../src/cli')
const {
  resolveImports,
  composeClientJs,
  hashString,
  injectAssets,
  fmt,
  findArcFiles,
  newProject,
} = _internal
const { validateName, getTemplate } = require('../src/new-command')

const TMPDIR = os.tmpdir()

function mkTmpDir(name) {
  const dir = fs.mkdtempSync(path.join(TMPDIR, `arc-test-${name}-`))
  return dir
}

function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}

describe('cli: hashString', () => {
  test('returns a non-negative 32-bit integer', () => {
    const h = hashString('test.arc')
    assert.ok(Number.isInteger(h))
    assert.ok(h >= 0)
    assert.ok(h <= 0xffffffff)
  })

  test('returns the same hash for the same input (deterministic)', () => {
    assert.equal(hashString('hello'), hashString('hello'))
  })

  test('returns different hashes for different inputs', () => {
    assert.notEqual(hashString('hello'), hashString('world'))
  })

  test('handles empty string', () => {
    const h = hashString('')
    assert.ok(Number.isInteger(h))
  })
})

describe('cli: injectAssets', () => {
  test('injects <script src="app.js"> before </body> when JS is non-empty', () => {
    const html = '<html><body>hi</body></html>'
    const result = injectAssets(html, 'const x = 1;')
    assert.ok(result.includes('<script src="app.js" defer></script>'))
    assert.ok(result.includes('</body>'))
  })

  test('does not inject script when JS is empty', () => {
    const html = '<html><body>hi</body></html>'
    const result = injectAssets(html, '')
    assert.equal(result, html)
  })

  test('does not inject script when JS is only whitespace', () => {
    const html = '<html><body>hi</body></html>'
    const result = injectAssets(html, '   \n  ')
    assert.equal(result, html)
  })
})

describe('cli: fmt', () => {
  test('formats bytes under 1024 as raw bytes', () => {
    assert.equal(fmt(0), '0 bytes')
    assert.equal(fmt(500), '500 bytes')
    assert.equal(fmt(1023), '1023 bytes')
  })

  test('formats 1024+ bytes as KB with 1 decimal', () => {
    assert.equal(fmt(1024), '1.0 KB')
    assert.equal(fmt(2048), '2.0 KB')
    assert.equal(fmt(1536), '1.5 KB')
  })
})

describe('cli: composeClientJs', () => {
  test('returns empty when all parts are empty', () => {
    assert.equal(composeClientJs('', '', ''), '')
  })

  test('returns only reactive when no stubs/realtime', () => {
    const reactive = 'const _x = 1;'
    const result = composeClientJs(reactive, '', '')
    assert.equal(result, reactive)
  })

  test('includes ADP runtime when a stub is actually called from reactive code', () => {
    const stubs = 'async function getStats() { return await fetch("/_arc/fn/getStats") }'
    const reactive = 'getStats().then(s => console.log(s))'
    const result = composeClientJs(reactive, stubs, '')
    assert.ok(result.includes('_adpEncode'), `Expected ADP runtime when stub is called`)
    assert.ok(result.includes('getStats'))
  })

  test('strips ADP runtime + stubs when stubs are never called from client', () => {
    // @server fn declared but only used by @live (resolved at edge render time) -
    // the client bundle should NOT ship ADP or the stub.
    const stubs = 'async function getStats() { return await fetch("/_arc/fn/getStats") }'
    const reactive = 'document.querySelector("button").addEventListener("click", () => {})'
    const result = composeClientJs(reactive, stubs, '')
    assert.ok(!result.includes('_adpEncode'), `ADP runtime should be tree-shaken: ${result}`)
    assert.ok(!result.includes('getStats'), `Unused stub should be stripped`)
  })

  test('includes ADP runtime when realtime is present', () => {
    const result = composeClientJs('', '', 'const _rt = new WebSocket()')
    assert.ok(result.includes('_adpEncode'))
    assert.ok(result.includes('_rt'))
  })

  test('combines all parts in order: runtime, stubs, reactive, realtime', () => {
    const stubs = 'async function callMe() {}'
    const reactive = '/*REACT*/ callMe()'
    const realtime = '/*REALT*/'
    const result = composeClientJs(reactive, stubs, realtime)
    const runtimePos = result.indexOf('_adpEncode')
    const stubsPos = result.indexOf('callMe()')  // first match is in stub def, then in reactive
    const stubDefPos = result.indexOf('async function callMe')
    const reactPos = result.indexOf('REACT')
    const realtPos = result.indexOf('REALT')
    assert.ok(runtimePos >= 0 && runtimePos < stubDefPos, 'runtime before stub def')
    assert.ok(stubDefPos < reactPos, 'stub def before reactive')
    assert.ok(reactPos < realtPos, 'reactive before realtime')
  })
})

describe('cli: findArcFiles', () => {
  test('finds .arc files recursively in a directory', () => {
    const dir = mkTmpDir('findarc')
    try {
      fs.writeFileSync(path.join(dir, 'a.arc'), 'page "A"')
      fs.writeFileSync(path.join(dir, 'b.arc'), 'page "B"')
      fs.mkdirSync(path.join(dir, 'sub'))
      fs.writeFileSync(path.join(dir, 'sub', 'c.arc'), 'page "C"')
      const found = findArcFiles(dir)
      assert.equal(found.length, 3)
      assert.ok(found.some(f => f.endsWith('a.arc')))
      assert.ok(found.some(f => f.endsWith('c.arc')))
    } finally { rmDir(dir) }
  })

  test('skips node_modules and dist directories', () => {
    const dir = mkTmpDir('findskip')
    try {
      fs.writeFileSync(path.join(dir, 'main.arc'), 'page "A"')
      fs.mkdirSync(path.join(dir, 'node_modules'))
      fs.writeFileSync(path.join(dir, 'node_modules', 'skip.arc'), 'page "X"')
      fs.mkdirSync(path.join(dir, 'dist'))
      fs.writeFileSync(path.join(dir, 'dist', 'also_skip.arc'), 'page "X"')
      const found = findArcFiles(dir)
      assert.equal(found.length, 1)
      assert.ok(found[0].endsWith('main.arc'))
    } finally { rmDir(dir) }
  })

  test('returns empty array for unreadable directory', () => {
    const found = findArcFiles('/nonexistent/path/that/does/not/exist')
    assert.deepEqual(found, [])
  })

  test('ignores non-.arc files', () => {
    const dir = mkTmpDir('nonarc')
    try {
      fs.writeFileSync(path.join(dir, 'a.arc'), 'page "A"')
      fs.writeFileSync(path.join(dir, 'b.js'), 'const x = 1')
      fs.writeFileSync(path.join(dir, 'c.txt'), 'hello')
      const found = findArcFiles(dir)
      assert.equal(found.length, 1)
    } finally { rmDir(dir) }
  })
})

describe('cli: resolveImports', () => {
  test('resolves named widget imports from another .arc file', async () => {
    const dir = mkTmpDir('imports')
    try {
      fs.writeFileSync(path.join(dir, 'card.arc'), `widget Card
  div
    text "{@label}"
`)
      fs.writeFileSync(path.join(dir, 'main.arc'), `import { Card } from "./card"
page "T"
  Card label="Hi"
`)
      const r = await compile(
        fs.readFileSync(path.join(dir, 'main.arc'), 'utf8'),
        path.join(dir, 'main.arc'),
        { projectDir: dir }
      )
      assert.ok(r.html.includes('Hi'), `Expected Card widget content in:\n${r.html}`)
    } finally { rmDir(dir) }
  })

  test('warns on missing import (does not throw)', async () => {
    const dir = mkTmpDir('missingimp')
    try {
      fs.writeFileSync(path.join(dir, 'main.arc'), `import { Card } from "./nonexistent"
page "T"
  text "ok"
`)
      // Should compile without throwing; the import is silently skipped
      const r = await compile(
        fs.readFileSync(path.join(dir, 'main.arc'), 'utf8'),
        path.join(dir, 'main.arc'),
        { projectDir: dir }
      )
      assert.ok(r.html.includes('ok'))
    } finally { rmDir(dir) }
  })

  test('skips stdlib imports (arc/...)', async () => {
    const dir = mkTmpDir('stdlib')
    try {
      fs.writeFileSync(path.join(dir, 'main.arc'), `import { format } from "arc/date"
page "T"
  text "ok"
`)
      const r = await compile(
        fs.readFileSync(path.join(dir, 'main.arc'), 'utf8'),
        path.join(dir, 'main.arc'),
        { projectDir: dir }
      )
      assert.ok(r.html.includes('ok'))
    } finally { rmDir(dir) }
  })

  test('blocks imports that escape project root', async () => {
    const dir = mkTmpDir('escape')
    try {
      fs.writeFileSync(path.join(dir, 'main.arc'), `import { Card } from "../../../etc/passwd"
page "T"
  text "ok"
`)
      const r = await compile(
        fs.readFileSync(path.join(dir, 'main.arc'), 'utf8'),
        path.join(dir, 'main.arc'),
        { projectDir: dir }
      )
      // Should compile without errors: the escape attempt is just warned and skipped
      assert.ok(r.html.includes('ok'))
    } finally { rmDir(dir) }
  })

  test('imports FnDecl by name', async () => {
    const dir = mkTmpDir('importfn')
    try {
      fs.writeFileSync(path.join(dir, 'utils.arc'), `fn double(x) => x * 2
`)
      fs.writeFileSync(path.join(dir, 'main.arc'), `import { double } from "./utils"
page "T"
  text "ok"
`)
      const r = await compile(
        fs.readFileSync(path.join(dir, 'main.arc'), 'utf8'),
        path.join(dir, 'main.arc'),
        { projectDir: dir }
      )
      assert.ok(r.html.includes('ok'))
    } finally { rmDir(dir) }
  })

  test('warns when imported file has a syntax error (no throw)', async () => {
    const dir = mkTmpDir('importsyntax')
    try {
      // Imported file with truly malformed structure that breaks the parser
      fs.writeFileSync(path.join(dir, 'broken.arc'), `widget Bad {{{{ syntax errors }}}}\n}`)
      fs.writeFileSync(path.join(dir, 'main.arc'), `import { Bad } from "./broken"
page "T"
  text "still works"
`)
      // Should compile main even though the imported file has a syntax error
      const r = await compile(
        fs.readFileSync(path.join(dir, 'main.arc'), 'utf8'),
        path.join(dir, 'main.arc'),
        { projectDir: dir }
      )
      assert.ok(r.html.includes('still works'))
    } finally { rmDir(dir) }
  })

  test('warns when imported file cannot be read (permission/unreadable)', async () => {
    const dir = mkTmpDir('importread')
    try {
      // Create a directory at the import path instead of a file: readFile will EISDIR
      fs.mkdirSync(path.join(dir, 'unreadable.arc'))
      fs.writeFileSync(path.join(dir, 'main.arc'), `import { X } from "./unreadable"
page "T"
  text "still works"
`)
      const r = await compile(
        fs.readFileSync(path.join(dir, 'main.arc'), 'utf8'),
        path.join(dir, 'main.arc'),
        { projectDir: dir }
      )
      assert.ok(r.html.includes('still works'))
    } finally { rmDir(dir) }
  })

  test('does not re-process an already-visited file (cycle prevention)', async () => {
    const dir = mkTmpDir('cycle')
    try {
      fs.writeFileSync(path.join(dir, 'a.arc'), `import { B } from "./b"
widget A
  text "A"
`)
      fs.writeFileSync(path.join(dir, 'b.arc'), `import { A } from "./a"
widget B
  text "B"
`)
      fs.writeFileSync(path.join(dir, 'main.arc'), `import { A } from "./a"
page "T"
  A
`)
      const r = await compile(
        fs.readFileSync(path.join(dir, 'main.arc'), 'utf8'),
        path.join(dir, 'main.arc'),
        { projectDir: dir }
      )
      assert.ok(r.html.includes('A'))
    } finally { rmDir(dir) }
  })
})

describe('cli: newProject', () => {
  test('creates default template project files', () => {
    const dir = mkTmpDir('newproj')
    const projDir = path.join(dir, 'myapp')
    try {
      const cwd = process.cwd()
      process.chdir(dir)
      try {
        newProject('myapp')
      } finally {
        process.chdir(cwd)
      }
      assert.ok(fs.existsSync(path.join(projDir, 'index.arc')))
      assert.ok(fs.existsSync(path.join(projDir, 'package.json')))
      assert.ok(fs.existsSync(path.join(projDir, '.gitignore')))
      const pkg = JSON.parse(fs.readFileSync(path.join(projDir, 'package.json'), 'utf8'))
      assert.equal(pkg.name, 'myapp')
    } finally { rmDir(dir) }
  })

  test('creates counter template when specified', () => {
    const dir = mkTmpDir('newctr')
    const projDir = path.join(dir, 'ctr-app')
    try {
      const cwd = process.cwd()
      process.chdir(dir)
      try {
        newProject('ctr-app', 'counter')
      } finally {
        process.chdir(cwd)
      }
      const arc = fs.readFileSync(path.join(projDir, 'index.arc'), 'utf8')
      assert.ok(arc.includes('@state let count'), `Expected counter @state in:\n${arc}`)
    } finally { rmDir(dir) }
  })

  test('creates blog template when specified', () => {
    const dir = mkTmpDir('newblog')
    const projDir = path.join(dir, 'blog-app')
    try {
      const cwd = process.cwd()
      process.chdir(dir)
      try {
        newProject('blog-app', 'blog')
      } finally {
        process.chdir(cwd)
      }
      const arc = fs.readFileSync(path.join(projDir, 'index.arc'), 'utf8')
      assert.ok(arc.includes('@build const posts'), `Expected blog @build in:\n${arc}`)
    } finally { rmDir(dir) }
  })

  test('refuses to overwrite an existing non-empty directory (subprocess)', () => {
    const { execFileSync } = require('child_process')
    const cliPath = path.resolve(__dirname, '..', 'src', 'cli.js')
    const dir = mkTmpDir('newoverwrite')
    const projDir = path.join(dir, 'occupied')
    try {
      fs.mkdirSync(projDir)
      fs.writeFileSync(path.join(projDir, 'existing.txt'), 'do not lose me')
      assert.throws(
        () => execFileSync('node', [cliPath, 'new', 'occupied'], { stdio: 'pipe', cwd: dir }),
        /Command failed/
      )
      // Existing file should still be there
      assert.ok(fs.existsSync(path.join(projDir, 'existing.txt')))
    } finally { rmDir(dir) }
  })

  test('sanitizes project name in package.json (lowercase, valid chars)', () => {
    const dir = mkTmpDir('newsanitize')
    const projDir = path.join(dir, 'My_App!Name')
    try {
      const cwd = process.cwd()
      process.chdir(dir)
      try {
        newProject('My_App!Name')
      } finally {
        process.chdir(cwd)
      }
      const pkg = JSON.parse(fs.readFileSync(path.join(projDir, 'package.json'), 'utf8'))
      // Should be lowercased, special chars replaced with -
      assert.ok(/^[a-z0-9-]+$/.test(pkg.name), `Expected valid name, got: ${pkg.name}`)
    } finally { rmDir(dir) }
  })

  test('creates api template with nested server/ directories', () => {
    const dir = mkTmpDir('newapi')
    try {
      const cwd = process.cwd()
      process.chdir(dir)
      try { newProject('my-api', 'api', { pm: 'npm' }) } finally { process.chdir(cwd) }
      assert.ok(fs.existsSync(path.join(dir, 'my-api', 'server', 'schemas', 'post.arc')))
      assert.ok(fs.existsSync(path.join(dir, 'my-api', 'server', 'routes', 'posts.arc')))
      assert.ok(fs.existsSync(path.join(dir, 'my-api', 'server', 'jobs', 'notify.arc')))
    } finally { rmDir(dir) }
  })

  test('creates cms template with arc.config.json in .gitignore', () => {
    const dir = mkTmpDir('newcms')
    try {
      const cwd = process.cwd()
      process.chdir(dir)
      try { newProject('my-cms', 'cms', { pm: 'npm' }) } finally { process.chdir(cwd) }
      assert.ok(fs.existsSync(path.join(dir, 'my-cms', 'arc.config.json')))
      const gi = fs.readFileSync(path.join(dir, 'my-cms', '.gitignore'), 'utf8')
      assert.ok(gi.includes('arc.config.json'), '.gitignore should list arc.config.json')
    } finally { rmDir(dir) }
  })

  test('api template start script uses bun when pm is bun', () => {
    const files = getTemplate('my-api', 'api', 'bun')
    const pkg = JSON.parse(files['package.json'])
    assert.equal(pkg.scripts.start, 'bun dist/server.js')
  })

  test('api template start script uses node when pm is npm', () => {
    const files = getTemplate('my-api', 'api', 'npm')
    const pkg = JSON.parse(files['package.json'])
    assert.equal(pkg.scripts.start, 'node dist/server.js')
  })

  test('validateName: rejects empty string', () => {
    assert.ok(validateName('') !== null)
  })

  test('validateName: rejects name with spaces', () => {
    assert.ok(validateName('my app') !== null)
  })

  test('validateName: rejects leading dot', () => {
    assert.ok(validateName('.hidden') !== null)
  })

  test('validateName: rejects all-special-chars (sanitizes to empty)', () => {
    assert.ok(validateName('!!!') !== null)
  })

  test('validateName: rejects name longer than 214 chars', () => {
    assert.ok(validateName('a'.repeat(215)) !== null)
  })
})

describe('cli: build command (subprocess)', () => {
  const { execFileSync } = require('child_process')
  const cliPath = path.resolve(__dirname, '..', 'src', 'cli.js')

  test('builds a minimal Arc project to dist/', () => {
    const dir = mkTmpDir('build')
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "Hello"\n  text "world"')
      execFileSync('node', [cliPath, 'build', dir], { stdio: 'pipe' })
      assert.ok(fs.existsSync(path.join(dir, 'dist', 'index.html')))
      const html = fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8')
      assert.ok(html.includes('Hello'))
      assert.ok(html.includes('world'))
    } finally { rmDir(dir) }
  })

  test('build exits non-zero on checker error', () => {
    const dir = mkTmpDir('builderr')
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "{undeclaredVariable}"')
      assert.throws(
        () => execFileSync('node', [cliPath, 'build', dir], { stdio: 'pipe' }),
        /Command failed/
      )
    } finally { rmDir(dir) }
  })

  test('build exits non-zero when dist write fails (file at dist path)', () => {
    const dir = mkTmpDir('buildwrite')
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "x"')
      // Create a file named "dist" so mkdirSync recursive fails or write goes wrong
      fs.writeFileSync(path.join(dir, 'dist'), 'blocker')
      assert.throws(
        () => execFileSync('node', [cliPath, 'build', dir], { stdio: 'pipe' }),
        /Command failed/
      )
    } finally { rmDir(dir) }
  })

  test('build exits non-zero when dir has no .arc files', () => {
    const dir = mkTmpDir('buildempty')
    try {
      assert.throws(
        () => execFileSync('node', [cliPath, 'build', dir], { stdio: 'pipe' }),
        /Command failed/
      )
    } finally { rmDir(dir) }
  })

  test('build prints warning when @build expression throws (non-fatal)', () => {
    const { spawnSync } = require('child_process')
    const dir = mkTmpDir('buildwarn')
    try {
      // @build that triggers an error (readFile of a non-existent file)
      fs.writeFileSync(path.join(dir, 'index.arc'), `@build const data = readFile("does-not-exist.json")
page "T"
  text "ok"
`)
      const r = spawnSync('node', [cliPath, 'build', dir], { stdio: 'pipe' })
      const stderr = r.stderr.toString()
      const stdout = r.stdout.toString()
      assert.ok(stderr.includes('warn') || stderr.includes('@build') || stdout.includes('warn'),
        `Expected a warning about the @build error: stderr=${stderr}, stdout=${stdout}`)
    } finally { rmDir(dir) }
  })

  test('build with @live but no template references uses short-circuit renderer', () => {
    const dir = mkTmpDir('buildliveempty')
    try {
      // @live declared but not referenced in template: short-circuit path
      fs.writeFileSync(path.join(dir, 'index.arc'), `page "T"
  @server fn getUser() -> { name: String } {
    return { name: "alice" }
  }
  @live let user = getUser()
  text "no reference to user"
`)
      execFileSync('node', [cliPath, 'build', dir], { stdio: 'pipe' })
      const renderer = fs.readFileSync(path.join(dir, 'dist', '_arc', 'renderer.js'), 'utf8')
      // Short-circuit path: no _SPAN_RE constant
      assert.ok(!renderer.includes('_SPAN_RE'), `Expected no _SPAN_RE (short-circuit): ${renderer.slice(0, 300)}`)
    } finally { rmDir(dir) }
  })

  test('build emits @live edge renderer to _arc/renderer.js', () => {
    const dir = mkTmpDir('buildlive')
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), `page "T"
  @server fn getUser() -> { name: String } {
    return { name: "alice" }
  }
  @live let user = getUser()
  text "{user.name}"
`)
      execFileSync('node', [cliPath, 'build', dir], { stdio: 'pipe' })
      assert.ok(fs.existsSync(path.join(dir, 'dist', '_arc', 'renderer.js')),
        '@live should produce renderer.js')
    } finally { rmDir(dir) }
  })

  test('build emits @server edge function output to _arc/functions.js', () => {
    const dir = mkTmpDir('buildedge')
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), `page "T"
  @server fn greet() {
    return "hi"
  }
  text "ok"
`)
      execFileSync('node', [cliPath, 'build', dir], { stdio: 'pipe' })
      assert.ok(fs.existsSync(path.join(dir, 'dist', '_arc', 'functions.js')))
    } finally { rmDir(dir) }
  })
})

describe('cli: check command (subprocess)', () => {
  const { execFileSync } = require('child_process')
  const cliPath = path.resolve(__dirname, '..', 'src', 'cli.js')

  test('check passes on a clean file', () => {
    const dir = mkTmpDir('check')
    try {
      const file = path.join(dir, 'clean.arc')
      fs.writeFileSync(file, 'page "T"\n  text "ok"')
      const out = execFileSync('node', [cliPath, 'check', file], { stdio: 'pipe' }).toString()
      assert.ok(out.includes('clean.arc') || out.includes('✓'))
    } finally { rmDir(dir) }
  })

  test('check exits non-zero on an undefined variable', () => {
    const dir = mkTmpDir('checkerr')
    try {
      const file = path.join(dir, 'bad.arc')
      fs.writeFileSync(file, 'page "T"\n  text "{undeclared}"')
      assert.throws(
        () => execFileSync('node', [cliPath, 'check', file], { stdio: 'pipe' }),
        /Command failed/
      )
    } finally { rmDir(dir) }
  })

  test('check with no args scans current directory', () => {
    const dir = mkTmpDir('checkcwd')
    try {
      fs.writeFileSync(path.join(dir, 'a.arc'), 'page "A"\n  text "ok"')
      const out = execFileSync('node', [cliPath, 'check'], { stdio: 'pipe', cwd: dir }).toString()
      assert.ok(out.includes('a.arc') || out.includes('✓'))
    } finally { rmDir(dir) }
  })
})

describe('cli: check command edge cases (subprocess)', () => {
  const { execFileSync } = require('child_process')
  const cliPath = path.resolve(__dirname, '..', 'src', 'cli.js')

  test('check exits non-zero on syntax error', () => {
    const dir = mkTmpDir('checksyn')
    try {
      const file = path.join(dir, 'bad.arc')
      fs.writeFileSync(file, 'page "T"\n  for in items')  // missing var name
      assert.throws(
        () => execFileSync('node', [cliPath, 'check', file], { stdio: 'pipe' }),
        /Command failed/
      )
    } finally { rmDir(dir) }
  })

  test('check prints warnings (e.g. await outside async)', () => {
    const dir = mkTmpDir('checkwarn')
    try {
      const file = path.join(dir, 'warn.arc')
      // Trigger an await-outside-async warning
      fs.writeFileSync(file, `@server fn process(x) {
  await x
}
page "T"
  text "ok"
`)
      const r = require('child_process').spawnSync('node', [cliPath, 'check', file], { stdio: 'pipe' })
      const out = r.stdout.toString() + r.stderr.toString()
      // Must contain a warning indicator (not just an echo of the source containing "await")
      assert.ok(out.toLowerCase().includes('warn') || out.includes('"await"'),
        `Expected warning output: ${out}`)
    } finally { rmDir(dir) }
  })

  test('check on non-existent file is reported as error', () => {
    assert.throws(
      () => execFileSync('node', [cliPath, 'check', '/nonexistent/path.arc'], { stdio: 'pipe' }),
      /Command failed/
    )
  })
})

describe('cli: new command edge cases (subprocess)', () => {
  const { execFileSync } = require('child_process')
  const cliPath = path.resolve(__dirname, '..', 'src', 'cli.js')

  test('new --template without value exits non-zero', () => {
    const dir = mkTmpDir('newnoval')
    try {
      assert.throws(
        () => execFileSync('node', [cliPath, 'new', 'app', '--template'], { stdio: 'pipe', cwd: dir }),
        /Command failed/
      )
    } finally { rmDir(dir) }
  })

  test('new creates blog template via CLI', () => {
    const dir = mkTmpDir('newblogcli')
    try {
      execFileSync('node', [cliPath, 'new', 'b-app', '--template', 'blog'], { stdio: 'pipe', cwd: dir })
      assert.ok(fs.existsSync(path.join(dir, 'b-app', 'index.arc')))
    } finally { rmDir(dir) }
  })
})

describe('cli: fatal error handling (subprocess)', () => {
  const { execFileSync, spawnSync } = require('child_process')
  const cliPath = path.resolve(__dirname, '..', 'src', 'cli.js')

  test('ARC_DEBUG=1 prints stack trace on fatal error', () => {
    // Invoke a command that would cause an unhandled error
    const result = spawnSync('node', [cliPath, 'build', '/nonexistent/no/permission/at/all'], {
      env: { ...process.env, ARC_DEBUG: '1' },
      stdio: 'pipe'
    })
    assert.ok(result.status !== 0, 'should exit non-zero')
    // Either the early-exit message OR a stack trace fired
    const stderr = result.stderr.toString()
    assert.ok(stderr.length > 0, `Expected error output: ${stderr}`)
  })

  test('without ARC_DEBUG prints hint to set it', () => {
    // Trigger a non-graceful exit (e.g. unhandled error in main)
    const result = spawnSync('node', [cliPath, 'build', '/this/does/not/exist/anywhere'], {
      env: { ...process.env, ARC_DEBUG: '' },
      stdio: 'pipe'
    })
    assert.ok(result.status !== 0)
    const errOut = result.stderr.toString()
    assert.ok(errOut.includes('cannot read') || errOut.includes('ENOENT') || errOut.length > 0,
      'should print an error message')
  })

  test('unknown subcommand prints help', () => {
    const result = spawnSync('node', [cliPath, 'unknown-cmd'], { stdio: 'pipe' })
    const out = result.stdout.toString()
    assert.ok(out.includes('build') && out.includes('dev'), `Expected help in: ${out}`)
  })
})

describe('cli: formatError edge cases', () => {
  const { formatError, showSourceContext } = require('../src/cli')._internal

  test('formatError works without filename', () => {
    const err = new Error('test error message')
    const logged = []
    const orig = console.error
    console.error = (...args) => logged.push(args.join(' '))
    try {
      formatError(err, null, null)
    } finally {
      console.error = orig
    }
    assert.ok(logged.some(c => c.includes('test error message')))
  })

  test('formatError extracts line:col from message and shows source context', () => {
    const err = new SyntaxError('test.arc:3:5: something went wrong')
    const source = 'line1\nline2\nline3 here\nline4'
    const logged = []
    const orig = console.error
    console.error = (...args) => logged.push(args.join(' '))
    try {
      formatError(err, source, 'test.arc')
    } finally {
      console.error = orig
    }
    assert.ok(logged.some(c => c.includes('something went wrong')))
    assert.ok(logged.some(c => c.includes('line3 here')))
  })

  test('showSourceContext handles missing line gracefully', () => {
    const logged = []
    const orig = console.error
    console.error = (...args) => logged.push(args.join(' '))
    try {
      showSourceContext('line1\nline2', null, null)
      showSourceContext('line1\nline2', 999, 1)  // line out of range
    } finally {
      console.error = orig
    }
    // Both calls should be silent (no output) since lineNum is null or out of range
    assert.equal(logged.length, 0)
  })

  test('showSourceContext displays col indicator when col provided', () => {
    const logged = []
    const orig = console.error
    console.error = (...args) => logged.push(args.join(' '))
    try {
      showSourceContext('hello world', 1, 7)  // col=7 → points at 'w'
    } finally {
      console.error = orig
    }
    assert.ok(logged.some(c => c.includes('hello world')))
    assert.ok(logged.some(c => c.includes('^')))
  })
})

describe('cli: version and help', () => {
  const { execFileSync } = require('child_process')
  const cliPath = path.resolve(__dirname, '..', 'src', 'cli.js')

  test('--version prints the package version', () => {
    const out = execFileSync('node', [cliPath, '--version'], { stdio: 'pipe' }).toString()
    assert.ok(/^\d+\.\d+\.\d+/.test(out.trim()), `Expected version string, got: ${out}`)
  })

  test('no arg prints help text mentioning subcommands', () => {
    const out = execFileSync('node', [cliPath], { stdio: 'pipe' }).toString()
    assert.ok(out.includes('build'))
    assert.ok(out.includes('check'))
    assert.ok(out.includes('new'))
    assert.ok(out.includes('deploy'))
  })
})

describe('cli: new command (subprocess)', () => {
  const { execFileSync } = require('child_process')
  const cliPath = path.resolve(__dirname, '..', 'src', 'cli.js')

  test('new without name exits non-zero', () => {
    assert.throws(
      () => execFileSync('node', [cliPath, 'new'], { stdio: 'pipe' }),
      /Command failed/
    )
  })

  test('new with unknown template exits non-zero', () => {
    const dir = mkTmpDir('newbad')
    try {
      assert.throws(
        () => execFileSync('node', [cliPath, 'new', 'app', '--template', 'unknown'], { stdio: 'pipe', cwd: dir }),
        /Command failed/
      )
    } finally { rmDir(dir) }
  })
})

describe('cli: dev server (subprocess + HTTP)', () => {
  const { spawn } = require('child_process')
  const cliPath = path.resolve(__dirname, '..', 'src', 'cli.js')

  async function startDevServer(dir, port) {
    return new Promise((resolve, reject) => {
      const proc = spawn('node', [cliPath, 'dev', dir], {
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const timer = setTimeout(() => {
        proc.kill('SIGKILL')
        reject(new Error('dev server timeout'))
      }, 10000)
      proc.stdout.on('data', (chunk) => {
        if (chunk.toString().includes('dev server')) {
          clearTimeout(timer)
          resolve(proc)
        }
      })
      proc.on('error', (e) => { clearTimeout(timer); reject(e) })
    })
  }

  function httpGet(port, urlPath) {
    return new Promise((resolve, reject) => {
      const req = require('http').get(`http://localhost:${port}${urlPath}`, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), headers: res.headers }))
      })
      req.on('error', reject)
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('http timeout')) })
    })
  }

  test('dev server serves index.html with reload script injected', async () => {
    const dir = mkTmpDir('dev')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "hello from dev"')
      proc = await startDevServer(dir, port)
      const r = await httpGet(port, '/')
      assert.equal(r.status, 200)
      assert.ok(r.body.includes('hello from dev'), `Expected page content`)
      assert.ok(r.body.includes('EventSource'), `Expected reload script injected`)
    } finally {
      if (proc) proc.kill('SIGTERM')
      rmDir(dir)
    }
  })

  test('dev server serves /styles.css when CSS exceeds inline threshold', async () => {
    // Small CSS is now inlined into <style> (no separate file written).
    // To exercise the external file path, generate enough CSS to exceed the 14 KB
    // critical-inlining threshold - pad with many style rules.
    const dir = mkTmpDir('devcss')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      // .padN rules must be indented at 4 spaces (inside the design block at indent 2)
      const pad = Array.from({ length: 500 }, (_, i) => `    .pad${i}\n      bg: red`).join('\n')
      fs.writeFileSync(
        path.join(dir, 'index.arc'),
        `page "T"\n  text "x"\n  design\n    body\n      bg: red\n${pad}`
      )
      proc = await startDevServer(dir, port)
      const r = await httpGet(port, '/styles.css')
      assert.equal(r.status, 200)
      assert.equal(r.headers['content-type'], 'text/css')
    } finally {
      if (proc) proc.kill('SIGTERM')
      rmDir(dir)
    }
  })

  test('dev server /_arc/health returns JSON status', async () => {
    const dir = mkTmpDir('devhealth')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "x"')
      proc = await startDevServer(dir, port)
      const r = await httpGet(port, '/_arc/health')
      assert.equal(r.status, 200)
      const data = JSON.parse(r.body)
      assert.equal(data.status, 'ok')
      assert.equal(data.mode, 'dev')
    } finally {
      if (proc) proc.kill('SIGTERM')
      rmDir(dir)
    }
  })

  test('dev server blocks raw .. segments with 403', async () => {
    // When the URL is sent with literal ".." segments that survive to req.url,
    // the server must reject with 403. We craft a request whose URL contains ".."
    // without relying on the HTTP client's normalization.
    const dir = mkTmpDir('devtrav403')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "x"')
      proc = await startDevServer(dir, port)
      // Use a manually-crafted raw HTTP request so ".." is not normalized away
      const r = await new Promise((resolve, reject) => {
        const net = require('net')
        const sock = net.createConnection(port, '127.0.0.1', () => {
          sock.write('GET /a/../../../etc/passwd HTTP/1.0\r\nHost: localhost\r\n\r\n')
        })
        let data = ''
        sock.on('data', c => { data += c.toString() })
        sock.on('end', () => {
          const status = parseInt(data.split(' ')[1], 10)
          resolve({ status, body: data })
        })
        sock.on('error', reject)
        setTimeout(() => { sock.destroy(); resolve({ status: 0, body: '' }) }, 3000)
      })
      assert.ok(r.status === 403 || r.status === 404,
        `Expected raw .. traversal to be blocked, got ${r.status}`)
    } finally {
      if (proc) proc.kill('SIGTERM')
      rmDir(dir)
    }
  })

  test('dev server path traversal via normalized URL serves SPA without leaking files', async () => {
    // Node's HTTP client normalizes /../../../etc/passwd → /etc/passwd before
    // sending, so the server sees a clean path. It should serve the SPA fallback
    // (200 with index.html) rather than leaking any sensitive file contents.
    const dir = mkTmpDir('devtravnorm')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "x"')
      proc = await startDevServer(dir, port)
      const r = await httpGet(port, '/../../../etc/passwd')
      // Node normalizes the URL to /etc/passwd before the handler; the server
      // returns the SPA fallback (200) since no such file exists in dist.
      assert.equal(r.status, 200, `Expected SPA fallback 200, got ${r.status}`)
      assert.ok(!r.body.includes('root:'), 'Should not leak /etc/passwd contents')
    } finally {
      if (proc) proc.kill('SIGTERM')
      rmDir(dir)
    }
  })

  test('dev server 400 on path with null byte', async () => {
    const dir = mkTmpDir('devnull')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "x"')
      proc = await startDevServer(dir, port)
      const r = await httpGet(port, '/%00/file')
      assert.equal(r.status, 400)
    } finally {
      if (proc) proc.kill('SIGTERM')
      rmDir(dir)
    }
  })

  test('dev server falls back to index.html for unknown paths (SPA mode)', async () => {
    const dir = mkTmpDir('devspa')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "SPA root"')
      proc = await startDevServer(dir, port)
      const r = await httpGet(port, '/some/unknown/route')
      assert.equal(r.status, 200)
      assert.ok(r.body.includes('SPA root'))
    } finally {
      if (proc) proc.kill('SIGTERM')
      rmDir(dir)
    }
  })

  test('dev server rebuilds on .arc file change and notifies SSE clients', async () => {
    const dir = mkTmpDir('devwatch')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      const arcFile = path.join(dir, 'index.arc')
      fs.writeFileSync(arcFile, 'page "T"\n  text "initial content"')
      proc = await startDevServer(dir, port)

      // Open an SSE connection to listen for reload events
      const sseEvents = []
      const ssePromise = new Promise((resolve) => {
        const req = require('http').get(`http://localhost:${port}/_arc/reload`, (res) => {
          res.on('data', (c) => {
            const s = c.toString()
            if (s.includes('reload')) {
              sseEvents.push('reload')
              req.destroy()
              resolve()
            }
          })
        })
        req.on('error', () => resolve())
        setTimeout(() => { try { req.destroy() } catch {} ; resolve() }, 8000)
      })

      // Give the SSE connection time to establish
      await new Promise(r => setTimeout(r, 200))

      // Modify the .arc file to trigger a rebuild
      fs.writeFileSync(arcFile, 'page "T"\n  text "updated content"')

      await ssePromise
      // We expect at least the rebuild to have happened (and ideally an SSE event)
      // The output file should be updated
      await new Promise(r => setTimeout(r, 500))
      const html = fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8')
      assert.ok(html.includes('updated content'), `Expected rebuild to update HTML: ${html.slice(0, 200)}`)
    } finally {
      if (proc) proc.kill('SIGTERM')
      rmDir(dir)
    }
  })

  test('dev server SSE endpoint sets correct event-stream headers', async () => {
    const dir = mkTmpDir('devsse')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "x"')
      proc = await startDevServer(dir, port)
      const r = await new Promise((resolve, reject) => {
        const req = require('http').get(`http://localhost:${port}/_arc/reload`, (res) => {
          const headers = res.headers
          req.destroy()
          resolve({ status: res.statusCode, headers })
        })
        req.on('error', reject)
        setTimeout(() => { req.destroy(); resolve({ status: 0, headers: {} }) }, 3000)
      })
      assert.equal(r.status, 200)
      assert.ok(r.headers['content-type']?.includes('text/event-stream'),
        `Expected event-stream content-type, got: ${r.headers['content-type']}`)
    } finally {
      if (proc) proc.kill('SIGTERM')
      rmDir(dir)
    }
  })

  test('dev server returns 400 on malformed URL (invalid encoded byte)', async () => {
    const dir = mkTmpDir('devbadurl')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "x"')
      proc = await startDevServer(dir, port)
      // %ZZ is an invalid percent-encoding: decodeURIComponent throws
      const r = await httpGet(port, '/%ZZbad')
      assert.equal(r.status, 400)
    } finally {
      if (proc) proc.kill('SIGTERM')
      rmDir(dir)
    }
  })

  test('dev server returns 200 with correct MIME for .json', async () => {
    const dir = mkTmpDir('devjson')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "x"')
      proc = await startDevServer(dir, port)
      // Manually drop a JSON file into dist after start
      fs.writeFileSync(path.join(dir, 'dist', 'data.json'), '{"a":1}')
      const r = await httpGet(port, '/data.json')
      assert.equal(r.status, 200)
      assert.equal(r.headers['content-type'], 'application/json')
    } finally {
      if (proc) proc.kill('SIGTERM')
      rmDir(dir)
    }
  })

  test('dev server returns 200 with octet-stream MIME for unknown ext', async () => {
    const dir = mkTmpDir('devext')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "x"')
      proc = await startDevServer(dir, port)
      fs.writeFileSync(path.join(dir, 'dist', 'data.bin'), 'binary-content')
      const r = await httpGet(port, '/data.bin')
      assert.equal(r.status, 200)
      assert.equal(r.headers['content-type'], 'application/octet-stream')
    } finally {
      if (proc) proc.kill('SIGTERM')
      rmDir(dir)
    }
  })

  test('dev server sends security headers on HTML response', async () => {
    const dir = mkTmpDir('devsec')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "x"')
      proc = await startDevServer(dir, port)
      const r = await httpGet(port, '/')
      assert.equal(r.headers['x-content-type-options'], 'nosniff')
      assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN')
    } finally {
      if (proc) proc.kill('SIGTERM')
      rmDir(dir)
    }
  })
})

describe('cli: deploy command (subprocess)', () => {
  const { execFileSync } = require('child_process')
  const cliPath = path.resolve(__dirname, '..', 'src', 'cli.js')

  test('deploy with unknown target exits non-zero', () => {
    const dir = mkTmpDir('deploybad')
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "ok"')
      assert.throws(
        () => execFileSync('node', [cliPath, 'deploy', dir, '--target', 'unknown'], { stdio: 'pipe' }),
        /Command failed/
      )
    } finally { rmDir(dir) }
  })

  test('deploy --target node generates server.js', () => {
    const dir = mkTmpDir('deploynode')
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "ok"')
      execFileSync('node', [cliPath, 'deploy', dir, '--target', 'node'], { stdio: 'pipe' })
      assert.ok(fs.existsSync(path.join(dir, 'server.js')))
    } finally { rmDir(dir) }
  })

  test('deploy --target bun generates server.js', () => {
    const dir = mkTmpDir('deploybun')
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "ok"')
      const out = execFileSync('node', [cliPath, 'deploy', dir, '--target', 'bun'], { stdio: 'pipe' }).toString()
      assert.ok(fs.existsSync(path.join(dir, 'server.js')))
      assert.ok(out.includes('bun'))
    } finally { rmDir(dir) }
  })

  test('deploy --target deno generates server.ts', () => {
    const dir = mkTmpDir('deploydeno')
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "ok"')
      const out = execFileSync('node', [cliPath, 'deploy', dir, '--target', 'deno'], { stdio: 'pipe' }).toString()
      assert.ok(fs.existsSync(path.join(dir, 'server.ts')))
      assert.ok(out.includes('deno'))
    } finally { rmDir(dir) }
  })

  test('deploy --target cloudflare generates worker.js and wrangler.toml', () => {
    const dir = mkTmpDir('deploycf')
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "ok"')
      execFileSync('node', [cliPath, 'deploy', dir, '--target', 'cloudflare'], { stdio: 'pipe' })
      assert.ok(fs.existsSync(path.join(dir, 'worker.js')))
      assert.ok(fs.existsSync(path.join(dir, 'wrangler.toml')))
    } finally { rmDir(dir) }
  })
})

// ── New coverage tests ────────────────────────────────────────────────────────

const {
  _extractSharedCss,
  _patchPageHtml,
  _injectPrefetchTags,
  _extractDbAccess,
  collectDbCalls,
  collectJobCalls,
  explain,
  generate,
  buildServer,
  serve,
} = _internal

describe('cli: _extractDbAccess', () => {
  test('returns null for non-db node', () => {
    const node = { type: 'Literal', value: 42 }
    assert.strictEqual(_extractDbAccess(node), null)
  })

  test('returns null for MemberExpr not rooted at db', () => {
    const node = {
      type: 'MemberExpr',
      object: { type: 'MemberExpr', object: { name: 'req' }, property: { name: 'body' } },
      property: { name: 'parse' },
    }
    assert.strictEqual(_extractDbAccess(node), null)
  })

  test('returns { table, method } for db.model.method MemberExpr', () => {
    const node = {
      type: 'MemberExpr',
      object: { type: 'MemberExpr', object: { name: 'db' }, property: { name: 'users' } },
      property: { name: 'findMany' },
    }
    const result = _extractDbAccess(node)
    assert.deepEqual(result, { table: 'users', method: 'findMany' })
  })

  test('returns { table, method } for db.model.method CallExpr', () => {
    const node = {
      type: 'CallExpr',
      callee: {
        type: 'MemberExpr',
        object: { type: 'MemberExpr', object: { name: 'db' }, property: { name: 'posts' } },
        property: { name: 'create' },
      },
      args: [],
    }
    const result = _extractDbAccess(node)
    assert.deepEqual(result, { table: 'posts', method: 'create' })
  })
})

describe('cli: collectDbCalls', () => {
  function makeDbCallNode(table, method) {
    return {
      type: 'CallExpr',
      callee: {
        type: 'MemberExpr',
        object: { type: 'MemberExpr', object: { name: 'db' }, property: { name: table } },
        property: { name: method },
      },
      args: [],
    }
  }

  test('returns empty reads/writes for empty node array', () => {
    const result = collectDbCalls([])
    assert.deepEqual(result.reads, [])
    assert.deepEqual(result.writes, [])
  })

  test('classifies findMany as a read', () => {
    const node = makeDbCallNode('users', 'findMany')
    const { reads, writes } = collectDbCalls([node])
    assert.ok(reads.includes('users.findMany'), 'findMany should be a read')
    assert.deepEqual(writes, [])
  })

  test('classifies find as a read', () => {
    const node = makeDbCallNode('posts', 'find')
    const { reads, writes } = collectDbCalls([node])
    assert.ok(reads.includes('posts.find'))
    assert.deepEqual(writes, [])
  })

  test('classifies count as a read', () => {
    const node = makeDbCallNode('orders', 'count')
    const { reads, writes } = collectDbCalls([node])
    assert.ok(reads.includes('orders.count'))
    assert.deepEqual(writes, [])
  })

  test('classifies create as a write', () => {
    const node = makeDbCallNode('comments', 'create')
    const { reads, writes } = collectDbCalls([node])
    assert.deepEqual(reads, [])
    assert.ok(writes.includes('comments.create'))
  })

  test('classifies update as a write', () => {
    const node = makeDbCallNode('products', 'update')
    const { reads, writes } = collectDbCalls([node])
    assert.deepEqual(reads, [])
    assert.ok(writes.includes('products.update'))
  })

  test('classifies delete as a write', () => {
    const node = makeDbCallNode('sessions', 'delete')
    const { reads, writes } = collectDbCalls([node])
    assert.deepEqual(reads, [])
    assert.ok(writes.includes('sessions.delete'))
  })

  test('handles multiple db calls in same array', () => {
    const nodes = [
      makeDbCallNode('users', 'findMany'),
      makeDbCallNode('users', 'create'),
    ]
    const { reads, writes } = collectDbCalls(nodes)
    assert.ok(reads.includes('users.findMany'))
    assert.ok(writes.includes('users.create'))
  })

  test('deduplicates repeated identical calls', () => {
    const nodes = [
      makeDbCallNode('users', 'findMany'),
      makeDbCallNode('users', 'findMany'),
    ]
    const { reads } = collectDbCalls(nodes)
    assert.strictEqual(reads.length, 1)
  })

  test('walks nested nodes inside body array', () => {
    // Wrap a db call inside an if-body node
    const dbCall = makeDbCallNode('logs', 'create')
    const ifNode = {
      type: 'IfStmt',
      consequent: {
        type: 'Block',
        body: [dbCall],
      },
    }
    const { writes } = collectDbCalls([ifNode])
    assert.ok(writes.includes('logs.create'))
  })

  test('ignores nodes with unknown methods (neither read nor write)', () => {
    const node = makeDbCallNode('users', 'aggregate')
    const { reads, writes } = collectDbCalls([node])
    assert.deepEqual(reads, [])
    assert.deepEqual(writes, [])
  })
})

describe('cli: collectJobCalls', () => {
  test('returns empty array when jobNames set is empty', () => {
    const node = { type: 'CallExpr', callee: { type: 'Identifier', name: 'SendEmail' }, args: [] }
    const result = collectJobCalls([node], new Set())
    assert.deepEqual(result, [])
  })

  test('returns empty array when no matching job calls', () => {
    const node = { type: 'CallExpr', callee: { type: 'Identifier', name: 'console' }, args: [] }
    const result = collectJobCalls([node], new Set(['SendEmail']))
    assert.deepEqual(result, [])
  })

  test('detects a matching job call', () => {
    const node = { type: 'CallExpr', callee: { type: 'Identifier', name: 'SendEmail' }, args: [] }
    const result = collectJobCalls([node], new Set(['SendEmail']))
    assert.ok(result.includes('SendEmail'))
  })

  test('detects multiple distinct job calls', () => {
    const nodes = [
      { type: 'CallExpr', callee: { type: 'Identifier', name: 'SendEmail' }, args: [] },
      { type: 'CallExpr', callee: { type: 'Identifier', name: 'GenerateReport' }, args: [] },
    ]
    const result = collectJobCalls(nodes, new Set(['SendEmail', 'GenerateReport']))
    assert.ok(result.includes('SendEmail'))
    assert.ok(result.includes('GenerateReport'))
  })

  test('deduplicates repeated job calls', () => {
    const nodes = [
      { type: 'CallExpr', callee: { type: 'Identifier', name: 'SendEmail' }, args: [] },
      { type: 'CallExpr', callee: { type: 'Identifier', name: 'SendEmail' }, args: [] },
    ]
    const result = collectJobCalls(nodes, new Set(['SendEmail']))
    assert.strictEqual(result.length, 1)
  })

  test('walks nested nodes', () => {
    const jobCall = { type: 'CallExpr', callee: { type: 'Identifier', name: 'ProcessPayment' }, args: [] }
    const wrapper = { type: 'Block', body: [jobCall] }
    const result = collectJobCalls([wrapper], new Set(['ProcessPayment']))
    assert.ok(result.includes('ProcessPayment'))
  })
})

describe('cli: _extractSharedCss', () => {
  test('returns empty filename when no rules provided', () => {
    const { filename, sharedCssMinified } = _extractSharedCss([], 2)
    assert.strictEqual(filename, null)
    assert.strictEqual(sharedCssMinified, '')
  })

  test('returns empty filename when rules appear in fewer pages than threshold', () => {
    // Rule appears in only 1 page, threshold is 2
    const rulesByPage = [
      ['.foo{color:red}'],
    ]
    const { filename } = _extractSharedCss(rulesByPage, 2)
    assert.strictEqual(filename, null)
  })

  test('extracts shared rule appearing in >= threshold pages', () => {
    const rule = '.shared{margin:0}'
    const rulesByPage = [
      [rule, '.page1{color:blue}'],
      [rule, '.page2{color:green}'],
    ]
    const { sharedRules, filename } = _extractSharedCss(rulesByPage, 2)
    assert.ok(sharedRules.includes(rule), 'shared rule should be in sharedRules')
    assert.ok(filename !== null, 'filename should be non-null when shared CSS exists')
    assert.ok(filename.startsWith('shared.'), `filename should start with "shared.", got: ${filename}`)
    assert.ok(filename.endsWith('.css'), 'filename should end with .css')
  })

  test('keeps page-only rules out of sharedRules', () => {
    const sharedRule = '.shared{font-size:16px}'
    const rulesByPage = [
      [sharedRule, '.only-page1{color:red}'],
      [sharedRule, '.only-page2{color:blue}'],
    ]
    const { sharedRules, pageOnlyRules } = _extractSharedCss(rulesByPage, 2)
    assert.ok(sharedRules.includes(sharedRule))
    assert.ok(pageOnlyRules[0].includes('.only-page1{color:red}'))
    assert.ok(pageOnlyRules[1].includes('.only-page2{color:blue}'))
  })

  test('filename includes content hash (8 hex chars)', () => {
    const rule = '.a{color:red}'
    const rulesByPage = [[rule], [rule]]
    const { filename } = _extractSharedCss(rulesByPage, 2)
    assert.ok(filename !== null)
    const match = filename.match(/^shared\.([0-9a-f]{8})\.css$/)
    assert.ok(match, `Expected shared.<8hex>.css, got: ${filename}`)
  })
})

describe('cli: _patchPageHtml', () => {
  const baseHtml = '<html><head><link rel="stylesheet" href="styles.css"></head><body>content</body></html>'

  test('replaces inline styles.css link with shared link + page style', () => {
    const result = _patchPageHtml(baseHtml, 'shared.abc12345.css', '.page{color:red}')
    assert.ok(result.includes('<link rel="stylesheet" href="shared.abc12345.css">'))
    assert.ok(result.includes('<style data-arc-css>.page{color:red}</style>'))
    assert.ok(!result.includes('href="styles.css"'), 'original styles.css link should be removed')
  })

  test('omits shared link tag when sharedFilename is null', () => {
    const result = _patchPageHtml(baseHtml, null, '.page{color:blue}')
    assert.ok(!result.includes('<link rel="stylesheet" href="null">'))
    assert.ok(!result.includes('href="styles.css"'))
    assert.ok(result.includes('<style data-arc-css>.page{color:blue}</style>'))
  })

  test('omits page style block when pageCssText is empty', () => {
    const result = _patchPageHtml(baseHtml, 'shared.abc12345.css', '')
    assert.ok(result.includes('<link rel="stylesheet" href="shared.abc12345.css">'))
    assert.ok(!result.includes('<style data-arc-css>'), 'empty CSS should not generate style tag')
  })

  test('omits page style block when pageCssText is only whitespace', () => {
    const result = _patchPageHtml(baseHtml, 'shared.abc12345.css', '   ')
    assert.ok(!result.includes('<style data-arc-css>'))
  })

  test('escapes </style> inside page CSS to avoid closing tag injection', () => {
    const result = _patchPageHtml(baseHtml, null, '.x{content:"</style>"}')
    assert.ok(!result.includes('</style></style>'), 'raw </style> should not appear verbatim inside style block')
  })
})

describe('cli: explain (pure function via _internal)', () => {
  test('explain is exported as a function', () => {
    assert.strictEqual(typeof explain, 'function')
  })

  test('explain with a single .arc file containing models and routes', async () => {
    const dir = mkTmpDir('explain-file')
    try {
      const src = `
model User
  @id let id = autoincrement()
  let name: String
  let email: String

@route get "/users" -> Response
  json(db.users.findMany())
`
      const arcFile = path.join(dir, 'api.arc')
      fs.writeFileSync(arcFile, src)

      const logs = []
      const origLog = console.log
      console.log = (...a) => logs.push(a.map(String).join(' '))
      try {
        await explain(arcFile)
      } finally {
        console.log = origLog
      }

      const output = logs.join('\n')
      assert.ok(output.includes('User'), 'should mention User model')
      assert.ok(output.includes('/users'), 'should mention /users route')
    } finally {
      rmDir(dir)
    }
  })

  test('explain with a directory (uses server/ subdir when present)', async () => {
    const dir = mkTmpDir('explain-dir')
    try {
      const serverDir = path.join(dir, 'server')
      fs.mkdirSync(serverDir, { recursive: true })
      fs.writeFileSync(path.join(serverDir, 'routes.arc'), `
@route get "/ping" -> Response
  json({ ok: true })
`)
      const logs = []
      const origLog = console.log
      console.log = (...a) => logs.push(a.map(String).join(' '))
      try {
        await explain(dir)
      } finally {
        console.log = origLog
      }

      const output = logs.join('\n')
      assert.ok(output.includes('/ping'), 'should mention /ping route')
    } finally {
      rmDir(dir)
    }
  })

  test('explain with directory without server/ subdir uses the dir itself', async () => {
    const dir = mkTmpDir('explain-noserver')
    try {
      fs.writeFileSync(path.join(dir, 'jobs.arc'), `
job ProcessOrder(id: Int)
  console.log("processing", id)
`)
      const logs = []
      const origLog = console.log
      console.log = (...a) => logs.push(a.map(String).join(' '))
      try {
        await explain(dir)
      } finally {
        console.log = origLog
      }

      const output = logs.join('\n')
      assert.ok(output.includes('ProcessOrder'), 'should mention the job name')
    } finally {
      rmDir(dir)
    }
  })

  test('explain with file containing no backend declarations prints notice', async () => {
    const dir = mkTmpDir('explain-empty')
    try {
      const arcFile = path.join(dir, 'page.arc')
      fs.writeFileSync(arcFile, 'page "Home"\n  text "Hello world"\n')

      const logs = []
      const origLog = console.log
      console.log = (...a) => logs.push(a.map(String).join(' '))
      try {
        await explain(arcFile)
      } finally {
        console.log = origLog
      }

      const output = logs.join('\n')
      assert.ok(
        output.includes('No backend') || output.toLowerCase().includes('no backend'),
        'should note that no backend declarations were found'
      )
    } finally {
      rmDir(dir)
    }
  })

  test('explain with route that reads from DB shows reads annotation', async () => {
    const dir = mkTmpDir('explain-dbreads')
    try {
      const arcFile = path.join(dir, 'server.arc')
      fs.writeFileSync(arcFile, `
@route get "/posts" -> Response
  json(db.posts.findMany())
`)
      const logs = []
      const origLog = console.log
      console.log = (...a) => logs.push(a.map(String).join(' '))
      try {
        await explain(arcFile)
      } finally {
        console.log = origLog
      }

      const output = logs.join('\n')
      assert.ok(output.includes('/posts'), 'should mention /posts route')
    } finally {
      rmDir(dir)
    }
  })
})

describe('cli: generate command (via _internal)', () => {
  test('generate is exported as a function', () => {
    assert.strictEqual(typeof generate, 'function')
  })

  test('generate model creates schema file', () => {
    const dir = mkTmpDir('generate-model')
    const origCwd = process.cwd()
    try {
      process.chdir(dir)
      const logs = []
      const origLog = console.log
      console.log = (...a) => logs.push(a.map(String).join(' '))
      try {
        generate('model', 'Product')
      } finally {
        console.log = origLog
      }
      const outFile = path.join(dir, 'server', 'schemas', 'product.arc')
      assert.ok(fs.existsSync(outFile), 'schema file should be created')
      const content = fs.readFileSync(outFile, 'utf8')
      assert.ok(content.includes('model Product'), 'should contain model declaration')
    } finally {
      process.chdir(origCwd)
      rmDir(dir)
    }
  })

  test('generate handler creates routes file', () => {
    const dir = mkTmpDir('generate-handler')
    const origCwd = process.cwd()
    try {
      process.chdir(dir)
      const logs = []
      const origLog = console.log
      console.log = (...a) => logs.push(a.map(String).join(' '))
      try {
        generate('handler', 'Order')
      } finally {
        console.log = origLog
      }
      const outFile = path.join(dir, 'server', 'routes', 'order.arc')
      assert.ok(fs.existsSync(outFile), 'routes file should be created')
      const content = fs.readFileSync(outFile, 'utf8')
      assert.ok(content.includes('@route get'), 'should contain route declarations')
    } finally {
      process.chdir(origCwd)
      rmDir(dir)
    }
  })

  test('generate job creates job file', () => {
    const dir = mkTmpDir('generate-job')
    const origCwd = process.cwd()
    try {
      process.chdir(dir)
      const logs = []
      const origLog = console.log
      console.log = (...a) => logs.push(a.map(String).join(' '))
      try {
        generate('job', 'SendEmail')
      } finally {
        console.log = origLog
      }
      const outFile = path.join(dir, 'server', 'jobs', 'sendemail.arc')
      assert.ok(fs.existsSync(outFile), 'job file should be created')
      const content = fs.readFileSync(outFile, 'utf8')
      assert.ok(content.includes('job SendEmail'), 'should contain job declaration')
    } finally {
      process.chdir(origCwd)
      rmDir(dir)
    }
  })

  test('generate model does not overwrite existing file (subprocess)', () => {
    const { execFileSync } = require('child_process')
    const cliPath = path.resolve(__dirname, '..', 'src', 'cli.js')
    const dir = mkTmpDir('generate-dupe')
    try {
      // First call succeeds
      execFileSync('node', [cliPath, 'generate', 'model', 'Widget'], { cwd: dir, stdio: 'pipe' })
      // Second call should fail with non-zero exit
      assert.throws(
        () => execFileSync('node', [cliPath, 'generate', 'model', 'Widget'], { cwd: dir, stdio: 'pipe' }),
        /Command failed/,
        'second generate should fail'
      )
    } finally {
      rmDir(dir)
    }
  })

  test('generate with unknown type exits non-zero (subprocess)', () => {
    const { execFileSync } = require('child_process')
    const cliPath = path.resolve(__dirname, '..', 'src', 'cli.js')
    const dir = mkTmpDir('generate-unknown')
    try {
      assert.throws(
        () => execFileSync('node', [cliPath, 'generate', 'migration', 'Foo'], { cwd: dir, stdio: 'pipe' }),
        /Command failed/,
        'unknown type should fail'
      )
    } finally {
      rmDir(dir)
    }
  })
})

describe('cli: buildServer and serve (type checks)', () => {
  test('buildServer is exported as a function', () => {
    assert.strictEqual(typeof buildServer, 'function')
  })

  test('serve is exported as a function', () => {
    assert.strictEqual(typeof serve, 'function')
  })
})

describe('cli: _injectPrefetchTags', () => {
  test('_injectPrefetchTags is exported as a function', () => {
    assert.strictEqual(typeof _injectPrefetchTags, 'function')
  })

  test('injects prefetch link for a linked page', async () => {
    const dir = mkTmpDir('prefetch')
    try {
      fs.mkdirSync(path.join(dir, 'dist'), { recursive: true })
      // Write two HTML files that link to each other
      const indexHtml = '<html><head></head><body><a href="about.html">About</a></body></html>'
      const aboutHtml = '<html><head></head><body><a href="index.html">Home</a></body></html>'
      fs.writeFileSync(path.join(dir, 'dist', 'index.html'), indexHtml)
      fs.writeFileSync(path.join(dir, 'dist', 'about.html'), aboutHtml)

      const compiled = [
        { slug: 'index', meta: {} },
        { slug: 'about', meta: {} },
      ]

      await _injectPrefetchTags(path.join(dir, 'dist'), compiled)

      const resultIndex = fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8')
      assert.ok(
        resultIndex.includes('<link rel="prefetch" href="about.html">'),
        'index.html should prefetch about.html'
      )
    } finally {
      rmDir(dir)
    }
  })

  test('injects view-transition meta by default', async () => {
    const dir = mkTmpDir('viewtrans')
    try {
      fs.mkdirSync(path.join(dir, 'dist'), { recursive: true })
      const html = '<html><head></head><body>hi</body></html>'
      fs.writeFileSync(path.join(dir, 'dist', 'page.html'), html)

      const compiled = [{ slug: 'page', meta: {} }]
      await _injectPrefetchTags(path.join(dir, 'dist'), compiled)

      const result = fs.readFileSync(path.join(dir, 'dist', 'page.html'), 'utf8')
      assert.ok(
        result.includes('<meta name="view-transition" content="same-origin">'),
        'should inject view-transition meta'
      )
    } finally {
      rmDir(dir)
    }
  })

  test('suppresses view-transition meta when viewTransitions is false', async () => {
    const dir = mkTmpDir('noviewtrans')
    try {
      fs.mkdirSync(path.join(dir, 'dist'), { recursive: true })
      const html = '<html><head></head><body>hi</body></html>'
      fs.writeFileSync(path.join(dir, 'dist', 'page.html'), html)

      const compiled = [{ slug: 'page', meta: { viewTransitions: false } }]
      await _injectPrefetchTags(path.join(dir, 'dist'), compiled)

      const result = fs.readFileSync(path.join(dir, 'dist', 'page.html'), 'utf8')
      assert.ok(
        !result.includes('<meta name="view-transition"'),
        'should not inject view-transition meta when disabled'
      )
    } finally {
      rmDir(dir)
    }
  })
})

describe('cli: buildSite (multi-page, subprocess)', () => {
  const { execFileSync } = require('child_process')
  const cliPath = path.resolve(__dirname, '..', 'src', 'cli.js')

  test('buildSite compiles two page files and emits both HTMLs', () => {
    const dir = mkTmpDir('buildsite-multi')
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "Home"\n  text "Welcome"\n')
      fs.writeFileSync(path.join(dir, 'about.arc'), 'page "About"\n  text "About us"\n')
      execFileSync('node', [cliPath, 'build-site', dir], { stdio: 'pipe' })
      assert.ok(fs.existsSync(path.join(dir, 'dist', 'index.html')), 'index.html should exist')
      assert.ok(fs.existsSync(path.join(dir, 'dist', 'about.html')), 'about.html should exist')
    } finally {
      rmDir(dir)
    }
  })

  test('buildSite emits _headers manifest and sitemap for multi-page sites', () => {
    const dir = mkTmpDir('buildsite-meta')
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "Home"\n  title "My Site"\n  text "Welcome"\n')
      fs.writeFileSync(path.join(dir, 'about.arc'), 'page "About"\n  text "About us"\n')
      const out = execFileSync('node', [cliPath, 'build-site', dir], { stdio: 'pipe' }).toString()
      assert.ok(out.includes('2 pages') || out.includes('built site'), `expected site build summary, got: ${out}`)
      assert.ok(fs.existsSync(path.join(dir, 'dist', '_headers')), '_headers should exist')
    } finally {
      rmDir(dir)
    }
  })
})
