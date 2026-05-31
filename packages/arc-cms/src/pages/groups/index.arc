import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsEmpty from "@arc-cms/widgets/CmsEmpty.arc"

page "Groups - Admin"

  @state let nameSearch   = ""
  @state let sortBy       = "name"
  @state let visibleCount = 20

  @server fn listGroups(ns: String, sb: String, vc: Int) -> Any
    const orderBy = sb == "createdAt" ? { createdAt: "desc" } : { name: "asc" }
    if ns != ""
      const rows = db.groups.findMany({ where: { name: { contains: ns } }, orderBy: orderBy, limit: vc })
      const enriched = rows.map(g => ({ ...g, memberCount: db.usergroups.count({ where: { groupId: String(g.id) } }) }))
      return { rows: enriched, total: db.groups.count(), filteredTotal: db.groups.count({ where: { name: { contains: ns } } }) }
    const rows = db.groups.findMany({ orderBy: orderBy, limit: vc })
    const enriched = rows.map(g => ({ ...g, memberCount: db.usergroups.count({ where: { groupId: String(g.id) } }) }))
    return { rows: enriched, total: db.groups.count(), filteredTotal: db.groups.count() }

  @live const data = listGroups(nameSearch, sortBy, visibleCount)

  CmsLayout title="Groups" active="groups"
    CmsPageHeader title="Groups" subtitle="{data.filteredTotal} of {data.total}"
      link href="/admin/groups/new"
        button class="!btn !btn--primary" "+ New group"

    col gap="16px"
      row gap="8px" align="center" justify="space-between" wrap
        input class="!input cms-search" type="search" placeholder="Search groups…" bind:value="nameSearch" on:input={ @visibleCount = 20 }
        select class="!input cms-sort" aria-label="Sort order" bind:value="sortBy" on:change={ @visibleCount = 20 }
          option value="name" "Name A–Z"
          option value="createdAt" "Newest"

      if data.rows.length == 0
        CmsEmpty title="No groups match" body="Groups let you bundle users for shared permissions." icon="◎"
          link href="/admin/groups/new"
            button class="!btn !btn--primary" "Create group"
      else
        col gap="12px"
          col class="!table-wrap"
            table class="!table"
              thead
                tr
                  th "Name"
                  th "Slug"
                  th "Description"
                  th "Members"
                  th ""
              tbody
                for g in data.rows
                  tr
                    td class="group-name" "{g.name}"
                    td
                      text class="!badge" "{g.slug}"
                    td class="cms-cell-desc" "{g.description}"
                    td
                      row gap="6px" align="center"
                        div class="group-avatar" "{g.memberCount}"
                        text class="cms-cell-muted" "{g.memberCount == 1 ? '1 member' : g.memberCount + ' members'}"
                    td
                      link href="/admin/groups/{g.id}"
                        button class="!btn !btn--ghost !btn--sm" "Edit"

          if data.rows.length < data.filteredTotal
            row justify="center"
              button class="!btn !btn--ghost cms-load-more" on:click={ @visibleCount = visibleCount + 20 }
                "Load more ({data.filteredTotal - data.rows.length} remaining)"

  design
    .cms-search
      width: 220px
    .cms-sort
      width: 120px
    .group-name
      font-weight: 500
      font-size: 14px
    .group-avatar
      width: 22px
      height: 22px
      border-radius: 50%
      background: var(--ui-fg-3, #a3a3a3)
      color: white
      display: flex
      align-items: center
      justify-content: center
      font-size: 11px
      font-weight: 700
      flex-shrink: 0
    .cms-cell-desc
      font-size: 13px
      color: var(--ui-fg-2, #6b7280)
      max-width: 280px
    .cms-cell-muted
      font-size: 13px
      color: var(--ui-fg-3, #a3a3a3)
    .cms-load-more
      width: 100%
      max-width: 360px
      color: var(--ui-fg-2, #6b7280)
