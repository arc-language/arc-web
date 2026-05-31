// Page and block management routes for arc-cms

@group "/admin" @auth(admin)
  @route get "/pages" -> Response
    const sf = params.status ?? "all"
    const sq = params.q ?? ""
    const sb = params.sort ?? "updatedAt"

    const where = {}
    if sf == "published" where.published = true
    if sf == "draft"     where.published = false

    const orderBy = sb == "title"    ? { title: "asc" }
                  : sb == "slug"     ? { slug: "asc" }
                  : sb == "navOrder" ? { navOrder: "asc" }
                  : { updatedAt: "desc" }

    const rows = db.pages.findMany({ where, orderBy })

    const allForLookup = db.pages.findMany({ orderBy: { id: "asc" } })
    const byId = {}
    for p in allForLookup
      byId[p.id] = p

    const filtered = sq != ""
      ? rows.filter(p => p.title.toLowerCase().includes(sq.toLowerCase()) || p.slug.includes(sq.toLowerCase()))
      : rows

    const withCounts = filtered.map(p =>
      const blockCount = db.pageblocks.count({ where: { page: p.slug } })
      const visibleCount = db.pageblocks.count({ where: { page: p.slug, visible: true } })
      const parent = p.parentId ? byId[p.parentId] : null
      const fullPath = parent ? "/p/" + parent.slug + "/" + p.slug : "/p/" + p.slug
      const parentTitle = parent ? parent.title : null
      { ...p, blockCount, visibleCount, fullPath, parentTitle }
    )
    json({ rows: withCounts, total: db.pages.count() })

  @route patch "/pages/:id/publish" -> Response
    const b = parseBody(request)
    if b.published === undefined return json({ error: "published field required" }, 400)
    db.pages.update(params.id, { published: b.published, updatedAt: now() })
    db.auditlogs.create({ actorId: session.userId, action: "update", entityType: "Page", entityId: params.id, after: JSON.stringify({ published: b.published }) })
    json({ ok: true })

  @route delete "/pages/:id" -> Response
    const pg = db.pages.find(params.id)
    if !pg return json({ error: "Not found" }, 404)
    const children = db.pages.findMany({ where: { parentId: pg.id } })
    for child in children
      db.pages.update(child.id, { parentId: pg.parentId })
    db.pages.delete(params.id)
    db.auditlogs.create({ actorId: session.userId, action: "delete", entityType: "Page", entityId: params.id })
    json({ ok: true })

  @route post "/pages/:id/duplicate" -> Response
    const pg = db.pages.find(params.id)
    if !pg return json({ error: "Not found" }, 404)
    const baseSlug = pg.slug + "-copy"
    const existing = db.pages.findFirst({ where: { slug: baseSlug } })
    const newSlug = existing ? baseSlug + "-" + String(Date.now()) : baseSlug
    const newPage = db.pages.create({
      title: pg.title + " (copy)",
      slug: newSlug,
      metaDescription: pg.metaDescription,
      ogImage: pg.ogImage,
      layout: pg.layout,
      themeId: pg.themeId,
      parentId: pg.parentId,
      navLabel: pg.navLabel,
      navOrder: pg.navOrder,
      showInNav: pg.showInNav,
      published: false
    })
    db.auditlogs.create({ actorId: session.userId, action: "create", entityType: "Page", entityId: String(newPage.id) })
    json(newPage, 201)

  @route get "/pages/:slug/blocks" -> Response
    const blocks = db.pageblocks.findMany({
      where: { page: params.slug },
      orderBy: { order: "asc" }
    })
    json({ blocks })

  @route post "/pages/:slug/blocks" -> Response
    const b = parseBody(request)
    if !b.type return json({ error: "type is required" }, 400)
    const count = db.pageblocks.count({ where: { page: params.slug } })
    const block = db.pageblocks.create({
      page: params.slug,
      type: b.type,
      data: JSON.stringify(b.data || {}),
      order: count,
      visible: b.visible !== false
    })
    db.auditlogs.create({ actorId: session.userId, action: "create", entityType: "Block", entityId: String(block.id) })
    json(block, 201)

  @route patch "/blocks/:id" -> Response
    const b = parseBody(request)
    const allowed = {}
    if b.data    !== undefined allowed.data    = JSON.stringify(b.data)
    if b.visible !== undefined allowed.visible = b.visible
    if b.order   !== undefined allowed.order   = b.order
    db.pageblocks.update(params.id, allowed)
    db.auditlogs.create({ actorId: session.userId, action: "update", entityType: "Block", entityId: params.id })
    json({ ok: true })

  @route delete "/blocks/:id" -> Response
    const block = db.pageblocks.find(params.id)
    match block
      None -> json({ error: "Not found" }, 404)
      Some(bl) ->
        db.pageblocks.delete(params.id)
        db.auditlogs.create({ actorId: session.userId, action: "delete", entityType: "Block", entityId: params.id })
        json({ ok: true })

  @route post "/blocks/reorder" -> Response
    const b = parseBody(request)
    if !b.ids || !Array.isArray(b.ids)
      return json({ error: "ids array required" }, 400)
    for i, id in b.ids
      db.pageblocks.update(id, { order: i })
    json({ ok: true })
