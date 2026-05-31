import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsEmpty from "@arc-cms/widgets/CmsEmpty.arc"

page "Users - Admin"

  @state let roleFilter   = "all"
  @state let nameSearch   = ""
  @state let sortBy       = "createdAt"
  @state let visibleCount = 20

  @server fn listUsers(rf: String, ns: String, sb: String, vc: Int) -> Any
    const orderBy = sb == "name" ? { name: "asc" } : sb == "email" ? { email: "asc" } : { createdAt: "desc" }
    if rf != "all" && ns != ""
      const rows = db.users.findMany({ where: { role: rf, name: { contains: ns } }, orderBy: orderBy, limit: vc })
      const enriched = rows.map(u => ({ ...u, groupCount: db.usergroups.count({ where: { userId: String(u.id) } }) }))
      return { rows: enriched, total: db.users.count(), filteredTotal: db.users.count({ where: { role: rf, name: { contains: ns } } }) }
    if rf != "all"
      const rows = db.users.findMany({ where: { role: rf }, orderBy: orderBy, limit: vc })
      const enriched = rows.map(u => ({ ...u, groupCount: db.usergroups.count({ where: { userId: String(u.id) } }) }))
      return { rows: enriched, total: db.users.count(), filteredTotal: db.users.count({ where: { role: rf } }) }
    if ns != ""
      const rows = db.users.findMany({ where: { name: { contains: ns } }, orderBy: orderBy, limit: vc })
      const enriched = rows.map(u => ({ ...u, groupCount: db.usergroups.count({ where: { userId: String(u.id) } }) }))
      return { rows: enriched, total: db.users.count(), filteredTotal: db.users.count({ where: { name: { contains: ns } } }) }
    const rows = db.users.findMany({ orderBy: orderBy, limit: vc })
    const enriched = rows.map(u => ({ ...u, groupCount: db.usergroups.count({ where: { userId: String(u.id) } }) }))
    return { rows: enriched, total: db.users.count(), filteredTotal: db.users.count() }

  @live const data = listUsers(roleFilter, nameSearch, sortBy, visibleCount)

  CmsLayout title="Users" active="users"
    CmsPageHeader title="Users" subtitle="{data.filteredTotal} of {data.total}"
      link href="/admin/users/new"
        button class="!btn !btn--primary" "+ New user"

    col gap="16px"
      row class="cms-toolbar" gap="8px" align="center" justify="space-between" wrap
        row gap="4px"
          if roleFilter == "all"
            button class="!btn !btn--sm !btn--primary" on:click={ @roleFilter = "all"; @visibleCount = 20 } "All"
          if roleFilter != "all"
            button class="!btn !btn--sm !btn--ghost" on:click={ @roleFilter = "all"; @visibleCount = 20 } "All"
          if roleFilter == "admin"
            button class="!btn !btn--sm !btn--primary" on:click={ @roleFilter = "admin"; @visibleCount = 20 } "Admin"
          if roleFilter != "admin"
            button class="!btn !btn--sm !btn--ghost" on:click={ @roleFilter = "admin"; @visibleCount = 20 } "Admin"
          if roleFilter == "editor"
            button class="!btn !btn--sm !btn--primary" on:click={ @roleFilter = "editor"; @visibleCount = 20 } "Editor"
          if roleFilter != "editor"
            button class="!btn !btn--sm !btn--ghost" on:click={ @roleFilter = "editor"; @visibleCount = 20 } "Editor"
          if roleFilter == "viewer"
            button class="!btn !btn--sm !btn--primary" on:click={ @roleFilter = "viewer"; @visibleCount = 20 } "Viewer"
          if roleFilter != "viewer"
            button class="!btn !btn--sm !btn--ghost" on:click={ @roleFilter = "viewer"; @visibleCount = 20 } "Viewer"
        row gap="8px" align="center"
          input class="!input cms-search" type="search" placeholder="Search users…" bind:value="nameSearch" on:input={ @visibleCount = 20 }
          select class="!input cms-sort" aria-label="Sort order" bind:value="sortBy" on:change={ @visibleCount = 20 }
            option value="createdAt" "Newest"
            option value="name" "Name A–Z"
            option value="email" "Email A–Z"

      if data.rows.length == 0
        CmsEmpty title="No users match" body="Try a different filter or search term." icon="◉"
          link href="/admin/users/new"
            button class="!btn !btn--primary" "Add user"
      else
        col gap="12px"
          col class="!table-wrap"
            table class="!table"
              thead
                tr
                  th "User"
                  th "Role"
                  th "Groups"
                  th "Joined"
                  th ""
              tbody
                for u in data.rows
                  tr
                    td
                      row gap="10px" align="center"
                        div class="user-avatar" data-role="{u.role}" "{u.name[0]}"
                        col gap="2px"
                          text class="user-name" "{u.name}"
                          text class="user-email" "{u.email}"
                    td
                      text class="!badge !badge--info" "{u.role}"
                    td class="cms-cell-muted" "{u.groupCount}"
                    td class="cms-cell-date" "{u.createdAt}"
                    td
                      link href="/admin/users/{u.id}"
                        button class="!btn !btn--ghost !btn--sm" "Edit"

          if data.rows.length < data.filteredTotal
            row justify="center"
              button class="!btn !btn--ghost cms-load-more" on:click={ @visibleCount = visibleCount + 20 }
                "Load more ({data.filteredTotal - data.rows.length} remaining)"

  design
    .cms-toolbar
      flex-wrap: wrap
    .cms-search
      width: 200px
    .cms-sort
      width: 120px
    .user-avatar
      width: 32px
      height: 32px
      border-radius: 50%
      display: flex
      align-items: center
      justify-content: center
      font-size: 12px
      font-weight: 700
      color: white
      flex-shrink: 0
      text-transform: uppercase
      background: var(--ui-fg-3, #a3a3a3)
    .user-avatar[data-role="admin"]
      background: #ef4444
    .user-avatar[data-role="editor"]
      background: #3b82f6
    .user-avatar[data-role="viewer"]
      background: #6b7280
    .user-name
      font-size: 14px
      font-weight: 500
      margin: 0
    .user-email
      font-size: 12px
      color: var(--ui-fg-3, #a3a3a3)
      margin: 0
    .cms-cell-date
      font-size: 12px
      color: var(--ui-fg-3, #a3a3a3)
      white-space: nowrap
    .cms-cell-muted
      font-size: 13px
      color: var(--ui-fg-3, #a3a3a3)
    .cms-load-more
      width: 100%
      max-width: 360px
      color: var(--ui-fg-2, #6b7280)
