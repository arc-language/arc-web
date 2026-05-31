# Auth routes for arc-cms admin panel.
# POST /admin/login    - email + password login
# GET  /admin/check-auth - session probe used by CmsLayout client-side check
# POST /admin/logout    - clear session and redirect

@route POST "/admin/login" -> Response
  const body = parseBody(request)
  const email = body.email ?? ""
  const password = body.password ?? ""
  if email == "" || password == ""
    return json({ error: "Email and password required" }, 400)
  const found = db.users.findFirst({ where: { email: email } })
  match found
    None -> json({ error: "Invalid credentials" }, 401)
    Some(u) ->
      const ph = u.passwordHash ?? ""
      if ph == ""
        return json({ error: "Password login not configured for this account" }, 401)
      const parts = ph.split(":")
      if parts.length < 2
        return json({ error: "Invalid credentials" }, 401)
      const salt = parts[0]
      const stored = parts[1]
      const hash = crypto.scryptSync(password, salt, 64).toString("hex")
      if hash != stored
        return json({ error: "Invalid credentials" }, 401)
      return auth.set(redirect("/admin"), { userId: u.id, role: u.role, name: u.name })

@route @auth(admin,editor,viewer) GET "/admin/check-auth" -> Response
  const sess = auth.session(request)
  match sess
    None -> json({ error: "Unauthorized" }, 401)
    Some(s) -> json({ "ok": true, "role": s.role, "userId": s.userId })

@route POST "/admin/logout" -> Response
  auth.clear(redirect("/admin/login"))
