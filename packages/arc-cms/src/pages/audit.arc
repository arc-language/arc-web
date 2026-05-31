import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsEmpty from "@arc-cms/widgets/CmsEmpty.arc"

page "Audit log - Admin"

  @server fn listAudit() -> Any
    return { rows: db.auditlogs.findMany({ limit: 200, orderBy: { at: "desc" } }) }

  @live const data = listAudit()

  CmsLayout title="Audit log" active="audit"
    CmsPageHeader title="Audit log" subtitle="{data.rows.length} recent events"

    if data.rows.length == 0
      CmsEmpty title="No events yet" body="Audit entries appear here as mutations happen across the admin panel." icon="≡"
    else
      col class="!table-wrap"
        table class="!table"
          thead
            tr
              th "When"
              th "Actor"
              th "Action"
              th "Entity"
              th "Details"
          tbody
            for row in data.rows
              tr
                td class="cms-mono" "{row.at}"
                td "{row.actorId}"
                td
                  text class="!badge !badge--info" "{row.action}"
                td "{row.entityType} #{row.entityId}"
                td class="cms-mono cms-truncate" "{row.after}"

  design
    .cms-mono
      font-family: ui-monospace, 'SF Mono', Consolas, monospace
      font-size: 12px
    .cms-truncate
      max-width: 320px
      overflow: hidden
      text-overflow: ellipsis
      white-space: nowrap
      color: var(--ui-fg-3, #a3a3a3)
