@route get "/posts" -> Response
  json(db.posts.findMany())

@route get "/posts/:id" -> Response
  const post = db.posts.find(params.id)
  match post
    None -> json({ error: "not found" }, 404)
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
  json({ status: "ok", uptime: process.uptime() })
