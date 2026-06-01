# PATCH /admin/api/blocks/:id/field - inline editor field save.
# Body: { field: String, value: String, itemIndex: Int? }

@route @auth(admin,editor) PATCH "/admin/api/blocks/:id/field" -> Response
  const blockId = parseInt(params.id)
  if isNaN(blockId)
    return json({ error: "Invalid block id" }, 400)
  const body = parseBody(request)
  const field = body.field ?? ""
  const value = body.value ?? ""
  if field == ""
    return json({ error: "field required" }, 400)
  const allowedFields = ["title","subtitle","heading","body","ctaLabel","ctaHref","buttonLabel","buttonHref","source","language","icon","question","answer"]
  if !allowedFields.includes(field)
    return json({ error: "Unknown field" }, 400)

  const block = db.pageblocks.find(blockId)
  if !block
    return json({ error: "Block not found" }, 404)

  const data = JSON.parse(block.data ?? "{}")

  # Item field for array blocks like features or faq
  if body.itemIndex != null
    const idx = parseInt(body.itemIndex)
    if isNaN(idx) || idx < 0 || !data.items || !data.items[idx]
      return json({ error: "Item not found" }, 404)
    data.items[idx][field] = value
  else
    data[field] = value

  db.pageblocks.update(blockId, { data: JSON.stringify(data) })

  if session
    db.auditlogs.create({ actorId: session.userId, action: "update", entityType: "Block", entityId: String(blockId) })

  return json({ ok: true })
