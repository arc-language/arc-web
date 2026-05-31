import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsField from "@arc-cms/widgets/CmsField.arc"

page "Profile - Admin"

  @server fn me() -> Any
    if !session
      return { error: "unauthorized", user: { name: "", email: "" } }
    return { user: db.users.find(session.userId) }

  @live const data = me()

  @state let name  = data.user.name
  @state let email = data.user.email
  @state let pass  = ""
  @state let saved = false

  @server fn saveProfile(n: String, e: String) -> Any
    if !session
      return { error: "unauthorized" }
    db.users.update(session.userId, { name: n, email: e })
    db.auditlogs.create({ actorId: session.userId, action: "update", entityType: "User", entityId: String(session.userId) })
    return { ok: true }

  @server fn changePassword(pw: String) -> Any
    if !session
      return { error: "unauthorized" }
    if pw.length < 8
      return { error: "Password must be at least 8 characters" }
    const salt = crypto.randomBytes(16).toString("hex")
    const hash = crypto.scryptSync(pw, salt, 64).toString("hex")
    db.users.update(session.userId, { passwordHash: salt + ":" + hash })
    return { ok: true }

  CmsLayout title="Profile" active="profile"
    CmsPageHeader title="Your profile" subtitle="Signed in as {data.user.email}"

    col gap="24px" style="max-width:560px"
      col class="!card" p="24px" gap="16px"
        text class="cms-section-title" "Account"
        CmsField label="Name"  name="name"
        CmsField label="Email" name="email" type="email"
        row gap="10px"
          button class="!btn !btn--primary" on:click={ @saved = (saveProfile(name, email).ok == true) } "Save"
          if saved
            text class="cms-hint" "Saved"

      col class="!card" p="24px" gap="16px"
        text class="cms-section-title" "Change password"
        CmsField label="New password" name="pass" type="password" hint="Minimum 8 characters"
        row
          button class="!btn !btn--primary" on:click={ changePassword(pass); @pass = "" } "Update password"

  design
    .cms-section-title
      font-size: 13px
      font-weight: 600
      margin: 0
    .cms-hint
      font-size: 12px
      color: var(--ui-fg-3, #a3a3a3)
      margin: 0
