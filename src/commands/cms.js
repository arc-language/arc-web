'use strict'

const fs = require('fs')
const path = require('path')

const _C = process.stdout.isTTY && !process.env.NO_COLOR
const _CYAN  = _C ? '\x1b[36m' : ''
const _GREEN = _C ? '\x1b[32m' : ''
const _DIM   = _C ? '\x1b[2m'  : ''
const _RED   = _C ? '\x1b[31m' : ''
const _RST   = _C ? '\x1b[0m'  : ''

const _PKG_ROOT = path.join(__dirname, '..', '..', 'packages', 'arc-cms')
const _SRC_WIDGETS = path.join(_PKG_ROOT, 'src', 'widgets')
const _SRC_PAGES   = path.join(_PKG_ROOT, 'src', 'pages')
const _SRC_PUBLIC  = path.join(_PKG_ROOT, 'src', 'public')
const _SRC_SCHEMA  = path.join(_PKG_ROOT, 'src', 'schema')
const _SRC_SERVER  = path.join(_PKG_ROOT, 'src', 'server')

// ── Per-type block editor codegen ────────────────────────────────────────────
// Reads block-types.json and emits one admin/blocks/{type}.arc per type, each
// with explicit @state vars for every field in the schema. Arrays and selects
// are flattened to textarea fallback for v1 to keep generated code simple.
function _esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') }

