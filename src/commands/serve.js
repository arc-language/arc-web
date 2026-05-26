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

  let child = null
  let _rebuildChain = Promise.resolve()

  function startChild() {
    if (child) {
      child.removeAllListeners()
      child.kill('SIGTERM')
    }
    const thisChild = spawn(runtime, [outFile], { stdio: 'inherit', env: process.env })
    child = thisChild
    thisChild.on('error', e => console.error(`arc: could not start server: ${e.message}`))
    thisChild.on('exit', (code, signal) => {
      // Ignore exit from superseded children — only act on the currently active one.
      if (child !== thisChild) return
      if (signal !== 'SIGTERM') process.exit(code ?? 0)
    })
  }

  function rebuild() {
    _rebuildChain = _rebuildChain.then(async () => {
      try {
        await buildServer(projectDir, {}, flags)
        console.log(`${CYAN}arc: reloaded${RESET}`)
        startChild()
      } catch (e) {
        console.error(`arc: rebuild failed: ${e?.stack ?? e?.message ?? String(e)}`)
      }
      // Reset to a fresh resolved promise so settled chain nodes can be GC'd.
      _rebuildChain = Promise.resolve()
    })
    return _rebuildChain
  }

  console.log(`arc: starting server with ${runtime}...`)
  startChild()

  let debounceTimer = null
  createFileWatcher(serverDir, (filename) => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      console.log(`${DIM}arc: ${filename} changed — rebuilding...${RESET}`)
      rebuild().catch(e => console.error(`arc: rebuild error: ${e.message}`))
    }, 150)
  })
  console.log(`${DIM}arc: watching ${path.relative(process.cwd(), serverDir)}/**/*.arc${RESET}`)

  process.on('SIGINT', () => { if (child) child.kill('SIGINT'); process.exit(0) })
  process.on('SIGTERM', () => { if (child) child.kill('SIGTERM'); process.exit(0) })
}

module.exports = { serve, createFileWatcher }
