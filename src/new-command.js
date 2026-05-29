'use strict'

const fs = require('fs')
const path = require('path')
const { execSync, spawn } = require('child_process')
const readline = require('readline')
const { RED, GREEN, CYAN, DIM, RESET } = require('./utils/errors')

// ── Validation ─────────────────────────────────────────────────────────────

const VALID_TEMPLATES = ['default', 'counter', 'blog', 'api', 'cms']

function validateName(name) {
  if (!name || name.trim().length === 0) return 'Project name cannot be empty'
  if (/\s/.test(name)) return 'Project name cannot contain spaces'
  if (name.startsWith('.') || name.startsWith('-')) return 'Project name cannot start with . or -'
  if (name.length > 214) return 'Project name is too long'
  const sanitized = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
  if (!sanitized) return 'Project name contains no valid characters (a-z, 0-9, hyphens)'
  return null
}

// ── Package manager detection ───────────────────────────────────────────────

function detectAvailablePMs() {
  const found = []
  for (const pm of ['bun', 'pnpm', 'yarn', 'npm']) {
    try { execSync(`${pm} --version`, { stdio: 'ignore' }); found.push(pm) } catch {}
  }
  return found.length > 0 ? found : ['npm']
}

function detectPackageManager() {
  return detectAvailablePMs()[0]
}

const ALLOWED_PMS = new Set(['bun', 'npm', 'pnpm', 'yarn'])