function generateTypeEditor(typeKey, schema, styleFields = []) {
  const label = schema.label ?? typeKey
  const fields = (schema.fields ?? []).filter(f => f.type !== 'array')
  const arrayFields = (schema.fields ?? []).filter(f => f.type === 'array')

  const stateLines = fields.map(f => {
    const defaultVal = f.type === 'select' ? `"${_esc((f.options ?? [''])[0])}"` : '""'
    return `  @state let f_${f.name} = (meta.data.${f.name} ?? ${defaultVal})`
  }).join('\n')

  const arrayState = arrayFields.length
    ? arrayFields.map(f => `  @state let f_${f.name} = JSON.stringify(meta.data.${f.name} ?? [])`).join('\n')
    : ''

  // Style fields are stored under data._style and edited via the same form section.
  const styleState = styleFields.length
    ? '\n' + styleFields.map(sf => {
        const defaultVal = sf.type === 'select' ? `"${_esc((sf.options ?? [''])[0])}"` : '""'
        return `  @state let s_${sf.name} = ((meta.data._style ?? {}).${sf.name} ?? ${defaultVal})`
      }).join('\n')
    : ''

  const fieldFnArgs = [
    ...fields.map(f => `${f.name}: String`),
    ...arrayFields.map(f => `${f.name}: String`),
    ...styleFields.map(sf => `style_${sf.name}: String`),
  ].join(', ')

  const styleObjEntries = styleFields.map(sf => `${sf.name}: style_${sf.name}`).join(', ')
  const dataObj = [
    ...fields.map(f => `${f.name}: ${f.name}`),
    ...arrayFields.map(f => `${f.name}: JSON.parse(${f.name})`),
    ...(styleFields.length ? [`_style: { ${styleObjEntries} }`] : []),
  ].join(', ')

  // Children of `col class="!card" ... ` (indent 8) should sit at indent 10.
  const formRows = fields.map(f => {
    const lbl = _esc(f.label ?? f.name)
    const req = f.required ? 'true' : 'false'
    if (f.type === 'textarea') {
      return `          col gap="6px"
            text class="!input-label ${f.required ? '!input-label--required' : ''}" "${lbl}"
            textarea class="!input ${f.mono ? 'cms-mono' : ''}" bind:value="f_${f.name}" rows="${f.mono ? '10' : '5'}"`
    }
    if (f.type === 'select') {
      const opts = (f.options ?? []).map(o => `              option value="${_esc(o)}" "${_esc(o)}"`).join('\n')
      return `          col gap="6px"
            text class="!input-label ${f.required ? '!input-label--required' : ''}" "${lbl}"
            select class="!input" bind:value="f_${f.name}"
${opts}`
    }
    const inputType = f.type === 'url' ? 'url' : (f.type === 'number' ? 'number' : (f.type === 'email' ? 'email' : 'text'))
    return `          CmsField label="${lbl}" name="f_${f.name}" type="${inputType}" required="${req}"`
  }).join('\n')

  const arrayRows = arrayFields.map(f => {
    const lbl = _esc(f.label ?? f.name)
    const hint = f.of ? `Array of objects: ${Object.keys(f.of).join(', ')}` : 'Array of items'
    return `          col gap="6px"
            text class="!input-label" "${lbl}"
            text class="cms-hint" "${hint} (one JSON object per line, or a JSON array)"
            textarea class="!input cms-mono" bind:value="f_${f.name}" rows="8"`
  }).join('\n')

  const styleRows = styleFields.length
    ? styleFields.map(sf => {
        const lbl = _esc(sf.label ?? sf.name)
        const placeholder = _esc(sf.placeholder ?? '')
        if (sf.type === 'select') {
          const opts = (sf.options ?? []).map(o => `              option value="${_esc(o)}" "${_esc(o)}"`).join('\n')
          return `          col gap="6px"
            text class="!input-label" "${lbl}"
            select class="!input" bind:value="s_${sf.name}"
${opts}`
        }
        return `          CmsField label="${lbl}" name="s_${sf.name}" placeholder="${placeholder}"`
      }).join('\n')
    : ''

  const saveArgs = [
    ...fields.map(f => `f_${f.name}`),
    ...arrayFields.map(f => `f_${f.name}`),
    ...styleFields.map(sf => `s_${sf.name}`),
  ].join(', ')

  return `import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsField from "site/cms/CmsField.arc"

# Auto-generated by arc cms init from server/block-types.json
# Schema-driven editor for "${typeKey}" blocks. Re-run cms init to regenerate.
page "Edit ${label} block - Admin"

  @param id

  @server fn getBlock(blockId: String) -> Any
    const blk = db.pageblocks.find(blockId)
    const parsed = JSON.parse(blk.data ?? "{}")
    return { block: blk, data: parsed }

  @live const meta = getBlock(id)

  @state let pageName = meta.block.page
  @state let visible  = meta.block.visible
  @state let deleted  = false
${stateLines}${arrayState ? '\n' + arrayState : ''}${styleState}

  @server fn save(blockId: String, p: String, v: Bool, ${fieldFnArgs}) -> Any
    if !session || (session.role != "admin" && session.role != "editor")
      return { error: "forbidden" }
    const data = JSON.stringify({ ${dataObj} })
    db.pageblocks.update(blockId, { page: p, visible: v, data: data })
    db.auditlogs.create({ actorId: session.userId, action: "update", entityType: "PageBlock", entityId: blockId, after: data })
    return { ok: true }

  @server fn deleteBlock(blockId: String) -> Any
    if !session || (session.role != "admin" && session.role != "editor")
      return { error: "forbidden" }
    db.pageblocks.delete(blockId)
    db.auditlogs.create({ actorId: session.userId, action: "delete", entityType: "PageBlock", entityId: blockId })
    return { ok: true }

  CmsLayout title="Edit ${label} block" active="blocks"
    if deleted
      col class="!card" p="24px"
        text "Block deleted."
        link href="/admin/blocks"
          button class="!btn !btn--ghost" "Back to blocks"

    if !deleted
      CmsPageHeader title="${label} block" subtitle="on page: {pageName}"
        link href="/admin/blocks/{id}"
          button class="!btn !btn--ghost" "Raw JSON editor"
        link href="/admin/blocks"
          button class="!btn !btn--ghost" "Back"

      row class="cms-editor" gap="24px"
        col class="!card" p="24px" gap="14px" style="flex:1; min-width:0"
          CmsField label="Page slug" name="pageName" required="true"
          row gap="10px" align="center"
            input type="checkbox" bind:checked="visible"
            text class="!input-label" "Visible"

          text class="cms-section" "${label} fields"
${formRows || '          text class="cms-hint" "No simple fields defined."'}${arrayRows ? '\n\n          text class="cms-section" "Lists"\n' + arrayRows : ''}${styleRows ? '\n\n          text class="cms-section" "Style"\n' + styleRows : ''}

          row gap="10px"
            button class="!btn !btn--primary" on:click={ save(id, pageName, visible, ${saveArgs}) } "Save"
            button class="!btn !btn--danger" on:click={ @deleted = (confirm("Delete block?") && deleteBlock(id).ok == true) } "Delete"

        col class="cms-preview" style="flex:1; min-width:0"
          text class="cms-section" "Live preview"
          iframe src="/{pageName}?preview=1" class="cms-preview-frame"

  design
    .cms-editor
      align-items: stretch
    .cms-section
      font-size: 12px
      font-weight: 700
      text-transform: uppercase
      letter-spacing: 0.07em
      color: var(--ui-fg-3, #a3a3a3)
      margin: 4px 0
    .cms-hint
      font-size: 12px
      color: var(--ui-fg-3, #a3a3a3)
      margin: 0
    .cms-mono
      font-family: ui-monospace, 'SF Mono', Consolas, monospace
      font-size: 12px
    .cms-preview
      display: flex
      flex-direction: column
      gap: 8px
    .cms-preview-frame
      width: 100%
      flex: 1
      min-height: 420px
      border: 1px solid var(--ui-border, #e5e5e5)
      border-radius: 12px
      background-color: #fff
`
}

