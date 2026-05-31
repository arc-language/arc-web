import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsField from "@arc-cms/widgets/CmsField.arc"
import CmsConfirm from "@arc-cms/widgets/CmsConfirm.arc"

page "Edit page - Admin"

  @param id

  @server fn getPage(pageId: String) -> Any
    const pg = db.pages.find(pageId)
    if !pg
      return { found: false, page: null, blocks: [], themes: [], allPages: [] }
    const blocks   = db.pageblocks.findMany({ where: { page: pg.slug }, orderBy: { order: "asc" } })
    const themes   = db.themes.findMany({})
    const allPages = db.pages.findMany({ where: { id: { not: parseInt(pageId) } }, orderBy: { title: "asc" } })
    // compute full URL path
    const parent = pg.parentId ? db.pages.findFirst({ where: { id: pg.parentId } }) : null
    const fullPath = parent ? "/p/" + parent.slug + "/" + pg.slug : "/p/" + pg.slug
    return { found: true, page: pg, blocks, themes, allPages, fullPath }

  @live const data = getPage(id)

  @state let title       = data.page.title
  @state let slug        = data.page.slug
  @state let metaDescription = data.page.metaDescription
  @state let ogImage     = data.page.ogImage
  @state let themeId     = data.page.themeId
  @state let layout      = data.page.layout
  @state let parentId    = data.page.parentId ? String(data.page.parentId) : ""
  @state let navLabel    = data.page.navLabel ?? ""
  @state let navOrder    = data.page.navOrder ?? 0
  @state let showInNav   = data.page.showInNav ?? true
  @state let published   = data.page.published
  @state let deleted     = false
  @state let saved       = false
  @state let saveError   = ""
  @state let confirmOpen = ""
  @state let duplicated  = ""

  @server fn updatePage(pageId: String, t: String, s: String, m: String, og: String, th: Int, lay: String, pid: String, nl: String, no: Int, sin: Bool, pub: Bool) -> Any
    if !session || (session.role != "admin" && session.role != "editor")
      return { error: "forbidden" }
    if pid != "" && pid == pageId
      return { error: "Cannot set page as its own parent" }
    const parentIdInt = pid != "" ? parseInt(pid) : null
    db.pages.update(pageId, {
      title: t,
      slug: s,
      metaDescription: m,
      ogImage: og,
      themeId: th,
      layout: lay,
      parentId: parentIdInt,
      navLabel: nl,
      navOrder: no,
      showInNav: sin,
      published: pub,
      updatedAt: now()
    })
    db.auditlogs.create({ actorId: session.userId, action: "update", entityType: "Page", entityId: pageId, after: JSON.stringify({ title: t, slug: s, published: pub }) })
    return { ok: true }

  @server fn moveBlock(blockId: String, dir: String) -> Any
    if !session || (session.role != "admin" && session.role != "editor")
      return { error: "forbidden" }
    const b = db.pageblocks.find(blockId)
    const neighbor = dir == "up"
      ? db.pageblocks.findFirst({ where: { page: b.page, order: { lt: b.order } }, orderBy: { order: "desc" } })
      : db.pageblocks.findFirst({ where: { page: b.page, order: { gt: b.order } }, orderBy: { order: "asc" } })
    if neighbor
      db.pageblocks.update(blockId, { order: neighbor.order })
      db.pageblocks.update(neighbor.id, { order: b.order })
    return { ok: true }

  @server fn deletePage(pageId: String) -> Any
    if !session || session.role != "admin"
      return { error: "forbidden" }
    // re-home children to grandparent before deleting
    const pg = db.pages.find(pageId)
    if pg
      const children = db.pages.findMany({ where: { parentId: pg.id } })
      for child in children
        db.pages.update(child.id, { parentId: pg.parentId })
    db.pages.delete(pageId)
    db.auditlogs.create({ actorId: session.userId, action: "delete", entityType: "Page", entityId: pageId })
    return { ok: true }

  @server fn duplicatePage(pageId: String) -> Any
    if !session || (session.role != "admin" && session.role != "editor")
      return { error: "forbidden" }
    const pg = db.pages.find(pageId)
    if !pg return { error: "Not found" }
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
    return { id: newPage.id }

  CmsLayout title="Edit page" active="pages"
    CmsConfirm id="delete-page" title="Delete this page?" message="This cannot be undone. Child pages will be re-homed to the parent." open="{confirmOpen}"
      button class="!btn !btn--danger" on:click={ @deleted = deletePage(id).ok == true } "Delete"

    if deleted
      col class="!card" p="24px" gap="12px"
        text "Page deleted."
        link href="/admin/pages"
          button class="!btn !btn--ghost" "Back to pages"

    if !deleted
      CmsPageHeader title="{data.page.title}" subtitle="{data.fullPath}"
        link href="{data.fullPath}" target="_blank"
          button class="!btn !btn--ghost" "View"
        button class="!btn !btn--ghost" on:click={
          const r = duplicatePage(id)
          if r.id
            @duplicated = String(r.id)
        } "Duplicate"
        link href="/admin/pages"
          button class="!btn !btn--ghost" "Back"

      if duplicated != ""
        row class="!card cms-banner cms-banner--info" p="12px 16px" gap="10px" align="center"
          text "Page duplicated."
          link href="/admin/pages/{duplicated}"
            button class="!btn !btn--ghost !btn--sm" "Open copy →"

      col gap="24px"
        col class="!card" p="24px" gap="14px"
          text class="cms-section" "Page details"
          CmsField label="Title" name="title" required="true"
          CmsField label="Slug" name="slug" required="true"
          CmsField label="Meta description" name="metaDescription"
          CmsField label="OG image URL" name="ogImage"

          col gap="6px"
            text class="!input-label" "Layout"
            select class="!input" bind:value="layout"
              option value="default" "Default"
              option value="full-width" "Full width"
              option value="minimal" "Minimal"
              option value="landing" "Landing"

          col gap="6px"
            text class="!input-label" "Theme"
            select class="!input" bind:value="themeId"
              option value="" "No theme"
              for th in data.themes
                option value="{th.id}" "{th.name}"

          row gap="10px" align="center"
            input type="checkbox" bind:checked="published"
            text class="!input-label" "Published"

          row gap="10px" align="center"
            button class="!btn !btn--primary" on:click={
              const r = updatePage(id, title, slug, metaDescription, ogImage, themeId, layout, parentId, navLabel, navOrder, showInNav, published)
              if r.ok
                @saved = true
                @saveError = ""
              else
                @saveError = r.error ?? "Failed to save"
                @saved = false
            } "Save"
            if saved
              text class="cms-saved" "Saved ✓"
            if saveError != ""
              text class="cms-error" "{saveError}"

        col class="!card" p="24px" gap="14px"
          text class="cms-section" "Navigation & hierarchy"
          col gap="6px"
            text class="!input-label" "Parent page"
            select class="!input" bind:value="parentId"
              option value="" "No parent (root)"
              for p in data.allPages
                option value="{p.id}" "{p.title}"
          CmsField label="Nav label" name="navLabel" hint="Shown in menus; defaults to title if blank"
          CmsField label="Nav order" name="navOrder" hint="Lower numbers appear first"
          row gap="8px" align="center"
            input type="checkbox" bind:checked="showInNav"
            text class="!input-label" "Show in navigation"

        col class="!card" p="24px" gap="12px"
          row align="center" justify="space-between"
            text class="cms-section" "Blocks ({data.blocks.length})"
            link href="/admin/blocks/new?page={data.page.slug}"
              button class="!btn !btn--primary !btn--sm" "+ Add block"
          if data.blocks.length == 0
            text class="cms-hint" "This page has no blocks yet."
          else
            col class="!table-wrap"
              table class="!table"
                thead
                  tr
                    th "Order"
                    th "Type"
                    th "Visible"
                    th ""
                    th ""
                tbody
                  for b in data.blocks
                    tr
                      td "{b.order}"
                      td
                        text class="!badge !badge--info" "{b.type}"
                      td "{b.visible}"
                      td
                        row gap="4px"
                          button class="!btn !btn--ghost !btn--sm" on:click={ moveBlock(b.id, "up") } "↑"
                          button class="!btn !btn--ghost !btn--sm" on:click={ moveBlock(b.id, "down") } "↓"
                      td
                        link href="/admin/blocks/{b.type}/{b.id}"
                          button class="!btn !btn--ghost !btn--sm" "Edit"

        col class="!card" p="24px" gap="12px"
          text class="cms-section cms-danger" "Danger zone"
          row align="center" justify="space-between"
            col gap="2px"
              text "Delete this page"
              text class="cms-hint" "Child pages will be re-homed; blocks for this slug remain."
            button class="!btn !btn--danger" on:click={ @confirmOpen = "delete-page" } "Delete page"

  design
    .cms-section
      font-size: 13px
      font-weight: 600
      margin: 0
    .cms-danger
      color: #ef4444
    .cms-hint
      font-size: 12px
      color: var(--ui-fg-3, #a3a3a3)
      margin: 0
    .cms-saved
      font-size: 13px
      color: #22c55e
      font-weight: 500
    .cms-error
      font-size: 13px
      color: #ef4444
    .cms-banner
      border-radius: 8px
    .cms-banner--info
      background: var(--ui-bg-2, #f0f9ff)
      border: 1px solid var(--ui-border, #e2e8f0)
