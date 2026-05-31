import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsEmpty from "@arc-cms/widgets/CmsEmpty.arc"

page "Blocks - Admin"

  @state let pageFilter = "all"

  @server fn listBlocks(pf: String) -> Any
    const where = pf == "all" ? {} : { page: pf }
    return {
      rows: db.pageblocks.findMany({ where: where, orderBy: { order: "asc" } }),
      total: db.pageblocks.count(),
      slugs: [...new Set(db.pageblocks.findMany({}).map(b => b.page))].sort()
    }

  @live const data = listBlocks(pageFilter)

  CmsLayout title="Blocks" active="blocks"
    CmsPageHeader title="Blocks" subtitle="{data.rows.length} of {data.total} blocks"
      select class="!input" bind:value="pageFilter"
        option value="all" "All pages"
        for s in data.slugs
          option value="{s}" "{s}"
      link href="/admin/blocks/new"
        button class="!btn !btn--primary" "+ New block"

    if data.rows.length == 0
      CmsEmpty title="No blocks" body="Create the first one to start building pages." icon="◫"
        link href="/admin/blocks/new"
          button class="!btn !btn--primary" "+ New block"
    else
      col class="!table-wrap"
        table class="!table"
          thead
            tr
              th "Page"
              th "Type"
              th "Order"
              th "Visible"
              th ""
          tbody
            for b in data.rows
              tr
                td
                  text class="!badge" "{b.page}"
                td
                  text class="!badge !badge--info" "{b.type}"
                td "{b.order}"
                td "{b.visible}"
                td
                  link href="/admin/blocks/{b.id}"
                    button class="!btn !btn--ghost !btn--sm" "Edit"
