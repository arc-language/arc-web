'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const { CYAN, DIM, RESET } = require('../utils/errors')
const { findArcFiles } = require('../utils/fs')

function createFileWatcher(absDir, onChange) {
  const watched = new Set()

  function watchDir(dir) {
    if (!fs.existsSync(dir)) return
    try {
      fs.watch(dir, { recursive: true }, (event, filename) => {
        if (!filename?.endsWith('.arc')) return
        onChange(filename)
      })
      watched.add(dir)
    } catch {
      for (const f of findArcFiles(dir)) {
        if (watched.has(f)) continue
        watched.add(f)
        fs.watchFile(f, { interval: 500 }, () => {
          onChange(path.relative(absDir, f))
        })
      }
    }
  }

  watchDir(absDir)
  return watched
}

async function serve(projectDir, flags, buildServer) {
  const outFile = await buildServer(projectDir, {}, flags)

  const bunCheck = spawnSync('bun', ['--version'], { stdio: 'pipe' })
  const runtime = bunCheck.status === 0 ? 'bun' : 'node'

  if (runtime === 'node') {
    console.warn('arc: bun not found — falling back to node. Install bun for best performance.')
    console.warn('     https://bun.sh')
  }

  const absDir = path.resolve(projectDir)
  const serverDir = fs.existsSync(path.join(absDir, 'server'))
    ? path.join(absDir, 'server')
    : absDir

  // --port flag: pass as PORT env var to the child process
  const childEnv = flags.port
    ? { ...process.env, PORT: String(flags.port) }
    : process.env

  let child = null
  let _rebuilding = false

  function startChild() {
    if (child) {
      child.removeAllListeners()
      child.kill('SIGTERM')
    }
    const thisChild = spawn(runtime, [outFile], { stdio: 'inherit', env: childEnv })
    child = thisChild
    thisChild.on('error', e => console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'server_spawn_failed', msg: e.message })))
    thisChild.on('exit', (code, signal) => {
      // Ignore exit from superseded children - only act on the currently active one.
      if (child !== thisChild) return
      if (signal !== 'SIGTERM') process.exit(code ?? 0)
    })
  }

  let _pendingRebuild = false
  async function rebuild() {
    if (_rebuilding) { _pendingRebuild = true; return }
    _rebuilding = true
    try {
      await buildServer(projectDir, {}, flags)
      console.log(`${CYAN}arc: reloaded${RESET}`)
      startChild()
    } catch (e) {
      console.error(`arc: rebuild failed: ${e?.stack ?? e?.message ?? String(e)}`)
    } finally {
      _rebuilding = false
    }
    if (_pendingRebuild) { _pendingRebuild = false; rebuild().catch(e => console.error(`arc: rebuild error: ${e?.message ?? String(e)}`)) }
  }

  console.log(`arc: starting server with ${runtime}...`)
  startChild()

  let debounceTimer = null
  createFileWatcher(serverDir, (filename) => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      console.log(`${DIM}arc: ${filename} changed — rebuilding...${RESET}`)
      rebuild().catch(e => console.error(`arc: rebuild error: ${e?.message ?? String(e)}`))
    }, 150)
  })
  console.log(`${DIM}arc: watching ${path.relative(process.cwd(), serverDir)}/**/*.arc${RESET}`)

  // Re-emit child's exit code so the parent shell sees the correct status.
  process.on('SIGINT', () => { if (child) { child.once('exit', c => process.exit(c ?? 0)); child.kill('SIGINT') } else process.exit(0) })
  process.on('SIGTERM', () => { if (child) { child.once('exit', c => process.exit(c ?? 0)); child.kill('SIGTERM') } else process.exit(0) })
}

module.exports = { serve, createFileWatcher }