function generateAllBlockEditors(absDir, log, force) {
  const schemaFile = path.join(absDir, 'server', 'block-types.json')
  if (!fs.existsSync(schemaFile)) return
  let schema
  try {
    schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'))
  } catch (err) {
    log.warnings = log.warnings ?? []
    log.warnings.push(`could not parse server/block-types.json: ${err.message}`)
    return
  }
  const styleFields = schema._styleFields ?? []
  const blocksDir = path.join(absDir, 'admin', 'blocks')
  for (const [typeKey, typeSchema] of Object.entries(schema)) {
    if (typeKey.startsWith('_')) continue
    if (!/^[a-z][a-z0-9_-]*$/.test(typeKey)) {
      log.warnings = log.warnings ?? []
      log.warnings.push(`skipping invalid block type key: "${typeKey}"`)
      continue
    }
    const typeDir = path.join(blocksDir, typeKey)
    fs.mkdirSync(typeDir, { recursive: true })
    const dest = path.join(typeDir, '[id].arc')
    if (fs.existsSync(dest) && !force) {
      log.skipped.push(dest)
      continue
    }
    fs.writeFileSync(dest, generateTypeEditor(typeKey, typeSchema, styleFields))
    log.created.push(dest)
  }
}

function _copyDir(src, dest, log, force) {
  if (!fs.existsSync(src)) return
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      _copyDir(s, d, log, force)
    } else {
      if (fs.existsSync(d) && !force) {
        log.skipped.push(d)
        continue
      }
      fs.copyFileSync(s, d)
      log.created.push(d)
    }
  }
}

