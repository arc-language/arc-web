import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsField from "@arc-cms/widgets/CmsField.arc"

# Phase 4 will replace the JSON textarea with a schema-driven per-type form.
page "New block - Admin"

  @state let pageName = ""
  @state let blockType = "text"
  @state let visible = true
  @state let dataJson = "{}"
  @state let created = ""

  @server fn createBlock(p: String, t: String, v: Bool, d: String) -> Any
    if !session || (session.role != "admin" && session.role != "editor")
      return { error: "forbidden" }
    const maxOrder = db.pageblocks.count({ where: { page: p } })
    const blk = db.pageblocks.create({ page: p, type: t, visible: v, order: maxOrder, data: d })
    db.auditlogs.create({ actorId: session.userId, action: "create", entityType: "PageBlock", entityId: String(blk.id) })
    return { id: blk.id }

  CmsLayout title="New block" active="blocks"
    CmsPageHeader title="New block"
      link href="/admin/blocks"
        button class="!btn !btn--ghost" "Cancel"

    col class="!card" p="24px" gap="16px" style="max-width:640px"
      CmsField label="Page slug" name="pageName" required="true" hint="e.g. home, about, docs/intro"

      col gap="6px"
        text class="!input-label !input-label--required" "Type"
        select class="!input" bind:value="blockType"
          option value="text" "Text"
          option value="hero" "Hero"
          option value="features" "Features"
          option value="cta" "Call to action"
          option value="code" "Code"
          option value="faq" "FAQ"

      row gap="10px" align="center"
        input type="checkbox" bind:checked="visible"
        text class="!input-label" "Visible"

      col gap="6px"
        text class="!input-label" "Data (JSON)"
        textarea class="!input" bind:value="dataJson" rows="6"

      row gap="10px"
        button class="!btn !btn--primary" on:click={ @created = (createBlock(pageName, blockType, visible, dataJson).id) } "Create block"
      if created
        text "Created: {created}"
