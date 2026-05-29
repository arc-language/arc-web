// User CRUD routes for arc-cms
// All routes protected by @group "/admin" @auth(admin)

@group "/admin" @auth(admin)
  @route get "/users" -> Response
    const rows = db.users.findMany({ orderBy: { createdAt: "desc" }, limit: 100 })
    json({ rows, total: db.users.count() })

  @route post "/users" -> Response
    const b = parseBody(request)
    if !b.email || !b.name
      return json({ error: "name and email are required" }, 400)
    const existing = db.users.findFirst({ where: { email: b.email } })
    if existing
      return json({ error: "Email already in use" }, 409)
    const salt = crypto.randomBytes(16).toString("hex")
    const hash = crypto.scryptSync(b.password || crypto.randomBytes(16).toString("hex"), salt, 64).toString("hex")
    const user = db.users.create({
      name: b.name,
      email: b.email,
      role: b.role || "editor",
      passwordHash: salt + ":" + hash
    })
    json(user, 201)

  @route get "/users/:id" -> Response
    const user = db.users.find(params.id)
    match user
      None -> json({ error: "Not found" }, 404)
      Some(u) -> json(u)

  @route patch "/users/:id" -> Response
    const b = parseBody(request)
    const allowed = {}
    if b.name   allowed.name  = b.name
    if b.email  allowed.email = b.email
    if b.role   allowed.role  = b.role
    if b.password && b.password.length > 0
      const salt = crypto.randomBytes(16).toString("hex")
      const hash = crypto.scryptSync(b.password, salt, 64).toString("hex")
      allowed.passwordHash = salt + ":" + hash
    db.users.update(params.id, allowed)
    db.auditlogs.create({ actorId: session.userId, action: "update", entityType: "User", entityId: params.id })
    json({ ok: true })

  @route delete "/users/:id" -> Response
    if params.id == session.userId
      return json({ error: "Cannot delete your own account" }, 400)
    db.users.delete(params.id)
    db.auditlogs.create({ actorId: session.userId, action: "delete", entityType: "User", entityId: params.id })
    json({ ok: true })
