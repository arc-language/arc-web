import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"

page "Dashboard - Admin"

  @server fn getStats() -> Any
    return {
      users:          db.users.count(),
      groups:         db.groups.count(),
      blocks:         db.pageblocks.count(),
      media:          db.media ? db.media.count() : 0,
      pages:          db.pages.count(),
      pagesPublished: db.pages.count({ where: { published: true } }),
      recentActivity: db.auditlogs.findMany({ limit: 8, orderBy: { at: "desc" } }),
      recentPages:    db.pages.findMany({ limit: 5, orderBy: { updatedAt: "desc" } }),
      recentUsers:    db.users.findMany({ limit: 3, orderBy: { createdAt: "desc" } })
    }

  @live const stats = getStats()

  CmsLayout title="Dashboard" active="dashboard"
    CmsPageHeader title="Dashboard" subtitle="Welcome back"

    row class="stat-row" gap="16px" wrap
      link href="/admin/users" class="stat-link"
        col class="!card stat-card"
          text class="stat-label" "Users"
          text class="stat-value" "{stats.users}"
      link href="/admin/pages" class="stat-link"
        col class="!card stat-card"
          text class="stat-label" "Pages"
          text class="stat-value" "{stats.pages}"
          text class="stat-sub" "{stats.pagesPublished} published"
      link href="/admin/blocks" class="stat-link"
        col class="!card stat-card"
          text class="stat-label" "Blocks"
          text class="stat-value" "{stats.blocks}"
      link href="/admin/media" class="stat-link"
        col class="!card stat-card"
          text class="stat-label" "Media"
          text class="stat-value" "{stats.media}"
      link href="/admin/groups" class="stat-link"
        col class="!card stat-card"
          text class="stat-label" "Groups"
          text class="stat-value" "{stats.groups}"

    row class="dash-main" gap="20px" wrap
      col class="!card dash-panel dash-panel--wide" gap="12px"
        row justify="space-between" align="center"
          text class="dash-section-title" "Recent Activity"
          link href="/admin/audit"
            button class="!btn !btn--ghost !btn--sm" "View all"
        if stats.recentActivity.length == 0
          text class="dash-empty" "No activity recorded yet."
        if stats.recentActivity.length > 0
          col
            for entry in stats.recentActivity
              row class="activity-row" gap="10px" align="center"
                text class="!badge badge--{entry.action}" "{entry.action}"
                text class="activity-entity" "{entry.entityType} #{entry.entityId}"
                text class="cms-mono activity-time" "{entry.at}"

      col class="!card dash-panel" gap="12px"
        text class="dash-section-title" "Quick Actions"
        col gap="8px"
          link href="/admin/pages/new"
            button class="!btn !btn--ghost action-btn" "▤  New Page"
          link href="/admin/blocks/new"
            button class="!btn !btn--ghost action-btn" "◫  New Block"
          link href="/admin/media"
            button class="!btn !btn--ghost action-btn" "▣  Upload Media"
          col class="cms-role-admin"
            link href="/admin/users/new"
              button class="!btn !btn--ghost action-btn" "◉  New User"
          col class="cms-role-admin"
            link href="/admin/settings"
              button class="!btn !btn--ghost action-btn" "⚙  Settings"

    col class="cms-role-admin dash-bottom"
      row gap="20px" wrap
        col class="!card dash-panel" gap="12px"
          row justify="space-between" align="center"
            text class="dash-section-title" "Recent Pages"
            link href="/admin/pages"
              button class="!btn !btn--ghost !btn--sm" "See all"
          col class="!table-wrap"
            table class="!table"
              thead
                tr
                  th "Slug"
                  th "Status"
                  th ""
              tbody
                for pg in stats.recentPages
                  tr
                    td
                      text class="!badge" "/p/{pg.slug}"
                    td
                      if pg.published
                        text class="!badge !badge--success" "Published"
                      if !pg.published
                        text class="!badge" "Draft"
                    td
                      link href="/admin/pages/{pg.id}"
                        button class="!btn !btn--ghost !btn--sm" "Edit"

        col class="!card dash-panel" gap="12px"
          row justify="space-between" align="center"
            text class="dash-section-title" "Recent Users"
            link href="/admin/users"
              button class="!btn !btn--ghost !btn--sm" "See all"
          col gap="10px"
            for u in stats.recentUsers
              row gap="10px" align="center"
                col gap="2px"
                  text "{u.name}"
                  text class="cms-mono" "{u.email}"
                text class="!badge !badge--info" "{u.role}"

  design
    .stat-row
      margin-bottom: 20px
    .stat-link
      text-decoration: none
      color: inherit
      display: block
    .stat-card
      padding: 20px 24px
      min-width: 160px
      gap: 6px
      cursor: pointer
      transition: transform 0.15s ease, box-shadow 0.15s ease
    .stat-card:hover
      transform: translateY(-2px)
    .stat-label
      font-size: 11px
      font-weight: 600
      text-transform: uppercase
      letter-spacing: 0.07em
      color: var(--ui-fg-3, #a3a3a3)
      margin: 0
    .stat-value
      font-size: 28px
      font-weight: 700
      letter-spacing: -0.02em
      margin: 0
    .stat-sub
      font-size: 11px
      color: var(--ui-fg-3, #a3a3a3)
      margin: 0
    .dash-main
      margin-bottom: 20px
    .dash-panel
      flex: 1
      min-width: 260px
      padding: 20px
    .dash-panel--wide
      flex: 1.6
    .dash-section-title
      font-size: 13px
      font-weight: 600
      margin: 0
    .dash-empty
      font-size: 13px
      color: var(--ui-fg-3, #a3a3a3)
      padding: 8px 0
    .activity-row
      padding: 8px 0
      border-bottom: 1px solid var(--ui-border, #e5e7eb)
    .activity-row:last-child
      border-bottom: none
    .activity-entity
      flex: 1
      font-size: 13px
    .activity-time
      font-size: 11px
      color: var(--ui-fg-3, #a3a3a3)
      white-space: nowrap
    .badge--create
      background-color: #dcfce7
      color: #166534
      border-radius: 4px
      padding: 2px 7px
      font-size: 11px
      font-weight: 600
      text-transform: uppercase
      letter-spacing: 0.04em
    .badge--update
      background-color: #dbeafe
      color: #1e40af
      border-radius: 4px
      padding: 2px 7px
      font-size: 11px
      font-weight: 600
      text-transform: uppercase
      letter-spacing: 0.04em
    .badge--delete
      background-color: #fee2e2
      color: #991b1b
      border-radius: 4px
      padding: 2px 7px
      font-size: 11px
      font-weight: 600
      text-transform: uppercase
      letter-spacing: 0.04em
    .action-btn
      width: 100%
      justify-content: flex-start
      gap: 8px
      text-align: left
    .dash-bottom
      width: 100%
    .cms-mono
      font-family: ui-monospace, 'SF Mono', Consolas, monospace
      font-size: 12px
    .cms-cell-date
      font-size: 12px
      color: var(--ui-fg-3, #a3a3a3)
