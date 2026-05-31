# Search route for the topbar command palette.
# Returns recent rows of each entity; the client filters by query.

@route @auth(admin,editor,viewer) GET "/admin/api/search" -> Response
  const pages = db.pages.findMany({ limit: 100 })
  const blocks = db.pageblocks.findMany({ limit: 200 })
  const users = db.users.findMany({ limit: 100 })
  const media = db.medias.findMany({ limit: 100 })
  json({ pages: pages, blocks: blocks, users: users, media: media })
