import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsField from "@arc-cms/widgets/CmsField.arc"

page "Settings - Admin"

  @server fn getConfig() -> Any
    const existing = db.siteconfigs.findFirst({})
    if existing
      return { cfg: existing }
    const fresh = db.siteconfigs.create({ siteName: "Arc Site", primaryColor: "#5b8cff" })
    return { cfg: fresh }

  @live const data = getConfig()

  @state let siteName     = data.cfg.siteName
  @state let ogImage      = data.cfg.ogImage ?? ""
  @state let primaryColor = data.cfg.primaryColor
  @state let saved        = false

  @server fn saveConfig(cfgId: Int, n: String, og: String, pc: String) -> Any
    if !session || session.role != "admin"
      return { error: "forbidden" }
    db.siteconfigs.update(cfgId, { siteName: n, ogImage: og, primaryColor: pc, updatedAt: now() })
    db.auditlogs.create({ actorId: session.userId, action: "update", entityType: "SiteConfig", entityId: String(cfgId), after: JSON.stringify({ siteName: n, ogImage: og, primaryColor: pc }) })
    return { ok: true }

  CmsLayout title="Settings" active="settings"
    CmsPageHeader title="Site settings" subtitle="Branding and SEO defaults"

    col class="!card" p="24px" gap="16px" style="max-width:560px"
      CmsField label="Site name"     name="siteName"
      CmsField label="Default OG image URL" name="ogImage" hint="Used when a page omits its own og:image"
      CmsField label="Primary color" name="primaryColor" hint="Hex e.g. #5b8cff"
      row gap="10px"
        button class="!btn !btn--primary" on:click={ @saved = (saveConfig(data.cfg.id, siteName, ogImage, primaryColor).ok == true) } "Save settings"
        if saved
          text class="cms-hint" "Saved"

  design
    .cms-hint
      font-size: 12px
      color: var(--ui-fg-3, #a3a3a3)
      margin: 0
