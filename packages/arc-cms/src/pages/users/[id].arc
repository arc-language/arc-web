import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsField from "@arc-cms/widgets/CmsField.arc"
import CmsConfirm from "@arc-cms/widgets/CmsConfirm.arc"

page "Edit user - Admin"

  @param id

  @server fn getUser(userId: String) -> Any
    return { user: db.users.find(userId) }

  @live const data = getUser(id)

  @state let name     = data.user.name
  @state let email    = data.user.email
  @state let role     = data.user.role
  @state let newPass  = ""
  @state let deleted      = false
  @state let confirmOpen  = ""

  @server fn updateUser(userId: String, n: String, e: String, r: String) -> Any
    if !session || session.role != "admin"
      return { error: "forbidden" }
    db.users.update(userId, { name: n, email: e, role: r })
    db.auditlogs.create({ actorId: session.userId, action: "update", entityType: "User", entityId: userId, after: JSON.stringify({ name: n, email: e, role: r }) })
    return { ok: true }

  @server fn setPassword(userId: String, pw: String) -> Any
    if !session || session.role != "admin"
      return { error: "forbidden" }
    const salt = crypto.randomBytes(16).toString("hex")
    const hash = crypto.scryptSync(pw, salt, 64).toString("hex")
    db.users.update(userId, { passwordHash: salt + ":" + hash })
    return { ok: true }

  @server fn deleteUser(userId: String) -> Any
    if !session || session.role != "admin"
      return { error: "forbidden" }
    db.users.delete(userId)
    db.auditlogs.create({ actorId: session.userId, action: "delete", entityType: "User", entityId: userId })
    return { ok: true }

  CmsLayout title="Edit user" active="users"
    if deleted
      col class="!card" p="24px" gap="12px"
        text "User deleted."
        link href="/admin/users"
          button class="!btn !btn--ghost" "Back to users"

    if !deleted
      CmsPageHeader title="{data.user.name}" subtitle="{data.user.email}"
        link href="/admin/users"
          button class="!btn !btn--ghost" "Back"

      col gap="24px"
        col class="!card" p="24px" gap="16px"
          text class="cms-section-title" "Profile"
          CmsField label="Name"  name="name"  required="true"
          CmsField label="Email" name="email" type="email" required="true"
          CmsField label="Role"  name="role"  hint="One of: admin, editor, viewer"
          row gap="10px"
            button class="!btn !btn--primary" on:click={ updateUser(id, name, email, role) } "Save"

        col class="!card" p="24px" gap="16px"
          text class="cms-section-title" "Set password"
          CmsField label="New password" name="newPass" type="password" hint="Leave blank to keep existing"
          row gap="10px"
            button class="!btn !btn--primary" on:click={ setPassword(id, newPass); @newPass = "" } "Update password"

        col class="!card" p="24px" gap="12px" style="border-color:rgba(239,68,68,0.3)"
          text class="cms-section-title cms-danger-title" "Danger zone"
          row align="center" justify="space-between"
            col gap="2px"
              text class="cms-danger-label" "Delete this user"
              text class="cms-danger-desc"  "This cannot be undone."
            button class="!btn !btn--danger" on:click={ @confirmOpen = "delete-user" } "Delete user"
            CmsConfirm id="delete-user" open="{confirmOpen}" title="Delete this user?" message="This cannot be undone."
              button class="!btn !btn--danger" on:click={ @confirmOpen = ""; @deleted = (deleteUser(id).ok == true) } "Delete"

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
