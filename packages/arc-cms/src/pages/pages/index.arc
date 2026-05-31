import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"

page "Pages - Admin"

  @state let statusFilter = "all"
  @state let sortBy       = "updatedAt"
  @state let visibleCount = 20

  @server fn listPages(sf: String, sb: String, vc: Int) -> Any
    const orderBy = sb == "title" ? { title: "asc" } : sb == "slug" ? { slug: "asc" } : { updatedAt: "desc" }
    if sf == "published"
      return {
        rows: db.pages.findMany({ where: { published: true }, orderBy: orderBy, limit: vc }),
        total: db.pages.count(),
        filteredTotal: db.pages.count({ where: { published: true } })
      }
    if sf == "draft"
      return {
        rows: db.pages.findMany({ where: { published: false }, orderBy: orderBy, limit: vc }),
        total: db.pages.count(),
        filteredTotal: db.pages.count({ where: { published: false } })
      }
    return {
      rows: db.pages.findMany({ orderBy: orderBy, limit: vc }),
      total: db.pages.count(),
      filteredTotal: db.pages.count()
    }

  @server fn togglePublish(pageId: String, newState: Bool) -> Any
    if !session || (session.role != "admin" && session.role != "editor")
      return { error: "forbidden" }
    db.pages.update(pageId, { published: newState, updatedAt: now() })
    db.auditlogs.create({ actorId: session.userId, action: "update", entityType: "Page", entityId: pageId, after: JSON.stringify({ published: newState }) })
    return { ok: true }

  @live const data = listPages(statusFilter, sortBy, visibleCount)

  CmsLayout title="Pages" active="pages"
    CmsPageHeader title="Pages" subtitle="{data.filteredTotal} total"
      link href="/admin/pages/new"
        button class="!btn !btn--primary" "+ New page"

    col gap="16px"
      row gap="8px" align="center" justify="space-between"
        row gap="4px"
          if statusFilter == "all"
            button class="!btn !btn--sm !btn--primary" on:click={ @statusFilter = "all"; @visibleCount = 20 } "All"
          if statusFilter != "all"
            button class="!btn !btn--sm !btn--ghost" on:click={ @statusFilter = "all"; @visibleCount = 20 } "All"
          if statusFilter == "published"
            button class="!btn !btn--sm !btn--primary" on:click={ @statusFilter = "published"; @visibleCount = 20 } "Published"
          if statusFilter != "published"
            button class="!btn !btn--sm !btn--ghost" on:click={ @statusFilter = "published"; @visibleCount = 20 } "Published"
          if statusFilter == "draft"
            button class="!btn !btn--sm !btn--primary" on:click={ @statusFilter = "draft"; @visibleCount = 20 } "Draft"
          if statusFilter != "draft"
            button class="!btn !btn--sm !btn--ghost" on:click={ @statusFilter = "draft"; @visibleCount = 20 } "Draft"
        select class="!input cms-sort" aria-label="Sort order" bind:value="sortBy" on:change={ @visibleCount = 20 }
          option value="updatedAt" "Updated"
          option value="title" "Title"
          option value="slug" "Slug"

      if data.rows.length == 0
        text class="cms-empty-hint" "No pages match this filter."
      else
        col gap="12px"
          col class="!table-wrap"
            table class="!table"
              thead
                tr
                  th "Title"
                  th "Slug"
                  th "Status"
                  th "Updated"
                  th ""
              tbody
                for pg in data.rows
                  tr
                    td "{pg.title}"
                    td
                      text class="!badge" "/p/{pg.slug}"
                    td
                      if pg.published
                        row gap="6px" align="center"
                          text class="!badge !badge--success" "Published"
                          button class="!btn !btn--ghost !btn--sm" on:click={ togglePublish(String(pg.id), false) } "Unpublish"
                      if !pg.published
                        row gap="6px" align="center"
                          text class="!badge" "Draft"
                          button class="!btn !btn--primary !btn--sm" on:click={ togglePublish(String(pg.id), true) } "Publish"
                    td class="cms-cell-date" "{pg.updatedAt}"
                    td
                      link href="/admin/pages/{pg.id}"
                        button class="!btn !btn--ghost !btn--sm" "Edit"

          if data.rows.length < data.filteredTotal
            row justify="center"
              button class="!btn !btn--ghost cms-load-more" on:click={ @visibleCount = visibleCount + 20 }
                "Load more ({data.filteredTotal - data.rows.length} remaining)"

  design
    .cms-cell-date
      font-size: 12px
      color: var(--ui-fg-3, #a3a3a3)
    .cms-sort
      width: 130px
    .cms-empty-hint
      padding: 32px 0
      text-align: center
      color: var(--ui-fg-3, #a3a3a3)
    .cms-load-more
      width: 100%
      max-width: 360px
      color: var(--ui-fg-2, #6b7280)