async function installDeps(dir, pm) {
  if (!ALLOWED_PMS.has(pm)) throw new Error(`Unknown package manager: "${pm}". Use bun, npm, pnpm, or yarn.`)
  return new Promise((resolve, reject) => {
    const child = spawn(pm, ['install'], { cwd: dir, stdio: 'inherit' })
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${pm} install failed`)))
    child.on('error', reject)
  })
}

// ── Lazy template factory ──────────────────────────────────────────────────
// Only the selected template is instantiated - O(1) space for unchosen templates.

function getTemplate(name, template, pm = 'bun') {
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  const TEMPLATE_MAP = {
    default: () => ({
      'index.arc': `page "${name}"
  heading "Welcome to ${name}"
  text "Edit index.arc to get started."

  design
    body
      font: system-ui, sans-serif
      m: 0
      p: 32px
    h1
      fg: #111827
      size: 2rem
`,
      'package.json': JSON.stringify({
        name: safeName,
        version: '0.0.1',
        private: true,
        scripts: {
          build: 'arc build .',
          dev: 'arc dev .',
          check: 'arc check index.arc',
        },
      }, null, 2) + '\n',
      '.gitignore': 'dist/\nnode_modules/\n',
    }),

    counter: () => ({
      'index.arc': `page "Counter"
  @state let count = 0

  col gap="24px" align="center"
    heading "Counter"
    text class="count" "{count}"
    row gap="12px"
      button on:click={ count -= 1 } "−"
      button on:click={ count += 1 } "+"
      button on:click={ count = 0 } "Reset"

  design
    body
      font: system-ui, sans-serif
      display: flex
      align-items: center
      justify-content: center
      min-h: 100vh
      m: 0
      bg: #f9fafb
    .count
      size: 4rem
      weight: 700
      fg: #111
      text-align: center
    button
      p: 10px 24px
      bg: #111
      fg: white
      border: none
      radius: 8px
      size: 1rem
      cursor: pointer
`,
      'package.json': JSON.stringify({
        name: safeName,
        version: '0.0.1',
        private: true,
        scripts: {
          build: 'arc build .',
          dev: 'arc dev .',
        },
      }, null, 2) + '\n',
      '.gitignore': 'dist/\nnode_modules/\n',
    }),

    blog: () => ({
      'index.arc': `page "My Blog"
  @build const posts = [
    { title: "Hello, Arc!", date: "2026-01-01", body: "My first Arc post." },
    { title: "Zero JS", date: "2026-01-15", body: "This page has no JavaScript." }
  ]

  col gap="32px"
    heading "My Blog"
    for post in posts
      card
        heading size=2 "{post.title}"
        text class="date" "{post.date}"
        text "{post.body}"

  design
    body
      font: system-ui, sans-serif
      max-w: 640px
      m: 0 auto
      p: 32px 16px
    .date
      fg: #6b7280
      size: 14px
`,
      'package.json': JSON.stringify({
        name: safeName,
        version: '0.0.1',
        private: true,
        scripts: {
          build: 'arc build .',
          dev: 'arc dev .',
        },
      }, null, 2) + '\n',
      '.gitignore': 'dist/\nnode_modules/\n',
    }),

    api: () => ({
      'server/schemas/post.arc': `model Post
  @id let id = autoincrement()
  let title: String
  let body: String
  let published: Bool = false
  let createdAt: DateTime = now()
`,
      'server/routes/posts.arc': `@route get "/posts" -> Response
  json(db.posts.findMany())

@route get "/posts/:id" -> Response
  const post = db.posts.find(params.id)
  match post
    None    -> json({ error: "not found" }, 404)
    Some(p) -> json(p)

@route post "/posts" -> Response
  const body = parseBody(request)
  const post = db.posts.create(body)
  NotifySubscribers(post.id)
  json(post, 201)

@route del "/posts/:id" -> Response
  db.posts.delete(params.id)
  json({ ok: true })

@route get "/health" -> Response
  json({ status: "ok" })
`,
      'server/jobs/notify.arc': `job NotifySubscribers(postId: Int)
  console.log("notifying subscribers for post", postId)
  email.send({ to: "subscribers@example.com", subject: "New post", text: "A new post was published" })
`,
      'package.json': JSON.stringify({
        name: safeName,
        version: '0.0.1',
        private: true,
        scripts: {
          dev: 'arc serve .',
          build: 'arc build-server .',
          migrate: 'arc db migrate .',
          start: pm === 'bun' ? 'bun dist/server.js' : 'node dist/server.js',
        },
      }, null, 2) + '\n',
      'README.md': `# ${name}

A backend API built with [Arc](https://arc-lang.dev).

## Getting started

\`\`\`bash
arc db migrate   # create the database tables
arc serve .      # start the server on http://localhost:3000
\`\`\`

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | /posts | List all posts |
| GET | /posts/:id | Get a post by id |
| POST | /posts | Create a post |
| DELETE | /posts/:id | Delete a post |
| GET | /health | Health check |
`,
      '.gitignore': 'dist/\nnode_modules/\napp.db\n',
    }),

    cms: () => ({
      'server/schemas/user.arc': `model User
  @id let id          = autoincrement()
  @unique let email   : String
  let name            : String?
  let avatarUrl       : String?
  let oauthProvider   : String
  let oauthId         : String
  let role            : String = "editor"
  let createdAt       : DateTime = now()
`,
      'server/routes/auth.arc': `@route get "/auth/github" -> Response
  redirect(oauth.github.authUrl())

@route get "/auth/github/callback" -> Response
  const profile = oauth.github.exchange(params.code)
  const existing = db.users.findWhere({ email: profile.email })
  const isFirst = db.users.count() == 0
  const role = isFirst || profile.email == env("ADMIN_EMAIL") ? "admin" : "editor"
  const user = match existing
    None    -> db.users.create({ email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl, oauthProvider: "github", oauthId: profile.id, role })
    Some(u) -> u
  session.set("userId", user.id)
  redirect("/admin")

@route get "/auth/google" -> Response
  redirect(oauth.google.authUrl())

@route get "/auth/google/callback" -> Response
  const profile = oauth.google.exchange(params.code)
  const existing = db.users.findWhere({ email: profile.email })
  const isFirst = db.users.count() == 0
  const role = isFirst || profile.email == env("ADMIN_EMAIL") ? "admin" : "editor"
  const user = match existing
    None    -> db.users.create({ email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl, oauthProvider: "google", oauthId: profile.id, role })
    Some(u) -> u
  session.set("userId", user.id)
  redirect("/admin")

@route get "/auth/logout" -> Response
  session.clear()
  redirect("/admin/login")
`,
      'server/admin/routes/users.arc': `@route @auth(admin) get "/admin/users" -> Response
  const limit = +(params.limit ?? 20)
  const offset = +(params.offset ?? 0)
  json({ users: db.users.findMany({ limit, offset }), total: db.users.count() })

@route @auth(admin) get "/admin/users/:id" -> Response
  const item = db.users.find(params.id)
  match item
    None    -> json({ error: "not found" }, 404)
    Some(x) -> json(x)

@route @auth(admin) patch "/admin/users/:id" -> Response
  const body = parseBody(request)
  json(db.users.update(params.id, body))

@route @auth(admin) del "/admin/users/:id" -> Response
  db.users.delete(params.id)
  json({ ok: true })
`,
      'server/seed.arc': `# First admin is bootstrapped via OAuth — no seed needed
# Uncomment to create a test user for local dev:
# db.users.create({ email: "dev@example.com", name: "Dev User", oauthProvider: "dev", oauthId: "1", role: "admin" })
`,
      'admin/login.arc': `page "Sign In — Admin"

  col class="login-page" align="center" justify="center"
    col class="login-card" gap="28px" align="stretch"
      col gap="6px" align="center"
        text class="login-logo" "◈"
        text class="login-title" "Admin"
        text class="login-sub" "Sign in to continue"

      col gap="10px"
        link href="/auth/github"
          button class="btn-github" "Sign in with GitHub"
        link href="/auth/google"
          button class="btn-google" "Sign in with Google"

  design
    :root
      --bg: #ffffff
      --bg-2: #f5f5f5
      --bg-3: #efefef
      --fg: #0a0a0a
      --fg-2: #525252
      --fg-3: #a3a3a3
      --border: #e5e5e5
      --invert-bg: #0a0a0a
      --invert-fg: #ffffff
      @dark
        --bg: #0d0d0d
        --bg-2: #161616
        --bg-3: #1f1f1f
        --fg: #f0f0f0
        --fg-2: rgba(255,255,255,0.55)
        --fg-3: rgba(255,255,255,0.28)
        --border: rgba(255,255,255,0.08)
        --invert-bg: #ffffff
        --invert-fg: #0a0a0a
    body
      background-color: var(--bg)
      color: var(--fg)
      font: system-ui, -apple-system, sans-serif
      m: 0
    .login-page
      min-height: 100vh
      background-color: var(--bg)
    .login-card
      w: 340px
      background-color: var(--bg-2)
      border: 1px solid var(--border)
      radius: 18px
      p: 36px 32px
      box-shadow: 0 2px 12px rgba(0,0,0,0.06)
      @dark
        box-shadow: 0 2px 12px rgba(0,0,0,0.45)
    .login-logo
      size: 28px
      weight: 700
      color: var(--fg)
    .login-title
      size: 20px
      weight: 700
      letter-spacing: -0.02em
      color: var(--fg)
    .login-sub
      size: 14px
      color: var(--fg-3)
    .btn-github
      w: 100%
      p: 12px 20px
      background-color: var(--invert-bg)
      color: var(--invert-fg)
      border: none
      radius: 10px
      size: 14px
      weight: 600
      cursor: pointer
      text-align: center
    .btn-google
      w: 100%
      p: 12px 20px
      background-color: var(--bg-3)
      color: var(--fg)
      border: 1px solid var(--border)
      radius: 10px
      size: 14px
      weight: 500
      cursor: pointer
      text-align: center
    .btn-google:hover
      background-color: var(--bg-3)
      border-color: var(--fg-3)
`,
      'admin/index.arc': `page "Dashboard — Admin"

  @server fn getDashboardStats() -> Any
    return { users: db.users.count() }

  @live const stats = getDashboardStats()

  row class="app-layout"
    col class="sidebar"
      col class="sidebar-header"
        text class="logo-mark" "◈"
        text class="logo-text" "Admin"
      col class="sidebar-nav"
        link href="/admin" class="nav-item nav-active" "Dashboard"
        link href="/admin/users" class="nav-item" "Users"
        link href="/admin/blocks" class="nav-item" "Blocks"
      col class="sidebar-footer"
        link href="/auth/logout" class="nav-signout" "Sign out"

    col class="main-area"
      row class="topbar" align="center" p="0 24px"
        text class="page-title" "Dashboard"

      col class="page-content" p="24px" gap="24px"
        row gap="16px"
          col class="stat-card"
            text class="stat-value" "{stats.users}"
            text class="stat-label" "Users"

        text class="hint" "Use arc scaffold <Model> to generate admin pages for your models."

  design
    :root
      --bg: #ffffff
      --bg-2: #f5f5f5
      --bg-3: #efefef
      --fg: #0a0a0a
      --fg-2: #525252
      --fg-3: #a3a3a3
      --border: #e5e5e5
      --invert-bg: #0a0a0a
      --invert-fg: #ffffff
      @dark
        --bg: #0d0d0d
        --bg-2: #161616
        --bg-3: #1f1f1f
        --fg: #f0f0f0
        --fg-2: rgba(255,255,255,0.55)
        --fg-3: rgba(255,255,255,0.28)
        --border: rgba(255,255,255,0.08)
        --invert-bg: #ffffff
        --invert-fg: #0a0a0a
    body
      background-color: var(--bg)
      color: var(--fg)
      font: system-ui, -apple-system, sans-serif
      m: 0
      size: 14px
    .app-layout
      height: 100vh
      background-color: var(--bg)
    .sidebar
      width: 220px
      background-color: var(--bg-2)
      border-right: 1px solid var(--border)
      display: flex
      flex-direction: column
      flex-shrink: 0
    .sidebar-header
      display: flex
      flex-direction: row
      align-items: center
      gap: 10px
      p: 20px 16px 16px
      border-bottom: 1px solid var(--border)
    .logo-mark
      size: 18px
      weight: 700
      color: var(--fg)
    .logo-text
      size: 14px
      weight: 700
      letter-spacing: -0.01em
      color: var(--fg)
    .sidebar-nav
      display: flex
      flex-direction: column
      gap: 2px
      p: 12px 8px
      flex: 1
    .nav-item
      display: block
      p: 8px 12px
      radius: 8px
      size: 13px
      weight: 500
      color: var(--fg-2)
      text-decoration: none
      transition: all 0.1s
    .nav-item:hover
      background-color: var(--bg-3)
      color: var(--fg)
    .nav-active
      background-color: var(--bg-3)
      color: var(--fg)
      weight: 600
    .sidebar-footer
      p: 12px 8px 16px
      border-top: 1px solid var(--border)
    .nav-signout
      display: block
      p: 7px 12px
      size: 12px
      color: var(--fg-3)
      text-decoration: none
      radius: 7px
    .nav-signout:hover
      color: var(--fg-2)
      background-color: var(--bg-3)
    .main-area
      flex: 1
      display: flex
      flex-direction: column
      overflow: auto
    .topbar
      height: 52px
      background-color: var(--bg-2)
      border-bottom: 1px solid var(--border)
      flex-shrink: 0
    .page-title
      size: 15px
      weight: 600
      letter-spacing: -0.01em
    .page-content
      flex: 1
    .stat-card
      p: 20px 24px
      background-color: var(--bg-2)
      border: 1px solid var(--border)
      radius: 14px
      min-w: 140px
      box-shadow: 0 1px 3px rgba(0,0,0,0.04)
    .stat-value
      size: 28px
      weight: 700
      letter-spacing: -0.02em
      color: var(--fg)
    .stat-label
      size: 11px
      weight: 600
      text-transform: uppercase
      letter-spacing: 0.07em
      color: var(--fg-3)
      mt: 4px
    .hint
      size: 13px
      color: var(--fg-3)
`,
      'admin/users.arc': `page "Users — Admin"

  @server fn listUsers() -> Any
    return { items: db.users.findMany({ limit: 50 }), total: db.users.count() }

  @live const data = listUsers()

  row class="app-layout"
    col class="sidebar"
      col class="sidebar-header"
        text class="logo-mark" "◈"
        text class="logo-text" "Admin"
      col class="sidebar-nav"
        link href="/admin" class="nav-item" "Dashboard"
        link href="/admin/users" class="nav-item nav-active" "Users"
        link href="/admin/blocks" class="nav-item" "Blocks"
      col class="sidebar-footer"
        link href="/auth/logout" class="nav-signout" "Sign out"

    col class="main-area"
      row class="topbar" justify="space-between" align="center" p="0 24px"
        text class="page-title" "Users"

      col class="page-content" p="24px"
        col class="card"
          table class="data-table"
            thead
              tr
                th "ID"
                th "Email"
                th "Name"
                th "Role"
                th ""
            for item in data.items
              tr class="data-row"
                td class="cell-mono" "#{item.id}"
                td "{item.email}"
                td "{item.name}"
                td class="cell-role" "{item.role}"
                td class="cell-actions"
                  link href="/admin/users/{item.id}/edit"
                    button class="btn-ghost" "Edit"

  design
    :root
      --bg: #ffffff
      --bg-2: #f5f5f5
      --bg-3: #efefef
      --fg: #0a0a0a
      --fg-2: #525252
      --fg-3: #a3a3a3
      --border: #e5e5e5
      --invert-bg: #0a0a0a
      --invert-fg: #ffffff
      @dark
        --bg: #0d0d0d
        --bg-2: #161616
        --bg-3: #1f1f1f
        --fg: #f0f0f0
        --fg-2: rgba(255,255,255,0.55)
        --fg-3: rgba(255,255,255,0.28)
        --border: rgba(255,255,255,0.08)
        --invert-bg: #ffffff
        --invert-fg: #0a0a0a
    body
      background-color: var(--bg)
      color: var(--fg)
      font: system-ui, -apple-system, sans-serif
      m: 0
      size: 14px
    .app-layout
      height: 100vh
      background-color: var(--bg)
    .sidebar
      width: 220px
      background-color: var(--bg-2)
      border-right: 1px solid var(--border)
      display: flex
      flex-direction: column
      flex-shrink: 0
    .sidebar-header
      display: flex
      flex-direction: row
      align-items: center
      gap: 10px
      p: 20px 16px 16px
      border-bottom: 1px solid var(--border)
    .logo-mark
      size: 18px
      weight: 700
    .logo-text
      size: 14px
      weight: 700
      letter-spacing: -0.01em
    .sidebar-nav
      display: flex
      flex-direction: column
      gap: 2px
      p: 12px 8px
      flex: 1
    .nav-item
      display: block
      p: 8px 12px
      radius: 8px
      size: 13px
      weight: 500
      color: var(--fg-2)
      text-decoration: none
      transition: all 0.1s
    .nav-item:hover
      background-color: var(--bg-3)
      color: var(--fg)
    .nav-active
      background-color: var(--bg-3)
      color: var(--fg)
      weight: 600
    .sidebar-footer
      p: 12px 8px 16px
      border-top: 1px solid var(--border)
    .nav-signout
      display: block
      p: 7px 12px
      size: 12px
      color: var(--fg-3)
      text-decoration: none
      radius: 7px
    .nav-signout:hover
      color: var(--fg-2)
      background-color: var(--bg-3)
    .main-area
      flex: 1
      display: flex
      flex-direction: column
      overflow: auto
    .topbar
      height: 52px
      background-color: var(--bg-2)
      border-bottom: 1px solid var(--border)
      flex-shrink: 0
    .page-title
      size: 15px
      weight: 600
      letter-spacing: -0.01em
    .page-content
      flex: 1
    .card
      background-color: var(--bg-2)
      border: 1px solid var(--border)
      radius: 14px
      overflow: hidden
      box-shadow: 0 1px 3px rgba(0,0,0,0.05)
      @dark
        box-shadow: 0 1px 3px rgba(0,0,0,0.35)
    .data-table
      w: 100%
      border-collapse: collapse
    thead th
      p: 10px 16px
      size: 11px
      weight: 600
      text-transform: uppercase
      letter-spacing: 0.07em
      color: var(--fg-3)
      text-align: left
      border-bottom: 1px solid var(--border)
    .data-row
      border-bottom: 1px solid var(--border)
      transition: background-color 0.1s
    .data-row:last-child
      border-bottom: none
    .data-row:hover
      background-color: var(--bg-3)
    td
      p: 11px 16px
      color: var(--fg)
    .cell-mono
      color: var(--fg-3)
      size: 12px
      font-family: ui-monospace, "SF Mono", monospace
    .cell-role
      size: 12px
      color: var(--fg-2)
      text-transform: capitalize
    .cell-actions
      text-align: right
    .btn-ghost
      p: 5px 11px
      background-color: transparent
      color: var(--fg-2)
      border: 1px solid var(--border)
      radius: 7px
      size: 12px
      weight: 500
      cursor: pointer
    .btn-ghost:hover
      background-color: var(--bg-3)
      color: var(--fg)
`,
      'server/schemas/pageblock.arc': `model PageBlock
  @id let id       = autoincrement()
  let page         : String
  let type         : String
  let order        : Int = 0
  let visible      : Bool = true
  let data         : String = "{}"
  let updatedAt    : DateTime = now()

model DraftToken
  @id let id       = autoincrement()
  let token        : String
  let expiresAt    : DateTime
`,
      'server/admin/routes/blocks.arc': `# Block CRUD + draft token routes

@route @auth(admin,editor) get "/admin/blocks" -> Response
  const page = params.page ?? "home"
  json({ blocks: db.pageblocks.findMany({ where: { page }, orderBy: { order: "asc" } }) })

@route @auth(admin,editor) post "/admin/blocks" -> Response
  const body = parseBody(request)
  const maxOrder = db.pageblocks.count({ where: { page: body.page } })
  json(db.pageblocks.create({ ...body, order: maxOrder }), 201)

@route @auth(admin,editor) patch "/admin/blocks/:id" -> Response
  const body = parseBody(request)
  const block = db.pageblocks.find(params.id)
  match block
    None    -> json({ error: "not found" }, 404)
    Some(b) ->
      const merged = JSON.parse(b.data)
      for key, val in body.data
        merged[key] = val
      json(db.pageblocks.update(params.id, { data: JSON.stringify(merged), updatedAt: now() }))

@route @auth(admin,editor) patch "/admin/blocks/:id/reorder" -> Response
  const body = parseBody(request)
  const block = db.pageblocks.find(params.id)
  match block
    None    -> json({ error: "not found" }, 404)
    Some(b) ->
      const dir = body.direction
      const neighbor = dir == "up"
        ? db.pageblocks.findFirst({ where: { page: b.page, order: { lt: b.order } }, orderBy: { order: "desc" } })
        : db.pageblocks.findFirst({ where: { page: b.page, order: { gt: b.order } }, orderBy: { order: "asc" } })
      match neighbor
        None    -> json({ ok: false })
        Some(n) ->
          db.pageblocks.update(params.id, { order: n.order })
          db.pageblocks.update(n.id, { order: b.order })
          json({ ok: true })

@route @auth(admin) del "/admin/blocks/:id" -> Response
  db.pageblocks.delete(params.id)
  json({ ok: true })

@route @auth(admin,editor) get "/admin/api/block-types" -> Response
  json(loadBlockTypes())

@route @auth(admin,editor) post "/admin/api/draft-token" -> Response
  const raw = crypto.randomBytes(32).toString("hex")
  const expires = new Date(Date.now() + 8 * 3600 * 1000)
  db.drafttokens.create({ token: raw, expiresAt: expires })
  json({ token: raw })

@route get "/admin/api/draft" -> Response
  const token = params.token ?? ""
  const row = db.drafttokens.findFirst({ where: { token } })
  match row
    None    -> json({ valid: false })
    Some(t) -> json({ valid: new Date(t.expiresAt) > new Date() })

@route @auth(admin,editor) post "/admin/api/publish" -> Response
  json({ ok: true, publishedAt: now() })
`,
      'server/block-types.json': '{}',
      'arc.config.json': JSON.stringify({
        name: safeName,
        auth: {
          providers: ['github', 'google'],
          sessionSecret: require('crypto').randomBytes(32).toString('hex'),
        },
        db: { dialect: 'sqlite', url: 'app.db' },
      }, null, 2) + '\n',
      'package.json': JSON.stringify({
        name: safeName,
        version: '0.0.1',
        private: true,
        scripts: {
          dev: 'arc serve .',
          build: 'arc build-server . && arc build-site admin/',
          migrate: 'arc db migrate .',
          start: pm === 'bun' ? 'bun dist/server.js' : 'node dist/server.js',
        },
      }, null, 2) + '\n',
      '.gitignore': 'dist/\nnode_modules/\napp.db\narc.config.json\n',
    }),
  }

  const factory = TEMPLATE_MAP[template] ?? TEMPLATE_MAP.default
  return factory()
}

