'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const { CYAN, DIM, RESET } = require('../utils/errors')
const { findArcFiles } = require('../utils/fs')

function createFileWatcher(absDir, onChange) {
  const watched = new Set()
  const fsWatchers = []
  let _closed = false

  function watchDir(dir) {
    if (!fs.existsSync(dir)) return
    try {
      const w = fs.watch(dir, { recursive: true }, (event, filename) => {
        if (!filename?.endsWith('.arc')) return
        onChange(filename)
      })
      fsWatchers.push(w)
      watched.add(dir)
    } catch {
      for (const f of findArcFiles(dir)) {
        if (watched.has(f)) continue
        watched.add(f)
        fs.watchFile(f, { interval: 500 }, () => {
          if (_closed) return
          onChange(path.relative(absDir, f))
        })
      }
    }
  }

  watchDir(absDir)

  watched.close = function () {
    _closed = true
    for (const w of fsWatchers) w.close()
    if (!fsWatchers.length) {
      for (const f of watched) fs.unwatchFile(f)
    }
    watched.clear()
    fsWatchers.length = 0
  }
  return watched
}

async function serve(projectDir, flags, buildServer, buildSite) {
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

  const childEnv = flags.port
    ? { ...process.env, PORT: String(flags.port) }
    : process.env

  let child = null
  let _rebuilding = false

  async function startChild() {
    if (child) {
      const dying = child
      child = null
      dying.removeAllListeners()
      dying.kill('SIGTERM')
      await new Promise(resolve => {
        const t = setTimeout(() => { dying.kill('SIGKILL'); resolve() }, 3000)
        dying.once('exit', () => { clearTimeout(t); resolve() })
      })
    }
    const thisChild = spawn(runtime, [outFile], { stdio: 'inherit', env: childEnv, cwd: path.dirname(outFile) })
    thisChild.on('error', e => console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'server_spawn_failed', msg: e.message })))
    thisChild.on('exit', (code, signal) => {
      if (child !== thisChild) return
      if (signal !== 'SIGTERM' && signal !== 'SIGKILL') process.exit(code ?? 0)
    })
    child = thisChild
  }

  let _pendingServerRebuild = false
  async function rebuildServer() {
    if (_rebuilding) { _pendingServerRebuild = true; return }
    _rebuilding = true
    try {
      do {
        _pendingServerRebuild = false
        try {
          await buildServer(projectDir, {}, flags)
          console.log(`${CYAN}arc: server reloaded${RESET}`)
          await startChild()
        } catch (e) {
          console.error(`arc: server rebuild failed: ${e?.stack ?? e?.message ?? String(e)}`)
        }
      } while (_pendingServerRebuild)
    } finally {
      _rebuilding = false
    }
  }

  let _siteBusy = false
  let _pendingSiteRebuild = false
  async function rebuildSite() {
    if (!buildSite) return
    if (_siteBusy) { _pendingSiteRebuild = true; return }
    _siteBusy = true
    try {
      await buildSite(projectDir)
      console.log(`${CYAN}arc: site rebuilt${RESET}`)
    } catch (e) {
      console.error(`arc: site rebuild failed: ${e?.stack ?? e?.message ?? String(e)}`)
    } finally {
      _siteBusy = false
    }
    if (_pendingSiteRebuild) { _pendingSiteRebuild = false; await rebuildSite() }
  }

  console.log(`arc: starting server with ${runtime}...`)
  await startChild()

  // Single watcher on the project root, dispatching by file location.
  // - server/**/*.arc → server rebuild + bun restart
  // - everything else → site (static HTML) rebuild
  const serverRel = path.relative(absDir, serverDir)
  let serverDebounce = null
  let siteDebounce = null

  const watcher = createFileWatcher(absDir, (filename) => {
    // Ignore dist, node_modules, dotfiles
    if (filename.startsWith('dist/') || filename.startsWith('node_modules/') || filename.startsWith('.')) return

    const isServerFile = serverRel
      ? (filename === serverRel || filename.startsWith(serverRel + path.sep) || filename.startsWith(serverRel + '/'))
      : false

    if (isServerFile) {
      clearTimeout(serverDebounce)
      serverDebounce = setTimeout(() => {
        console.log(`${DIM}arc: server/${path.basename(filename)} changed — rebuilding server...${RESET}`)
        rebuildServer().catch(e => console.error(`arc: rebuild error: ${e?.message ?? String(e)}`))
      }, 150)
    } else if (buildSite) {
      clearTimeout(siteDebounce)
      siteDebounce = setTimeout(() => {
        console.log(`${DIM}arc: ${filename} changed — rebuilding site...${RESET}`)
        rebuildSite().catch(e => console.error(`arc: site rebuild error: ${e?.message ?? String(e)}`))
      }, 200)
    }
  })

  if (buildSite) {
    console.log(`${DIM}arc: watching server/**/*.arc (server reload) + **/*.arc (site rebuild)${RESET}`)
  } else {
    console.log(`${DIM}arc: watching ${path.relative(process.cwd(), serverDir)}/**/*.arc${RESET}`)
  }

  process.once('SIGINT', () => {
    clearTimeout(serverDebounce); clearTimeout(siteDebounce); watcher.close()
    if (child) {
      const t = setTimeout(() => process.exit(0), 5000)
      child.once('exit', c => { clearTimeout(t); process.exit(c ?? 0) })
      child.kill('SIGINT')
    } else process.exit(0)
  })
  process.once('SIGTERM', () => {
    clearTimeout(serverDebounce); clearTimeout(siteDebounce); watcher.close()
    if (child) {
      const t = setTimeout(() => process.exit(0), 5000)
      child.once('exit', c => { clearTimeout(t); process.exit(c ?? 0) })
      child.kill('SIGTERM')
    } else process.exit(0)
  })
  process.on('unhandledRejection', (reason) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'unhandled_rejection', msg: reason instanceof Error ? reason.message : String(reason) }))
  })
}

module.exports = { serve, createFileWatcher }
