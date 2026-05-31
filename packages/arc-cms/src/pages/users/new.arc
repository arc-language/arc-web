import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsField from "@arc-cms/widgets/CmsField.arc"

page "New user - Admin"

  @state let name      = ""
  @state let email     = ""
  @state let role      = "viewer"
  @state let pass      = ""
  @state let created   = ""
  @state let createErr = ""

  @server fn createUser(n: String, e: String, r: String, p: String) -> Any
    if !session || session.role != "admin"
      return { id: "", error: "Not authorized" }
    if p.length < 8
      return { id: "", error: "Password must be at least 8 characters" }
    const existing = db.users.findFirst({ where: { email: e } })
    if existing
      return { id: "", error: "A user with this email already exists" }
    const salt = crypto.randomBytes(16).toString("hex")
    const hash = crypto.scryptSync(p, salt, 64).toString("hex")
    const u = db.users.create({ name: n, email: e, role: r, passwordHash: salt + ":" + hash })
    db.auditlogs.create({ actorId: session.userId, action: "create", entityType: "User", entityId: String(u.id) })
    return { id: String(u.id), error: "" }

  CmsLayout title="New user" active="users"
    CmsPageHeader title="New user"
      link href="/admin/users"
        button class="!btn !btn--ghost" "← Back"

    if created
      col class="!card nu-success" p="24px" gap="16px"
        row gap="10px" align="center"
          div class="nu-check" "✓"
          col gap="2px"
            text class="nu-success-title" "User created"
            text class="nu-success-sub" "The user can now log in with the credentials you set."
        row gap="8px"
          link href="/admin/users/{created}"
            button class="!btn !btn--primary" "View user →"
          button class="!btn !btn--ghost" on:click={ @created = ""; @name = ""; @email = ""; @pass = ""; @createErr = ""; @role = "viewer" } "Create another"

    if !created
      col class="!card" p="24px" gap="20px" style="max-width:560px"
        col gap="16px"
          text class="nu-section" "Profile"
          CmsField label="Name"  name="name"  required="true" placeholder="Full name"
          CmsField label="Email" name="email" type="email" required="true" placeholder="user@example.com"
          col class="!input-wrap"
            text class="!input-label" "Role"
            select class="!input nu-role-select" bind:value="role" aria-label="Role"
              option value="viewer" "Viewer — read-only access"
              option value="editor" "Editor — can create and edit content"
              option value="admin" "Admin — full access"

        col gap="16px"
          text class="nu-section" "Password"
          CmsField label="Password" name="pass" type="password" required="true" hint="At least 8 characters"

        col gap="10px"
          if createErr
            text class="nu-error" "{createErr}"
          button class="!btn !btn--primary" on:click={ @created = createUser(name, email, role, pass).id; @createErr = createUser(name, email, role, pass).error } "Create user"

  design
    .nu-success
      border-color: #bbf7d0
      background: #f0fdf4
    .nu-check
      width: 32px
      height: 32px
      border-radius: 50%
      background: #22c55e
      color: white
      display: flex
      align-items: center
      justify-content: center
      font-size: 16px
      font-weight: 700
      flex-shrink: 0
    .nu-success-title
      font-size: 15px
      font-weight: 700
      color: #15803d
      margin: 0
    .nu-success-sub
      font-size: 13px
      color: #166534
      margin: 0
    .nu-section
      font-size: 11px
      font-weight: 700
      text-transform: uppercase
      letter-spacing: 0.07em
      color: var(--ui-fg-3, #a3a3a3)
      padding-bottom: 8px
      border-bottom: 1px solid var(--ui-border, #e5e7eb)
    .nu-role-select
      width: 100%
    .nu-error
      font-size: 13px
      color: #ef4444
      font-weight: 500
