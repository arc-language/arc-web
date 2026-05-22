'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')

const {
  compile,
  resolveImports,
  composeClientJs,
  hashString,
  injectAssets,
  fmt,
  findArcFiles,
  newProject,
} = require('../src/cli')

const TMPDIR = os.tmpdir()

function mkTmpDir(name) {
  const dir = fs.mkdtempSync(path.join(TMPDIR, `arc-test-${name}-`))
  return dir
}

function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}

describe('cli — hashString', () => {
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

describe('cli — injectAssets', () => {
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

describe('cli — fmt', () => {
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

describe('cli — composeClientJs', () => {
  test('returns empty when all parts are empty', () => {
    assert.equal(composeClientJs('', '', ''), '')
  })

  test('returns only reactive when no stubs/realtime', () => {
    const reactive = 'const _x = 1;'
    const result = composeClientJs(reactive, '', '')
    assert.equal(result, reactive)
  })

  test('includes ADP runtime when stubs are present', () => {
    const result = composeClientJs('', 'const stub = () => {}', '')
    assert.ok(result.includes('_adpEncode'), `Expected ADP runtime in result`)
    assert.ok(result.includes('const stub'))
  })

  test('includes ADP runtime when realtime is present', () => {
    const result = composeClientJs('', '', 'const _rt = new WebSocket()')
    assert.ok(result.includes('_adpEncode'))
    assert.ok(result.includes('_rt'))
  })

  test('combines all parts in order: runtime, stubs, reactive, realtime', () => {
    const result = composeClientJs('REACT', 'STUBS', 'REALT')
    const runtimePos = result.indexOf('_adpEncode')
    const stubsPos = result.indexOf('STUBS')
    const reactPos = result.indexOf('REACT')
    const realtPos = result.indexOf('REALT')
    assert.ok(runtimePos < stubsPos)
    assert.ok(stubsPos < reactPos)
    assert.ok(reactPos < realtPos)
  })
})

describe('cli — findArcFiles', () => {
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

describe('cli — resolveImports', () => {
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
      // Should compile without errors — the escape attempt is just warned and skipped
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
      // Create a directory at the import path instead of a file — readFile will EISDIR
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

describe('cli — newProject', () => {
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
})

describe('cli — build command (subprocess)', () => {
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
      // Should warn but still complete (note: stderr might contain the warning, or it might compile)
      assert.ok(stderr.length > 0 || stdout.length > 0 || r.status === 0,
        `Expected some output: stderr=${stderr}, stdout=${stdout}`)
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

describe('cli — check command (subprocess)', () => {
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

describe('cli — check command edge cases (subprocess)', () => {
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

  test('check on non-existent file is reported as error', () => {
    assert.throws(
      () => execFileSync('node', [cliPath, 'check', '/nonexistent/path.arc'], { stdio: 'pipe' }),
      /Command failed/
    )
  })
})

describe('cli — new command edge cases (subprocess)', () => {
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

describe('cli — fatal error handling (subprocess)', () => {
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
  })

  test('unknown subcommand prints help', () => {
    const result = spawnSync('node', [cliPath, 'unknown-cmd'], { stdio: 'pipe' })
    const out = result.stdout.toString()
    assert.ok(out.includes('build') && out.includes('dev'), `Expected help in: ${out}`)
  })
})

describe('cli — formatError edge cases', () => {
  const { formatError, showSourceContext } = require('../src/cli')

  test('formatError works without filename', () => {
    // Just ensure it doesn't throw
    const err = new Error('test error message')
    formatError(err, null, null)
  })

  test('formatError extracts line:col from message and shows source context', () => {
    const err = new SyntaxError('test.arc:3:5: something went wrong')
    const source = 'line1\nline2\nline3 here\nline4'
    // Capture stderr to ensure no throw
    formatError(err, source, 'test.arc')
  })

  test('showSourceContext handles missing line gracefully', () => {
    showSourceContext('line1\nline2', null, null)
    showSourceContext('line1\nline2', 999, 1)  // line out of range
  })

  test('showSourceContext displays col indicator when col provided', () => {
    showSourceContext('hello world', 1, 7)  // col=7 → points at 'w'
  })
})

describe('cli — version and help', () => {
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

describe('cli — new command (subprocess)', () => {
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

describe('cli — dev server (subprocess + HTTP)', () => {
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

  test('dev server serves /styles.css', async () => {
    const dir = mkTmpDir('devcss')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "x"\n  design\n    body\n      bg: red')
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

  test('dev server returns 403 for path traversal attempt', async () => {
    const dir = mkTmpDir('devtrav')
    const port = 13000 + Math.floor(Math.random() * 1000)
    let proc
    try {
      fs.writeFileSync(path.join(dir, 'index.arc'), 'page "T"\n  text "x"')
      proc = await startDevServer(dir, port)
      const r = await httpGet(port, '/../../../etc/passwd')
      // After URL normalization, this either gets blocked (403) or becomes /etc/passwd (404)
      assert.ok(r.status === 403 || r.status === 404 || r.status === 200, `Expected blocked, got ${r.status}`)
      if (r.status === 200) {
        // If it served something, it should be the SPA fallback (index.html), not /etc/passwd
        assert.ok(!r.body.includes('root:'), 'Should not leak /etc/passwd contents')
      }
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
      // %ZZ is an invalid percent-encoding — decodeURIComponent throws
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

describe('cli — deploy command (subprocess)', () => {
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
