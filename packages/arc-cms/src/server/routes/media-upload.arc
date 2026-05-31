# POST /admin/api/media/upload - multipart file upload.
# Saves to public/uploads/{timestamp}-{slugified-name} and inserts a Media row.
# Override or extend for S3/R2/etc. storage.

@route @auth(admin,editor) POST "/admin/api/media/upload" -> Response
  const body = parseBody(request)
  const file = body.file
  if !file
    return json({ error: "no file provided" }, 400)

  const rawName = file.name ?? "upload"
  const lower = rawName.toLowerCase()
  const dot = lower.lastIndexOf(".")
  const ext = dot >= 0 ? lower.slice(dot + 1) : ""
  const allowed = ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "pdf", "mp4", "webm", "mp3"]
  if !allowed.includes(ext)
    return json({ error: "unsupported file type" }, 415)

  const stamp = Date.now()
  const slug = rawName.replace(new RegExp("[^a-z0-9._-]", "gi"), "-").toLowerCase()
  const filename = stamp + "-" + slug
  const fullPath = "public/uploads/" + filename
  await Bun.write(fullPath, file)

  const sess = auth.session(request)
  const uploaderId = sess?.userId ?? 0

  const row = db.medias.create({
    filename: filename,
    url: "/uploads/" + filename,
    mime: file.type ?? "application/octet-stream",
    size: file.size ?? 0,
    uploadedBy: uploaderId
  })
  json(row, 201)
