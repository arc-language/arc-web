// Auth routes for arc-cms admin panel
// POST /admin/login  — email/password login
// GET  /admin/check-auth — session probe (used by CmsLayout client-side check)
// POST /admin/logout

@route post "/admin/login" -> Response
  const b = parseBody(request)
  if !b.email || !b.password
    return json({ error: "Email and password required" }, 400)
  const u = db.users.findFirst({ where: { email: b.email } })
  if !u return json({ error: "Invalid credentials" }, 401)
  const parts = u.passwordHash.split(":")
  if parts.length < 2 return json({ error: "Invalid credentials" }, 401)
  const salt = parts[0]
  const stored = parts[1]
  let hash
  try
    hash = crypto.scryptSync(b.password, salt, 64).toString("hex")
  catch _
    return json({ error: "Invalid credentials" }, 401)
  const hashBuf   = Buffer.from(hash, "hex")
  const storedBuf = Buffer.from(stored, "hex")
  if hashBuf.length != storedBuf.length || !crypto.timingSafeEqual(hashBuf, storedBuf)
    return json({ error: "Invalid credentials" }, 401)
      const res = redirect("/admin")
      auth.set(res, { userId: u.id, role: u.role, name: u.name })

@route get "/admin/check-auth" -> Response
  const s = auth.session(request)
  if !s return json({ error: "Unauthorized" }, 401)
  json({ ok: true, role: s.role, userId: s.userId })

@route post "/admin/logout" -> Response
  const res = redirect("/admin/login")
  auth.clear(res)
