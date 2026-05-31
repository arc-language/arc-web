# CmsNotifications - bell + badge with recent audit entries.
# Read-state is local (localStorage). Click bell -> open panel -> mark all seen.
widget CmsNotifications
  @raw '<details class="cms-notif" id="cms-notif"><summary class="cms-notif-trigger" aria-label="Notifications"><span class="cms-notif-icon">🔔</span><span class="cms-notif-badge" id="cms-notif-badge" hidden></span></summary><div class="cms-notif-panel" role="menu"><div class="cms-notif-head"><div class="cms-notif-title">Activity</div><a href="/admin/audit" class="cms-notif-view-all">View all →</a></div><div class="cms-notif-list" id="cms-notif-list"><div class="cms-notif-empty">No recent activity</div></div></div></details>'

  design
    .cms-notif
      position: relative
    .cms-notif-trigger
      list-style: none
      cursor: pointer
      display: flex
      align-items: center
      justify-content: center
      width: 36px
      height: 36px
      border: 1px solid var(--ui-border, rgba(0,0,0,0.08))
      border-radius: 9px
      color: var(--ui-fg-2, #525252)
      transition: background-color 0.12s, color 0.12s, border-color 0.12s
      position: relative
      font-size: 14px
    .cms-notif-trigger::-webkit-details-marker
      display: none
    .cms-notif-trigger:hover
      background-color: var(--ui-bg-3, #f5f5f5)
      color: var(--ui-fg)
      border-color: var(--brand-from, #00e5ff)
    .cms-notif-icon
      pointer-events: none
    .cms-notif-badge
      position: absolute
      top: 3px
      right: 4px
      min-width: 16px
      height: 16px
      padding: 0 4px
      border-radius: 999px
      background: linear-gradient(135deg, var(--brand-from, #00e5ff), var(--brand-to, #7b2fff))
      color: #020309
      font-size: 9px
      font-weight: 800
      display: flex
      align-items: center
      justify-content: center
      box-shadow: 0 0 0 2px var(--ui-bg-2, #fff)
    .cms-notif-panel
      position: absolute
      top: calc(100% + 8px)
      right: 0
      width: 320px
      max-height: 420px
      display: flex
      flex-direction: column
      background: var(--ui-bg-2, #fff)
      border: 1px solid var(--ui-border, rgba(0,0,0,0.08))
      border-radius: 12px
      box-shadow: 0 12px 36px rgba(0,16,64,0.12)
      z-index: 100
      overflow: hidden
    .cms-notif-head
      display: flex
      align-items: center
      justify-content: space-between
      padding: 12px 14px
      border-bottom: 1px solid var(--ui-border, rgba(0,0,0,0.08))
    .cms-notif-title
      font-size: 13px
      font-weight: 700
      color: var(--ui-fg)
    .cms-notif-view-all
      font-size: 11px
      color: var(--brand-accent, #005fcc)
      text-decoration: none
      font-weight: 600
    .cms-notif-view-all:hover
      text-decoration: underline
    .cms-notif-list
      flex: 1
      overflow-y: auto
      padding: 6px
    .cms-notif-item
      display: flex
      flex-direction: column
      gap: 2px
      padding: 9px 12px
      border-radius: 8px
      font-size: 12px
      color: var(--ui-fg-2)
    .cms-notif-item:hover
      background-color: var(--ui-bg-3, #f5f5f5)
    .cms-notif-item-row
      display: flex
      align-items: center
      gap: 8px
    .cms-notif-action
      font-size: 10px
      font-weight: 700
      letter-spacing: 0.06em
      text-transform: uppercase
      padding: 2px 6px
      border-radius: 4px
      background: var(--ui-bg-3, #f5f5f5)
      color: var(--ui-fg-2)
    .cms-notif-entity
      font-weight: 600
      color: var(--ui-fg)
      font-size: 12px
    .cms-notif-time
      font-size: 10px
      color: var(--ui-fg-3)
    .cms-notif-empty
      padding: 32px 14px
      text-align: center
      font-size: 12px
      color: var(--ui-fg-3)
