// Media upload and listing routes for arc-cms

@group "/admin" @auth(admin)
  @route get "/media" -> Response
    const rows = db.media.findMany({ orderBy: { createdAt: "desc" }, limit: 200 })
    json({ rows, total: db.media.count() })

  @route post "/media/upload" -> Response
    const formData = await request.formData()
    const file = formData.get("file")
    if !file return json({ error: "No file provided" }, 400)
    const MAX_SIZE = 10 * 1024 * 1024
    if file.size > MAX_SIZE return json({ error: "File exceeds 10 MB limit" }, 413)
    const ext = file.name.split(".").pop().toLowerCase()
    const SAFE_TYPES = ["jpg", "jpeg", "png", "gif", "webp", "avif", "mp4", "mp3"]
    const ATTACHMENT_TYPES = ["svg", "pdf"]
    if !SAFE_TYPES.includes(ext) && !ATTACHMENT_TYPES.includes(ext)
      return json({ error: "File type not allowed" }, 415)
    const filename = crypto.randomBytes(8).toString("hex") + "." + ext
    const uploadPath = "./public/uploads/" + filename
    try
      await Bun.write(uploadPath, await file.arrayBuffer())
    catch err
      return json({ error: "Upload failed" }, 500)
    const record = db.media.create({
      filename,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      url: "/uploads/" + filename,
      uploadedBy: session.userId
    })
    json(record, 201)

  @route delete "/media/:id" -> Response
    const record = db.media.find(params.id)
    match record
      None -> json({ error: "Not found" }, 404)
      Some(m) ->
        try
          await Bun.file("./public/uploads/" + m.filename).delete()
        catch _
          none
        db.media.delete(params.id)
        db.auditlogs.create({ actorId: session.userId, action: "delete", entityType: "Media", entityId: params.id })
        json({ ok: true })
