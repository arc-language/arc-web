// Group CRUD + membership routes for arc-cms

@group "/admin" @auth(admin)
  @route get "/groups" -> Response
    json({ rows: db.groups.findMany({ orderBy: { name: "asc" } }), total: db.groups.count() })

  @route post "/groups" -> Response
    const b = parseBody(request)
    if !b.name || !b.slug
      return json({ error: "name and slug are required" }, 400)
    const group = db.groups.create({ name: b.name, slug: b.slug, description: b.description || "" })
    json(group, 201)

  @route get "/groups/:id" -> Response
    const group = db.groups.find(params.id)
    match group
      None -> json({ error: "Not found" }, 404)
      Some(g) ->
        const members = db.groupmembers.findMany({ where: { groupId: g.id }, include: { user: true } })
        json({ group: g, members })

  @route patch "/groups/:id" -> Response
    const b = parseBody(request)
    const allowed = {}
    if b.name        allowed.name        = b.name
    if b.slug        allowed.slug        = b.slug
    if b.description allowed.description = b.description
    db.groups.update(params.id, allowed)
    json({ ok: true })

  @route delete "/groups/:id" -> Response
    db.groupmembers.deleteMany({ where: { groupId: params.id } })
    db.groups.delete(params.id)
    json({ ok: true })

  @route post "/groups/:id/members" -> Response
    const b = parseBody(request)
    if !b.userId return json({ error: "userId required" }, 400)
    const existing = db.groupmembers.findFirst({ where: { groupId: params.id, userId: b.userId } })
    if existing return json({ error: "Already a member" }, 409)
    db.groupmembers.create({ groupId: params.id, userId: b.userId })
    json({ ok: true })

  @route delete "/groups/:id/members/:userId" -> Response
    db.groupmembers.deleteMany({ where: { groupId: params.id, userId: params.userId } })
    json({ ok: true })