// ── Core project creator ───────────────────────────────────────────────────
// File writes are synchronous so callers without await still see files written.
// Returns a Promise only when opts.install is requested.

function newProject(name, template = 'default', opts = {}) {
  const nameErr = validateName(name)
  if (nameErr) throw new Error(nameErr)

  if (!VALID_TEMPLATES.includes(template)) {
    throw new Error(`Unknown template "${template}". Available: ${VALID_TEMPLATES.join(', ')}`)
  }

  const dir = path.resolve(name)
  if (fs.existsSync(dir)) {
    const existing = fs.readdirSync(dir)
    if (existing.length > 0) {
      throw new Error(`"${name}" already exists and is not empty`)
    }
  }

  const pm = opts.pm ?? 'npm'

  fs.mkdirSync(dir, { recursive: true })

  const files = getTemplate(name, template, pm)
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf8')
  }

  const templateLabel = template !== 'default' ? ` (${template})` : ''
  const count = Object.keys(files).length
  console.log(`\n  ${GREEN}✓${RESET}  Created ${name}/${templateLabel} — ${count} file${count !== 1 ? 's' : ''}`)
  console.log('')
  for (const f of Object.keys(files)) {
    console.log(`     ${DIM}${f}${RESET}`)
  }
  console.log('')

  if (opts.install) {
    console.log(`  Installing dependencies with ${pm}...`)
    console.log('')
    return installDeps(dir, pm).then(() => {
      console.log('')
      console.log('  Next steps:')
      console.log(`    ${CYAN}cd ${name}${RESET}`)
      console.log(`    ${CYAN}arc dev${RESET}`)
      console.log('')
    })
  }

  console.log('  Next steps:')
  console.log(`    ${CYAN}cd ${name}${RESET}`)
  console.log(`    ${CYAN}${pm} install${RESET}`)
  console.log(`    ${CYAN}arc dev${RESET}`)
  console.log('')
}