async function cmsInit(projectDir, opts = {}) {
  const absDir = path.resolve(projectDir || '.')
  const _t0 = Date.now()
  const force = !!opts.force

  if (!fs.existsSync(absDir)) {
    console.error(`${_RED}arc cms init: directory not found: ${absDir}${_RST}`)
    process.exit(1)
  }

  const log = { created: [], skipped: [] }

  // 1. Copy chrome widgets → <project>/site/cms/. Atoms (CmsField, CmsEmpty,
  // CmsConfirm) are NOT scaffolded — they're imported live from the package
  // via the @arc-cms/widgets/ alias so users get upstream bug fixes via
  // `npm update`. To customize an atom, run `arc cms eject <Name>`.
  const _PACKAGE_OWNED = new Set(['CmsField.arc', 'CmsEmpty.arc', 'CmsConfirm.arc'])
  if (fs.existsSync(_SRC_WIDGETS)) {
    const dest = path.join(absDir, 'site', 'cms')
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(_SRC_WIDGETS, { withFileTypes: true })) {
      if (_PACKAGE_OWNED.has(entry.name)) continue
      const s = path.join(_SRC_WIDGETS, entry.name)
      const d = path.join(dest, entry.name)
      if (entry.isDirectory()) {
        _copyDir(s, d, log, force)
      } else if (fs.existsSync(d) && !force) {
        log.skipped.push(d)
      } else {
        fs.copyFileSync(s, d)
        log.created.push(d)
      }
    }
  }

  // 1b. Copy public-side renderers (catch-all page + per-type block widgets)
  _copyDir(_SRC_PUBLIC, path.join(absDir, 'site'), log, force)

  // 2. Copy admin pages → <project>/admin/
  _copyDir(_SRC_PAGES, path.join(absDir, 'admin'), log, force)

  // 3. Copy schema (block-types.json + cms.config.arc template)
  const schemaDest = path.join(absDir, 'server')
  fs.mkdirSync(schemaDest, { recursive: true })
  for (const file of ['block-types.json', 'admin-roles.json']) {
    const s = path.join(_SRC_SCHEMA, file)
    const d = path.join(schemaDest, file)
    if (fs.existsSync(s) && (!fs.existsSync(d) || force)) {
      fs.copyFileSync(s, d)
      log.created.push(d)
    } else if (fs.existsSync(d)) {
      log.skipped.push(d)
    }
  }
  const cfgTemplate = path.join(_SRC_SCHEMA, 'cms.config.arc.template')
  const cfgDest     = path.join(absDir, 'cms.config.arc')
  if (fs.existsSync(cfgTemplate) && (!fs.existsSync(cfgDest) || force)) {
    fs.copyFileSync(cfgTemplate, cfgDest)
    log.created.push(cfgDest)
  } else if (fs.existsSync(cfgDest)) {
    log.skipped.push(cfgDest)
  }

  // 4. Copy server helpers
  const serverDest = path.join(absDir, 'server', 'cms')
  _copyDir(_SRC_SERVER, serverDest, log, force)

  // 4b. Generate per-type block editors from block-types.json
  generateAllBlockEditors(absDir, log, force)

  // 5. Ensure arc-ui CSS is available at public/arc-ui/arc-ui.css.
  // Prefer node_modules; fall back to a sibling checkout (dev environments).
  const _arcUiCandidates = [
    path.join(absDir, 'node_modules', '@arc-lang', 'arc-ui', 'index.css'),
    path.join(absDir, '..', 'arc-ui', 'index.css'),
    path.join(__dirname, '..', '..', '..', 'arc-ui', 'index.css'),
  ]
  const _arcUiSrc = _arcUiCandidates.find(p => fs.existsSync(p))
  const _arcUiDest = path.join(absDir, 'public', 'arc-ui', 'arc-ui.css')
  if (_arcUiSrc && !fs.existsSync(_arcUiDest)) {
    fs.mkdirSync(path.dirname(_arcUiDest), { recursive: true })
    // Inline imports - arc-ui's index.css uses @import; resolve them recursively so the file is self-contained.
    // Imports are bounded within the arc-ui package directory to prevent traversal.
    const _arcUiRoot = path.dirname(path.resolve(_arcUiSrc))
    const _inlineSeen = new Set()
    const _inline = src => {
      const abs = path.resolve(src)
      if (_inlineSeen.has(abs)) return ''
      _inlineSeen.add(abs)
      let txt
      try { txt = fs.readFileSync(abs, 'utf8') } catch { return '' }
      const dir = path.dirname(abs)
      return txt.replace(/@import\s+["']([^"']+)["'];?/g, (_, rel) => {
        const sub = path.resolve(dir, rel)
        // Bound imports within the arc-ui root to prevent path traversal
        if (!sub.startsWith(_arcUiRoot + path.sep) && sub !== path.resolve(_arcUiSrc)) return ''
        return fs.existsSync(sub) ? _inline(sub) : ''
      })
    }
    fs.writeFileSync(_arcUiDest, _inline(_arcUiSrc))
    log.created.push(_arcUiDest)
    // Also copy the JS files (toast, modal, etc.)
    const _jsSrc = path.join(path.dirname(_arcUiSrc), 'js')
    const _jsDest = path.join(path.dirname(_arcUiDest), 'js')
    if (fs.existsSync(_jsSrc)) {
      _copyDir(_jsSrc, _jsDest, log, force)
    }
  } else if (fs.existsSync(_arcUiDest)) {
    log.skipped.push(_arcUiDest)
  } else {
    log.warnings = log.warnings ?? []
    log.warnings.push('arc-ui CSS not found — install @arc-lang/arc-ui or copy index.css to public/arc-ui/arc-ui.css')
  }

  // 6. Print summary
  const rel = p => path.relative(process.cwd(), p)
  const elapsed = Date.now() - _t0

  if (_C) {
    console.log(`\n  ${_CYAN}⚡ arc cms init${_RST}\n`)
    for (const f of log.created.slice(0, 30)) {
      console.log(`  ${_GREEN}+${_RST} ${rel(f)}`)
    }
    if (log.created.length > 30) {
      console.log(`  ${_DIM}… and ${log.created.length - 30} more${_RST}`)
    }
    for (const f of log.skipped.slice(0, 10)) {
      console.log(`  ${_DIM}· ${rel(f)} (already exists, skipped)${_RST}`)
    }
    if (log.skipped.length > 10) {
      console.log(`  ${_DIM}… and ${log.skipped.length - 10} more skipped${_RST}`)
    }
    for (const w of (log.warnings ?? [])) {
      console.log(`  ${_RED}!${_RST} ${w}`)
    }
    console.log(`\n  ${_GREEN}✓${_RST}  ${log.created.length} files created${log.skipped.length ? `, ${log.skipped.length} skipped` : ''} in ${_DIM}${elapsed}ms${_RST}`)
    console.log(`  ${_DIM}↳  next: arc build-site . && arc build-server .${_RST}\n`)
  } else {
    for (const f of log.created) console.log(`arc cms init: created ${rel(f)}`)
    for (const f of log.skipped) console.log(`arc cms init: skipped ${rel(f)} (exists)`)
  }
}

