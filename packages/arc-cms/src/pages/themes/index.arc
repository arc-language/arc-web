import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsEmpty from "@arc-cms/widgets/CmsEmpty.arc"

page "Themes - Admin"

  @server fn listThemes() -> Any
    return { rows: db.themes.findMany({ orderBy: { name: "asc" } }), total: db.themes.count() }

  @live const data = listThemes()

  CmsLayout title="Themes" active="themes"
    CmsPageHeader title="Themes" subtitle="{data.total} total"
      link href="/admin/themes/new"
        button class="!btn !btn--primary" "+ New theme"

    if data.rows.length == 0
      CmsEmpty title="No themes yet" body="Themes hold CSS tokens (colors, fonts) applied to CMS pages." icon="◐"
        link href="/admin/themes/new"
          button class="!btn !btn--primary" "Create theme"
    else
      col class="!table-wrap"
        table class="!table"
          thead
            tr
              th "Name"
              th "Slug"
              th "Tokens"
              th ""
          tbody
            for th in data.rows
              tr
                td "{th.name}"
                td
                  text class="!badge" "{th.slug}"
                td class="cms-mono cms-truncate" "{th.tokens}"
                td
                  link href="/admin/themes/{th.id}"
                    button class="!btn !btn--ghost !btn--sm" "Edit"

  design
    .cms-mono
      font-family: ui-monospace, 'SF Mono', Consolas, monospace
      font-size: 11px
    .cms-truncate
      max-width: 380px
      overflow: hidden
      text-overflow: ellipsis
      white-space: nowrap
      color: var(--ui-fg-3, #a3a3a3)
