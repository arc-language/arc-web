import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsField from "@arc-cms/widgets/CmsField.arc"

page "New page - Admin"

  @state let title       = ""
  @state let slug        = ""
  @state let metaDescription = ""
  @state let parentId    = ""
  @state let navLabel    = ""
  @state let navOrder    = 0
  @state let showInNav   = true
  @state let layout      = "default"
  @state let created     = ""
  @state let createError = ""

  @server fn getParentOptions() -> Any
    return db.pages.findMany({ orderBy: { title: "asc" } })

  @live const parentOptions = getParentOptions()

  @server fn createPage(t: String, s: String, m: String, pid: String, nl: String, no: Int, sin: Bool, lay: String) -> Any
    if !session || (session.role != "admin" && session.role != "editor")
      return { error: "forbidden" }
    if !t || !s
      return { error: "title and slug are required" }
    const existing = db.pages.findFirst({ where: { slug: s } })
    if existing
      return { error: "slug already exists" }
    const parentIdInt = pid != "" ? parseInt(pid) : null
    const pg = db.pages.create({
      title: t,
      slug: s,
      metaDescription: m,
      parentId: parentIdInt,
      navLabel: nl,
      navOrder: no,
      showInNav: sin,
      layout: lay,
      published: false
    })
    db.auditlogs.create({ actorId: session.userId, action: "create", entityType: "Page", entityId: String(pg.id) })
    return { id: pg.id }

  CmsLayout title="New page" active="pages"
    CmsPageHeader title="New page"
      link href="/admin/pages"
        button class="!btn !btn--ghost" "Cancel"

    col gap="16px" style="max-width:560px"
      col class="!card" p="24px" gap="16px"
        text class="cms-section" "Page details"
        CmsField label="Title" name="title" required="true"
        CmsField label="Slug" name="slug" required="true" hint="URL-safe identifier, e.g. about, pricing"
        CmsField label="Meta description" name="metaDescription"

        col gap="6px"
          text class="!input-label" "Layout"
          select class="!input" bind:value="layout"
            option value="default" "Default"
            option value="full-width" "Full width"
            option value="minimal" "Minimal"
            option value="landing" "Landing"

      col class="!card" p="24px" gap="16px"
        text class="cms-section" "Navigation & hierarchy"
        col gap="6px"
          text class="!input-label" "Parent page"
          select class="!input" bind:value="parentId"
            option value="" "No parent (root)"
            for p in parentOptions
              option value="{p.id}" "{p.title}"
        CmsField label="Nav label" name="navLabel" hint="Shown in menus; defaults to title if blank"
        CmsField label="Nav order" name="navOrder" hint="Lower numbers appear first"
        row gap="8px" align="center"
          input type="checkbox" bind:checked="showInNav"
          text class="!input-label" "Show in navigation"

      col gap="8px"
        if createError != ""
          text class="cms-error" "{createError}"
        row gap="10px"
          button class="!btn !btn--primary" on:click={
            const r = createPage(title, slug, metaDescription, parentId, navLabel, navOrder, showInNav, layout)
            if r.id
              @created = String(r.id)
              @createError = ""
            else
              @createError = r.error ?? "Failed to create page"
          } "Create page"
          if created != ""
            link href="/admin/pages/{created}"
              button class="!btn !btn--ghost" "Open editor →"

  design
    .cms-section
      font-size: 13px
      font-weight: 600
      margin: 0
    .cms-error
      font-size: 13px
      color: #ef4444