// ── Superuser creation ──────────────────────────────────────────────────────
// Creates an admin user in the project's database. Supports both interactive
// (prompts for email/password) and non-interactive (flag-based) usage.
//
//   arc cms create-superuser
//   arc cms create-superuser --email admin@example.com --password 's3cret-pw'
//   arc cms create-superuser --email admin@example.com --password "$ENV_VAR" --name "Admin"
//   arc cms create-superuser --db ./custom.db
async function cmsCreateSuperuser(projectDir, opts = {}) {
  const absDir = path.resolve(projectDir || '.')
  if (!fs.existsSync(absDir)) {
    console.error(`${_RED}arc cms create-superuser: directory not found: ${absDir}${_RST}`)
    process.exit(1)
  }

  // Resolve the sqlite database path: explicit --db wins, then DATABASE_URL env,
  // then conventional locations.
  const dbCandidates = [
    opts.db,
    process.env.DATABASE_URL,
    path.join(absDir, 'app.db'),
    path.join(absDir, 'dev.db'),
  ].filter(Boolean)
  const dbPath = dbCandidates.find(p => fs.existsSync(p))
  if (!dbPath) {
    console.error(`${_RED}arc cms create-superuser: no database found. Looked for:${_RST}`)
    for (const p of dbCandidates) console.error(`  - ${p}`)
    console.error(`\nRun the server once (\`bun dist/server.js\`) to create the DB, or pass --db <path>.`)
    process.exit(1)
  }

  const readline = require('readline')
  const ask = (q, opts = {}) => new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    // Mute echo for password prompts via a custom Writable wrapper.
    if (opts.mask) {
      const origWrite = process.stdout.write.bind(process.stdout)
      rl._writeToOutput = (s) => {
        if (rl.line.length === 0) return origWrite(s)
        // Replace the typed char with '*'
        if (s.length > 0 && s !== q) origWrite('*')
      }
    }
    rl.question(q, (a) => { rl.close(); resolve(a) })
  })

  let email = opts.email
  let password = opts.password
  let name = opts.name

  if (!email) email = (await ask('Email: ')).trim()
  if (!email) { console.error(`${_RED}email required${_RST}`); process.exit(1) }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error(`${_RED}invalid email: ${email}${_RST}`); process.exit(1) }

  if (!password) {
    password = await ask('Password: ', { mask: true })
    process.stdout.write('\n')
    const confirm = await ask('Confirm:  ', { mask: true })
    process.stdout.write('\n')
    if (password !== confirm) { console.error(`${_RED}passwords do not match${_RST}`); process.exit(1) }
  }
  if (!password) {
    console.error(`${_RED}password required${_RST}`)
    process.exit(1)
  }
  if (password.length < 8) {
    if (!opts.force) {
      console.error(`${_RED}password must be at least 8 characters (use --force to override)${_RST}`)
      process.exit(1)
    }
    console.error(`${_RED}⚠  Weak password accepted via --force (${password.length} chars). DO NOT USE IN PRODUCTION.${_RST}`)
  }

  if (!name) name = (await ask('Name (optional): ') || '').trim() || email.split('@')[0]

  // Open DB and check / insert.
  let Database
  try { ({ Database } = require('bun:sqlite')) } catch (_) {
    try { Database = require('better-sqlite3') } catch (_) {
      console.error(`${_RED}arc cms create-superuser: needs bun or better-sqlite3 to access ${dbPath}${_RST}`)
      process.exit(1)
    }
  }
  const db = new Database(dbPath)

  // Check users table exists (otherwise schema isn't migrated)
  const table = db.query
    ? db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()
    : db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()
  if (!table) {
    console.error(`${_RED}arc cms create-superuser: 'users' table missing. Run \`arc build-server . && bun dist/server.js\` once to migrate the schema.${_RST}`)
    process.exit(1)
  }

  const exists = db.query
    ? db.query('SELECT id, role FROM users WHERE email = ?1').get(email)
    : db.prepare('SELECT id, role FROM users WHERE email = ?').get(email)
  const crypto = require('crypto')
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  const passwordHash = `${salt}:${hash}`
  const now = new Date().toISOString()

  if (exists) {
    // Promote and rotate password
    const updateQ = db.query
      ? db.query('UPDATE users SET role = ?1, passwordHash = ?2, name = ?3 WHERE id = ?4')
      : db.prepare('UPDATE users SET role = ?, passwordHash = ?, name = ? WHERE id = ?')
    updateQ.run('admin', passwordHash, name, exists.id)
    if (_C) {
      console.log(`\n  ${_GREEN}✓${_RST}  Updated user ${_CYAN}${email}${_RST} → role: admin, password rotated`)
      if (exists.role !== 'admin') console.log(`  ${_DIM}was role: ${exists.role}${_RST}`)
    } else {
      console.log(`arc cms create-superuser: updated existing user "${email}" (role=admin)`)
    }
  } else {
    const insertQ = db.query
      ? db.query('INSERT INTO users (email, name, role, oauthProvider, oauthId, passwordHash, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id')
      : db.prepare('INSERT INTO users (email, name, role, oauthProvider, oauthId, passwordHash, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    let newId
    if (db.query) {
      const row = insertQ.get(email, name, 'admin', 'local', 'local-' + Date.now(), passwordHash, now)
      newId = row?.id
    } else {
      const info = insertQ.run(email, name, 'admin', 'local', 'local-' + Date.now(), passwordHash, now)
      newId = info.lastInsertRowid
    }
    if (_C) {
      console.log(`\n  ${_GREEN}✓${_RST}  Created superuser`)
      console.log(`  ${_DIM}email${_RST}  ${_CYAN}${email}${_RST}`)
      console.log(`  ${_DIM}name${_RST}   ${name}`)
      console.log(`  ${_DIM}role${_RST}   admin`)
      console.log(`  ${_DIM}id${_RST}     ${newId}`)
      console.log(`  ${_DIM}db${_RST}     ${path.relative(process.cwd(), dbPath)}\n`)
      console.log(`  ${_DIM}↳  Sign in at /admin/login${_RST}\n`)
    } else {
      console.log(`arc cms create-superuser: created admin user "${email}" (id=${newId}) in ${dbPath}`)
    }
  }

  if (typeof db.close === 'function') db.close()
}

