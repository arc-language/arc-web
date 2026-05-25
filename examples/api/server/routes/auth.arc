@route get "/auth/github" -> Response
  redirect(oauth.github.url())

@route get "/auth/github/callback" -> Response
  const result = oauth.github.callback(request)
  match result
    None ->
      redirect("/login?error=oauth_failed")
    Some(r) ->
      const response = redirect("/posts")
      auth.set(response, { userId: r.user.id, login: r.user.login })

@route post "/auth/logout" -> Response
  const response = json({ ok: true })
  auth.clear(response)

@route get "/auth/me" -> Response
  const sess = auth.session(request)
  match sess
    None    -> json({ error: "not logged in" }, 401)
    Some(s) -> json(s)

@route @auth get "/auth/profile" -> Response
  json({ session: session, ok: true })
