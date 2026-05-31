import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsField from "@arc-cms/widgets/CmsField.arc"

page "New group - Admin"

  @state let name        = ""
  @state let slug        = ""
  @state let description = ""
  @state let created     = ""
  @state let createErr   = ""

  @server fn createGroup(n: String, s: String, d: String) -> Any
    if !session || session.role != "admin"
      return { id: "", error: "Not authorized" }
    if n == ""
      return { id: "", error: "Name is required" }
    if s == ""
      return { id: "", error: "Slug is required" }
    const existing = db.groups.findFirst({ where: { slug: s } })
    if existing
      return { id: "", error: "A group with this slug already exists" }
    const g = db.groups.create({ name: n, slug: s, description: d })
    db.auditlogs.create({ actorId: session.userId, action: "create", entityType: "Group", entityId: String(g.id) })
    return { id: String(g.id), error: "" }

  CmsLayout title="New group" active="groups"
    CmsPageHeader title="New group"
      link href="/admin/groups"
        button class="!btn !btn--ghost" "← Back"

    if created
      col class="!card ng-success" p="24px" gap="16px"
        row gap="10px" align="center"
          div class="ng-check" "✓"
          col gap="2px"
            text class="ng-success-title" "Group created"
            text class="ng-success-sub" "You can now add members and assign permissions."
        row gap="8px"
          link href="/admin/groups/{created}"
            button class="!btn !btn--primary" "Manage group →"
          button class="!btn !btn--ghost" on:click={ @created = ""; @name = ""; @slug = ""; @description = ""; @createErr = "" } "Create another"

    if !created
      col class="!card" p="24px" gap="16px" style="max-width:560px"
        CmsField label="Name"        name="name"        required="true" placeholder="e.g. Editors"
        CmsField label="Slug"        name="slug"        required="true" placeholder="e.g. editors" hint="Lowercase letters, numbers, and hyphens only"
        CmsField label="Description" name="description" placeholder="Optional — what is this group for?"
        col gap="10px"
          if createErr
            text class="ng-error" "{createErr}"
          button class="!btn !btn--primary" on:click={ @created = createGroup(name, slug, description).id; @createErr = createGroup(name, slug, description).error } "Create group"

  design
    .ng-success
      border-color: #bbf7d0
      background: #f0fdf4
    .ng-check
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
    .ng-success-title
      font-size: 15px
      font-weight: 700
      color: #15803d
      margin: 0
    .ng-success-sub
      font-size: 13px
      color: #166534
      margin: 0
    .ng-error
      font-size: 13px
      color: #ef4444
      font-weight: 500