// Locate the arc-cms package source for the given project. Mirrors the
// resolver in src/cli.js — prefer node_modules (handles workspace installs),
// fall back to the in-repo monorepo path for development.
function _findCmsPackageSrc(projectDir) {
  try {
    const pkgJson = require.resolve('@arc-lang/arc-cms/package.json', { paths: [projectDir] })
    return path.join(path.dirname(pkgJson), 'src')
  } catch (_e) {
    const repoFallback = path.resolve(__dirname, '..', '..', 'packages', 'arc-cms', 'src')
    if (fs.existsSync(repoFallback)) return repoFallback
    return null
  }
}

// arc cms eject <Name> — copy one widget or page from the package into the user
// project so the @arc-cms/ resolver picks the local copy. Looks for the name in
// widgets/, then pages/, then public/. Preserves the relative path under the
// override directory (site/cms/).
async function cmsEject(projectDir, name, opts = {}) {
  const absDir = path.resolve(projectDir || '.')
  if (!name) {
    console.error(`${_RED}arc cms eject: missing widget or page name${_RST}`)
    console.error(`Usage: arc cms eject <Name>   (e.g. arc cms eject CmsLayout)`)
    process.exit(1)
  }
  const pkgSrc = _findCmsPackageSrc(absDir)
  if (!pkgSrc) {
    console.error(`${_RED}arc cms eject: @arc-lang/arc-cms not installed.${_RST}`)
    console.error(`Run: npm install @arc-lang/arc-cms`)
    process.exit(1)
  }
  const force = !!opts.force
  const stem = name.replace(/\.arc$/, '')
  const searchDirs = [
    { src: 'widgets', dest: path.join('site', 'cms', 'widgets') },
    { src: 'pages',   dest: 'admin' },
    { src: 'public',  dest: path.join('site', 'cms', 'public') },
  ]
  for (const { src, dest } of searchDirs) {
    const srcPath = path.join(pkgSrc, src, stem + '.arc')
    if (!fs.existsSync(srcPath)) continue
    const destPath = path.join(absDir, dest, stem + '.arc')
    if (fs.existsSync(destPath) && !force) {
      console.error(`${_RED}arc cms eject: ${path.relative(absDir, destPath)} already exists. Re-run with --force to overwrite.${_RST}`)
      process.exit(1)
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.copyFileSync(srcPath, destPath)
    console.log(`${_GREEN}arc cms eject:${_RST} ${path.relative(absDir, destPath)}`)
    console.log(`${_DIM}  This local copy now overrides the package version.${_RST}`)
    console.log(`${_DIM}  The @arc-cms/ resolver checks site/cms/ first, then the package.${_RST}`)
    return
  }
  console.error(`${_RED}arc cms eject: ${stem} not found in package widgets/, pages/, or public/${_RST}`)
  process.exit(1)
}

// ── arc cms add tree ─────────────────────────────────────────────────────────
// Installs the arc-tree package into the current project:
//   1. Adds "arc-tree" to arc.config.json packages array
//   2. Runs the materialized-path migration SQL for each configured model
//
// Models to migrate are read from arc.config.json "tree.models" (default: ["pages"]).
// Uses bun:sqlite or better-sqlite3 for migration, same as arc db migrate.
async function cmsAddTree(projectDir = '.', opts = {}) {
  const absDir  = path.resolve(projectDir)
  const cfgPath = path.join(absDir, 'arc.config.json')

  // 1. Read + update arc.config.json
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) } catch (_) {}
  if (!cfg.packages) cfg.packages = []
  if (!cfg.packages.includes('arc-tree')) cfg.packages.push('arc-tree')
  if (!cfg.tree) cfg.tree = {}
  if (!cfg.tree.models) cfg.tree.models = ['pages']
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n')
  console.log(`${_GREEN}✓${_RST}  arc.config.json updated — "arc-tree" added to packages`)

  // 2. Read migrate.sql template
  let migrateSqlTpl = ''
  try {
    // Prefer installed npm package; fall back to sibling in monorepo
    let tplPath
    try {
      const pkgJson = require.resolve('arc-tree/package.json', { paths: [absDir] })
      tplPath = path.join(path.dirname(pkgJson), 'src', 'schema', 'migrate.sql')
    } catch (_) {
      tplPath = path.resolve(__dirname, '..', '..', '..', 'arc-tree', 'src', 'schema', 'migrate.sql')
    }
    migrateSqlTpl = fs.readFileSync(tplPath, 'utf8')
  } catch (e) {
    console.error(`${_RED}arc cms add tree: could not find migrate.sql — is arc-tree installed?${_RST}`)
    console.error(`  Run: npm install arc-tree`)
    process.exit(1)
  }

  // 3. Open SQLite and run migration for each model
  const dbUrl = (cfg.db && cfg.db.url) ? path.join(absDir, cfg.db.url) : path.join(absDir, 'app.db')
  let Database
  try { ({ Database } = require('bun:sqlite')) } catch (_) {
    try { Database = require('better-sqlite3') } catch (_) {
      console.log(`${_DIM}  Could not open SQLite (install better-sqlite3 or run with bun).${_RST}`)
      console.log(`  Run this SQL manually for each model in ${cfg.tree.models.join(', ')}:`)
      console.log('')
      console.log(migrateSqlTpl)
      return
    }
  }

  if (!fs.existsSync(dbUrl)) {
    console.log(`${_DIM}  Database not found at ${dbUrl} — skipping auto-migration.${_RST}`)
    console.log(`  Run \`arc build-server && bun dist/server.js\` once to create the DB, then re-run \`arc cms add tree\`.`)
    return
  }

  const _SAFE_MODEL = /^[a-z_][a-z0-9_]*$/i
  const db = new Database(dbUrl)
  for (const model of cfg.tree.models) {
    if (!_SAFE_MODEL.test(model)) {
      console.error(`${_RED}arc cms add tree: unsafe model name "${model}" — must match /^[a-z_][a-z0-9_]*$/i${_RST}`)
      continue
    }
    const sql = migrateSqlTpl.replace(/{model}/g, model)
    const stmts = sql.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'))
    let ok = 0
    for (const stmt of stmts) {
      try {
        if (db.query) db.query(stmt).run()
        else          db.prepare(stmt).run()
        ok++
      } catch (e) {
        // ALTER TABLE ADD COLUMN IF NOT EXISTS is idempotent; index creation may warn on re-run
        if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) {
          console.error(`${_RED}  ✗ ${model}: ${e.message}${_RST}`)
        }
      }
    }
    console.log(`${_GREEN}✓${_RST}  ${model}: path + depth columns migrated (${ok} statements)`)
  }
  try { db.close() } catch (_) {}

  console.log('')
  console.log(`${_GREEN}arc-tree installed.${_RST} Next steps:`)
  console.log(`  1. Import CmsTreeTable in any list page: ${_CYAN}import CmsTreeTable from "@arc-tree/widgets/CmsTreeTable.arc"${_RST}`)
  console.log(`  2. Replace the inline table with: ${_CYAN}CmsTreeTable rows=treeRows entityUrl="/admin/pages" moveUrl="/admin/tree/pages"${_RST}`)
  console.log(`  3. Each row needs: id, parentId, depth, label (pre-compute label in your @server fn)`)
}

module.exports = { cmsInit, cmsCreateSuperuser, cmsEject, cmsAddTree }
