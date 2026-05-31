import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsEmpty from "@arc-cms/widgets/CmsEmpty.arc"

# The upload form posts to /admin/api/media/upload. Implement that route
# against your storage backend (local, S3, R2, etc). See arc-cms docs.
page "Media - Admin"

  @server fn listMedia() -> Any
    return { rows: db.medias.findMany({ limit: 200, orderBy: { createdAt: "desc" } }) }

  @live const data = listMedia()

  @server fn deleteMedia(mediaId: String) -> Any
    if !session || (session.role != "admin" && session.role != "editor")
      return { error: "forbidden" }
    db.medias.delete(mediaId)
    db.auditlogs.create({ actorId: session.userId, action: "delete", entityType: "Media", entityId: mediaId })
    return { ok: true }

  CmsLayout title="Media" active="media"
    CmsPageHeader title="Media library" subtitle="{data.rows.length} assets"
      @raw '<form method="post" action="/admin/api/media/upload" enctype="multipart/form-data" style="display:inline-flex;gap:8px;align-items:center"><input type="file" name="file" required class="input" style="max-width:220px"/><button class="btn btn--primary" type="submit">Upload</button></form>'

    if data.rows.length == 0
      CmsEmpty title="No media yet" body="Upload an image or asset to reference it from blocks." icon="▣"
    else
      row class="cms-media-grid" gap="16px" wrap
        for m in data.rows
          col class="!card cms-media-card" p="12px" gap="8px"
            @raw '<a href="' + m.url + '" target="_blank" class="cms-media-thumb-link"><img src="' + m.url + '" alt="' + m.filename + '" class="cms-media-thumb"/></a>'
            text class="cms-media-name" "{m.filename}"
            text class="cms-media-meta" "{m.size} bytes — {m.mime}"
            row gap="6px"
              @raw '<button type="button" class="btn btn--ghost btn--sm" onclick="navigator.clipboard.writeText(\'' + m.url + '\'); this.textContent=\'Copied\'">Copy URL</button>'
              button class="!btn !btn--ghost !btn--sm" on:click={ confirm("Delete this asset?") && deleteMedia(m.id) } "Delete"

  design
    .cms-media-grid
      display: flex
      flex-wrap: wrap
    .cms-media-card
      width: 200px
    .cms-media-thumb
      width: 100%
      height: 120px
      object-fit: cover
      border-radius: 8px
      background-color: var(--ui-bg-3, #efefef)
    .cms-media-name
      font-size: 13px
      font-weight: 600
      margin: 0
      overflow: hidden
      text-overflow: ellipsis
      white-space: nowrap
    .cms-media-meta
      font-size: 11px
      color: var(--ui-fg-3, #a3a3a3)
      margin: 0
