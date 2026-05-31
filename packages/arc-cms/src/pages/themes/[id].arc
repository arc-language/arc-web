import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsField from "@arc-cms/widgets/CmsField.arc"

page "Edit theme - Admin"

  @param id

  @server fn getTheme(themeId: String) -> Any
    return { theme: db.themes.find(themeId) }

  @live const data = getTheme(id)

  @state let name   = data.theme.name
  @state let slug   = data.theme.slug
  @state let tokens = data.theme.tokens
  @state let deleted = false

  @server fn updateTheme(themeId: String, n: String, s: String, t: String) -> Any
    if !session || session.role != "admin"
      return { error: "forbidden" }
    db.themes.update(themeId, { name: n, slug: s, tokens: t, updatedAt: now() })
    db.auditlogs.create({ actorId: session.userId, action: "update", entityType: "Theme", entityId: themeId })
    return { ok: true }

  @server fn deleteTheme(themeId: String) -> Any
    if !session || session.role != "admin"
      return { error: "forbidden" }
    db.themes.delete(themeId)
    db.auditlogs.create({ actorId: session.userId, action: "delete", entityType: "Theme", entityId: themeId })
    return { ok: true }

  CmsLayout title="Edit theme" active="themes"
    if deleted
      col class="!card" p="24px"
        text "Theme deleted."
        link href="/admin/themes"
          button class="!btn !btn--ghost" "Back to themes"

    if !deleted
      CmsPageHeader title="{data.theme.name}" subtitle="{data.theme.slug}"
        link href="/admin/themes"
          button class="!btn !btn--ghost" "Back"

      col gap="24px" style="max-width:640px"
        col class="!card" p="24px" gap="14px"
          CmsField label="Name" name="name" required="true"
          CmsField label="Slug" name="slug" required="true"
          col gap="6px"
            text class="!input-label" "Tokens (JSON)"
            text class="cms-hint" "Each key becomes --cms-<key> in CSS"
            textarea class="!input cms-mono" bind:value="tokens" rows="14"
          row
            button class="!btn !btn--primary" on:click={ updateTheme(id, name, slug, tokens) } "Save"

        col class="!card" p="24px" gap="12px"
          text class="cms-section cms-danger" "Danger zone"
          row align="center" justify="space-between"
            text "Delete this theme"
            button class="!btn !btn--danger" on:click={ @deleted = (confirm("Delete theme?") && deleteTheme(id).ok == true) } "Delete"

  design
    .cms-section
      font-size: 13px
      font-weight: 600
      margin: 0
    .cms-danger
      color: #ef4444
    .cms-hint
      font-size: 12px
      color: var(--ui-fg-3, #a3a3a3)
      margin: 0
    .cms-mono
      font-family: ui-monospace, 'SF Mono', Consolas, monospace
      font-size: 12px
