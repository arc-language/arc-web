// Auth routes for arc-cms admin panel
// POST /admin/login  — email/password login
// GET  /admin/check-auth — session probe (used by CmsLayout client-side check)
// POST /admin/logout

// Login rate limit: 5 attempts per IP per 15 minutes
const _loginAttempts = new Map()
fn _checkLoginLimit(ip: String) -> Bool
  const now = Date.now()
  const window = 15 * 60 * 1000
  const entry = _loginAttempts.get(ip)
  if !entry || now > entry.resetAt
    _loginAttempts.set(ip, { count: 1, resetAt: now + window })
    return false
  entry.count += 1
  if entry.count > 5
    return true
  return false

@route post "/admin/login" -> Response
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown"
  if _checkLoginLimit(ip)
    return json({ error: "Too many login attempts. Try again in 15 minutes." }, 429)
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
