import CmsLayout from "site/cms/CmsLayout.arc"
import CmsPageHeader from "site/cms/CmsPageHeader.arc"
import CmsField from "site/cms/CmsField.arc"
import CmsConfirm from "site/cms/CmsConfirm.arc"

page "Edit group - Admin"

  @param id

  @server fn getGroup(groupId: String) -> Any
    const g = db.groups.find(groupId)
    const memberships = db.usergroups.findMany({ where: { groupId: groupId } })
    const members = memberships.map(mem => ({ membershipId: mem.id, userId: mem.userId, name: (db.users.find(mem.userId) ?? {}).name, email: (db.users.find(mem.userId) ?? {}).email }))
    const candidates = db.users.findMany({ limit: 50 })
    return { group: g, members: members, candidates: candidates }

  @live const data = getGroup(id)

  @state let name        = data.group.name
  @state let slug        = data.group.slug
  @state let description = data.group.description
  @state let addUserId   = ""
  @state let deleted     = false
  @state let confirmOpen = ""

  @server fn updateGroup(groupId: String, n: String, s: String, d: String) -> Any
    if !session || session.role != "admin"
      return { error: "forbidden" }
    db.groups.update(groupId, { name: n, slug: s, description: d })
    return { ok: true }

  @server fn addMember(groupId: String, userId: String) -> Any
    if !session || session.role != "admin"
      return { error: "forbidden" }
    db.usergroups.create({ groupId: groupId, userId: userId })
    return { ok: true }

  @server fn removeMember(membershipId: String) -> Any
    if !session || session.role != "admin"
      return { error: "forbidden" }
    db.usergroups.delete(membershipId)
    return { ok: true }

  @server fn deleteGroup(groupId: String) -> Any
    if !session || session.role != "admin"
      return { error: "forbidden" }
    db.groups.delete(groupId)
    db.auditlogs.create({ actorId: session.userId, action: "delete", entityType: "Group", entityId: groupId })
    return { ok: true }

  CmsLayout title="Edit group" active="groups"
    if deleted
      col class="!card" p="24px"
        text "Group deleted."
        link href="/admin/groups"
          button class="!btn !btn--ghost" "Back to groups"

    if !deleted
      CmsPageHeader title="{data.group.name}" subtitle="{data.group.slug}"
        link href="/admin/groups"
          button class="!btn !btn--ghost" "Back"

      col gap="24px"
        col class="!card" p="24px" gap="16px"
          text class="cms-section-title" "Details"
          CmsField label="Name"        name="name" required="true"
          CmsField label="Slug"        name="slug" required="true"
          CmsField label="Description" name="description"
          row
            button class="!btn !btn--primary" on:click={ updateGroup(id, name, slug, description) } "Save"

        col class="!card" p="24px" gap="12px"
          text class="cms-section-title" "Members"
          for member in data.members
            row class="cms-member-row" align="center" justify="space-between"
              col
                text "{member.name}"
                text class="cms-member-email" "{member.email}"
              button class="!btn !btn--ghost !btn--sm" on:click={ removeMember(member.membershipId) } "Remove"
          row class="cms-add-member" gap="8px" align="center"
            select class="!input" bind:value="addUserId"
              option value="" "Add a member..."
              for u in data.candidates
                option value="{u.id}" "{u.name} ({u.email})"
            button class="!btn !btn--primary !btn--sm" on:click={ addMember(id, addUserId); @addUserId = "" } "Add"

        col class="!card" p="24px" gap="12px"
          text class="cms-section-title cms-danger-title" "Danger zone"
          row align="center" justify="space-between"
            col gap="2px"
              text class="cms-danger-label" "Delete this group"
              text class="cms-danger-desc"  "Removes all memberships. Cannot be undone."
            button class="!btn !btn--danger" on:click={ @confirmOpen = "delete-group" } "Delete group"
            CmsConfirm id="delete-group" open="{confirmOpen}" title="Delete this group?" message="Removes all memberships. Cannot be undone."
              button class="!btn !btn--danger" on:click={ @confirmOpen = ""; @deleted = (deleteGroup(id).ok == true) } "Delete"

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
    .cms-member-row
      padding: 8px 0
      border-bottom: 1px solid var(--ui-border, #e5e5e5)
    .cms-member-row:last-child
      border-bottom: none
    .cms-member-email
      font-size: 12px
      color: var(--ui-fg-3, #a3a3a3)
    .cms-add-member
      padding-top: 12px
      border-top: 1px solid var(--ui-border, #e5e5e5)