// ── Interactive wizard ─────────────────────────────────────────────────────

async function promptText(label, defaultVal = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const hint = defaultVal ? ` ${DIM}(${defaultVal})${RESET}` : ''
  return new Promise(resolve => {
    let answered = false
    rl.question(`\n${CYAN}◆${RESET} ${label}${hint}: `, answer => {
      answered = true
      rl.close()
      resolve(answer.trim() || defaultVal)
    })
    rl.on('close', () => { if (!answered) resolve(defaultVal) })
  })
}

async function promptSelect(label, options) {
  if (!process.stdin.isTTY) return options[0].value

  let idx = 0

  const renderOptions = () => {
    process.stdout.write(`[${options.length}A`)
    for (let i = 0; i < options.length; i++) {
      const bullet = i === idx ? `${CYAN}●${RESET}` : `${DIM}○${RESET}`
      process.stdout.write(`[2K\r  ${bullet} ${options[i].label}\n`)
    }
  }

  process.stdout.write(`\n${CYAN}◆${RESET} ${label}\n`)
  for (let i = 0; i < options.length; i++) {
    const bullet = i === idx ? `${CYAN}●${RESET}` : `${DIM}○${RESET}`
    process.stdout.write(`  ${bullet} ${options[i].label}\n`)
  }

  return new Promise(resolve => {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    const cleanup = (val) => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
      process.stdin.removeListener('end', onEnd)
      resolve(val)
    }

    const onEnd = () => cleanup(options[idx].value)

    const onData = (key) => {
      if (key === '[A' && idx > 0) { idx--; renderOptions() }
      else if (key === '[B' && idx < options.length - 1) { idx++; renderOptions() }
      else if (key === '\r') {
        process.stdout.write('\n')
        cleanup(options[idx].value)
      }
      else if (key === '') process.exit(0)
    }

    process.stdin.on('data', onData)
    process.stdin.on('end', onEnd)
  })
}

