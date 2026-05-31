# Recent audit entries for the notification bell.

@route @auth(admin,editor,viewer) GET "/admin/api/notifications" -> Response
  const entries = db.auditlogs.findMany({ limit: 10, orderBy: { at: "desc" } })
  json({ entries: entries })
