import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsField from "site/cms/CmsField.arc"
import CmsConfirm from "site/cms/CmsConfirm.arc"

# Phase 4 will replace the JSON textarea with a schema-driven per-type form
# and add a live-preview iframe pane.
page "Edit block - Admin"

  @param id

  @server fn getBlock(blockId: String) -> Any
    return { block: db.pageblocks.find(blockId) }

  @live const data = getBlock(id)

  @state let pageName  = data.block.page
  @state let blockType = data.block.type
  @state let visible   = data.block.visible
  @state let order     = data.block.order
  @state let dataJson  = data.block.data
  @state let deleted     = false
  @state let confirmOpen = ""

  @server fn updateBlock(blockId: String, p: String, t: String, v: Bool, o: Int, d: String) -> Any
    if !session || (session.role != "admin" && session.role != "editor")
      return { error: "forbidden" }
    db.pageblocks.update(blockId, { page: p, type: t, visible: v, order: o, data: d })
    db.auditlogs.create({ actorId: session.userId, action: "update", entityType: "PageBlock", entityId: blockId })
    return { ok: true }

  @server fn deleteBlock(blockId: String) -> Any
    if !session || (session.role != "admin" && session.role != "editor")
      return { error: "forbidden" }
    db.pageblocks.delete(blockId)
    db.auditlogs.create({ actorId: session.userId, action: "delete", entityType: "PageBlock", entityId: blockId })
    return { ok: true }

  CmsLayout title="Edit block" active="blocks"
    if deleted
      col class="!card" p="24px"
        text "Block deleted."
        link href="/admin/blocks"
          button class="!btn !btn--ghost" "Back to blocks"

    if !deleted
      CmsPageHeader title="Edit block" subtitle="{data.block.type} on {data.block.page}"
        link href="/admin/blocks"
          button class="!btn !btn--ghost" "Back"

      col gap="24px"
        col class="!card" p="24px" gap="16px"
          row gap="16px"
            col style="flex:1"
              CmsField label="Page" name="pageName" required="true"
            col style="flex:1"
              CmsField label="Type" name="blockType" required="true"
          row gap="16px" align="center"
            col style="flex:1"
              CmsField label="Order" name="order" type="number"
            row gap="10px" align="center" style="padding-top:24px"
              input type="checkbox" bind:checked="visible"
              text class="!input-label" "Visible"

          col gap="6px"
            text class="!input-label" "Data (JSON)"
            textarea class="!input" bind:value="dataJson" rows="12"

          row
            button class="!btn !btn--primary" on:click={ updateBlock(id, pageName, blockType, visible, order, dataJson) } "Save changes"

        col class="!card" p="24px" gap="12px"
          text class="cms-section-title cms-danger-title" "Danger zone"
          row align="center" justify="space-between"
            col gap="2px"
              text class="cms-danger-label" "Delete this block"
              text class="cms-danger-desc"  "Cannot be undone."
            button class="!btn !btn--danger" on:click={ @confirmOpen = "delete-block" } "Delete block"
            CmsConfirm id="delete-block" open="{confirmOpen}" title="Delete this block?" message="Cannot be undone."
              button class="!btn !btn--danger" on:click={ @confirmOpen = ""; @deleted = (deleteBlock(id).ok == true) } "Delete"

  design
    .cms-section-title
      font-size: 13px
      font-weight: 600
      margin: 0
    .cms-danger-title
      color: #ef4444
    .cms-danger-label
      font-size: 13px
      font-weight: 500
      margin: 0
    .cms-danger-desc
      font-size: 12px
      color: var(--ui-fg-3, #a3a3a3)
      margin: 0