async function runWizard(presets = {}) {
  const pkg = require('../package.json')
  console.log(`\n  ${CYAN}Arc${RESET}  create-arc-web v${pkg.version}\n`)

  // Step 1: project name
  let name = presets.name
  if (!name) {
    name = await promptText('Project name', 'my-app')
    let nameErr = validateName(name)
    while (nameErr) {
      console.error(`  ${RED}✗${RESET} ${nameErr}`)
      name = await promptText('Project name', 'my-app')
      nameErr = validateName(name)
    }
  }

  // Step 2: template
  let template = presets.template
  if (!template) {
    template = await promptSelect('Template', [
      { label: 'Static site', value: 'default' },
      { label: 'Interactive counter  (@state)', value: 'counter' },
      { label: 'Blog  (@build data, zero JS)', value: 'blog' },
      { label: 'Full-stack API  (@server + db)', value: 'api' },
      { label: 'CMS + auth  (@live + OAuth)', value: 'cms' },
    ])
  }

  // Step 3: package manager - detected one floats to the top
  let pm = presets.pm
  if (!pm) {
    const available = detectAvailablePMs()
    const all = ['bun', 'npm', 'pnpm', 'yarn']
    const ordered = [...new Set([...available, ...all])]
    const pmOptions = ordered.map(p => ({
      label: available.includes(p) ? p : `${p}  ${DIM}(not installed)${RESET}`,
      value: p,
    }))
    pm = await promptSelect('Package manager', pmOptions)
  }

  // Step 4: install?
  let doInstall = presets.install
  if (doInstall === undefined) {
    doInstall = await promptSelect('Install dependencies now?', [
      { label: `Yes — run ${pm} install`, value: true },
      { label: 'No — I\'ll install later', value: false },
    ])
  }

  await newProject(name, template, { pm, install: doInstall })
}

module.exports = { newProject, detectPackageManager, detectAvailablePMs, validateName, getTemplate, runWizard }
