# CmsUserMenu - avatar + dropdown in the admin topbar.
# Populated by the check-auth fetch in CmsLayout: it sets data attrs on this
# element which the inline script reads on DOMContentLoaded.
widget CmsUserMenu
  @raw '<details class="cms-user-menu" id="cms-user-menu"><summary class="cms-user-menu-trigger" aria-label="User menu"><span class="cms-user-avatar" id="cms-user-avatar" data-initials="?"></span></summary><div class="cms-user-menu-panel" role="menu"><div class="cms-user-menu-head"><div class="cms-user-menu-name" id="cms-user-menu-name">Signed in</div><div class="cms-user-menu-email" id="cms-user-menu-email"></div></div><a href="/admin/profile" class="cms-user-menu-item" role="menuitem">Profile</a><a href="/admin/settings" class="cms-user-menu-item cms-role-admin" role="menuitem">Settings</a><div class="cms-user-menu-sep"></div><a href="/auth/logout" class="cms-user-menu-item cms-user-menu-item-danger" role="menuitem">Sign out</a></div></details>'

  design
    .cms-user-menu
      position: relative
    .cms-user-menu-trigger
      list-style: none
      cursor: pointer
      display: flex
      align-items: center
      padding: 4px
      border-radius: 999px
      transition: background-color 0.15s
    .cms-user-menu-trigger::-webkit-details-marker
      display: none
    .cms-user-menu-trigger:hover
      background-color: rgba(0,0,0,0.04)
    .cms-user-avatar
      width: 32px
      height: 32px
      border-radius: 50%
      background: linear-gradient(135deg, var(--brand-from, #00e5ff), var(--brand-to, #7b2fff))
      color: #020309
      display: flex
      align-items: center
      justify-content: center
      font-size: 12px
      font-weight: 800
      letter-spacing: -0.02em
      box-shadow: 0 2px 8px rgba(0,229,255,0.25)
    .cms-user-avatar::after
      content: attr(data-initials)
    .cms-user-menu-panel
      position: absolute
      top: calc(100% + 8px)
      right: 0
      min-width: 220px
      padding: 6px
      background: var(--ui-bg-2, #fff)
      border: 1px solid var(--ui-border, rgba(0,0,0,0.08))
      border-radius: 12px
      box-shadow: 0 12px 36px rgba(0,16,64,0.12)
      z-index: 100
      display: flex
      flex-direction: column
      gap: 1px
    .cms-user-menu-head
      padding: 10px 12px 12px
      border-bottom: 1px solid var(--ui-border, rgba(0,0,0,0.08))
      margin-bottom: 4px
    .cms-user-menu-name
      font-size: 13px
      font-weight: 600
      color: var(--ui-fg, #0a0a0a)
    .cms-user-menu-email
      font-size: 11px
      color: var(--ui-fg-3, #a3a3a3)
      margin-top: 2px
      overflow: hidden
      text-overflow: ellipsis
      white-space: nowrap
    .cms-user-menu-item
      display: block
      padding: 8px 12px
      border-radius: 8px
      font-size: 13px
      color: var(--ui-fg-2, #525252)
      text-decoration: none
      transition: background-color 0.12s, color 0.12s
    .cms-user-menu-item:hover
      background-color: var(--ui-bg-3, #f5f5f5)
      color: var(--ui-fg, #0a0a0a)
    .cms-user-menu-sep
      height: 1px
      background-color: var(--ui-border, rgba(0,0,0,0.08))
      margin: 4px 0
    .cms-user-menu-item-danger
      color: #ef4444
    .cms-user-menu-item-danger:hover
      background-color: rgba(239,68,68,0.08)
      color: #ef4444
