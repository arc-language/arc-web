import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsField from "@arc-cms/widgets/CmsField.arc"

page "New theme - Admin"

  @state let name = ""
  @state let slug = ""
  @state let tokens = '{ "accent": "#5b8cff", "bg": "#ffffff", "fg": "#0a0a0a", "fg-2": "#525252", "border": "#e5e5e5" }'
  @state let created = ""

  @server fn createTheme(n: String, s: String, t: String) -> Any
    if !session || session.role != "admin"
      return { error: "forbidden" }
    const existing = db.themes.findFirst({ where: { slug: s } })
    if existing
      return { error: "slug already exists" }
    const th = db.themes.create({ name: n, slug: s, tokens: t })
    db.auditlogs.create({ actorId: session.userId, action: "create", entityType: "Theme", entityId: String(th.id) })
    return { id: th.id }

  CmsLayout title="New theme" active="themes"
    CmsPageHeader title="New theme"
      link href="/admin/themes"
        button class="!btn !btn--ghost" "Cancel"

    col class="!card" p="24px" gap="16px" style="max-width:640px"
      CmsField label="Name" name="name" required="true" placeholder="e.g. Dark mode"
      CmsField label="Slug" name="slug" required="true" placeholder="dark"

      col gap="6px"
        text class="!input-label" "Tokens (JSON)"
        text class="cms-hint" "Keys become CSS variables prefixed with --cms- (e.g. accent → --cms-accent)"
        textarea class="!input cms-mono" bind:value="tokens" rows="10"

      row gap="10px"
        button class="!btn !btn--primary" on:click={ @created = String(createTheme(name, slug, tokens).id) } "Create theme"

  design
    .cms-hint
      font-size: 12px
      color: var(--ui-fg-3, #a3a3a3)
      margin: 0
    .cms-mono
      font-family: ui-monospace, 'SF Mono', Consolas, monospace
      font-size: 12px
