# CmsSearch - command-palette-style search.
# Trigger button + hidden modal. ⌘K / Ctrl+K opens. Esc closes.
# Hits /admin/api/search?q=... and renders grouped results.
widget CmsSearch
  @raw '<button class="cms-search-trigger" id="cms-search-trigger" type="button" aria-label="Search"><span class="cms-search-icon">⌕</span><span class="cms-search-placeholder">Search…</span><kbd class="cms-search-kbd">⌘K</kbd></button><div class="cms-search-backdrop" id="cms-search-backdrop" hidden></div><div class="cms-search-palette" id="cms-search-palette" hidden role="dialog" aria-modal="true" aria-label="Search"><input class="cms-search-input" id="cms-search-input" type="text" placeholder="Search pages, blocks, users, media…" autocomplete="off" spellcheck="false"><div class="cms-search-results" id="cms-search-results"></div><div class="cms-search-foot">↑↓ navigate · ↵ open · esc close</div></div>'

  design
    .cms-search-trigger
      display: flex
      align-items: center
      gap: 10px
      padding: 7px 12px
      min-width: 240px
      background: var(--ui-bg-3, #f5f5f5)
      border: 1px solid var(--ui-border, rgba(0,0,0,0.08))
      border-radius: 10px
      color: var(--ui-fg-3, #a3a3a3)
      cursor: pointer
      font-family: inherit
      font-size: 13px
      transition: border-color 0.12s, background-color 0.12s
    .cms-search-trigger:hover
      border-color: var(--brand-from, #00e5ff)
      background: var(--ui-bg-2, #fff)
    .cms-search-icon
      font-size: 15px
      color: var(--ui-fg-3)
    .cms-search-placeholder
      flex: 1
      text-align: left
    .cms-search-kbd
      font-family: ui-monospace, 'SF Mono', Consolas, monospace
      font-size: 10px
      padding: 2px 5px
      border-radius: 4px
      background: var(--ui-bg, #fff)
      border: 1px solid var(--ui-border, rgba(0,0,0,0.08))
      color: var(--ui-fg-2)

    .cms-search-backdrop
      position: fixed
      inset: 0
      background-color: rgba(0,0,0,0.32)
      backdrop-filter: blur(2px)
      z-index: 9990
    .cms-search-palette
      position: fixed
      top: 80px
      left: 50%
      transform: translateX(-50%)
      width: min(560px, calc(100vw - 32px))
      max-height: 480px
      display: flex
      flex-direction: column
      background: var(--ui-bg-2, #fff)
      border: 1px solid var(--ui-border, rgba(0,0,0,0.08))
      border-radius: 14px
      box-shadow: 0 24px 64px rgba(0,16,64,0.18)
      z-index: 9991
      overflow: hidden
    .cms-search-input
      padding: 16px 18px
      font-size: 15px
      border: none
      border-bottom: 1px solid var(--ui-border, rgba(0,0,0,0.08))
      background: transparent
      color: var(--ui-fg, #0a0a0a)
      font-family: inherit
      outline: none
    .cms-search-input::placeholder
      color: var(--ui-fg-3)
    .cms-search-results
      flex: 1
      overflow-y: auto
      padding: 6px
    .cms-search-group
      font-size: 10px
      font-weight: 700
      letter-spacing: 0.12em
      text-transform: uppercase
      color: var(--ui-fg-3)
      padding: 10px 12px 6px
    .cms-search-item
      display: flex
      align-items: center
      gap: 12px
      padding: 9px 12px
      border-radius: 8px
      font-size: 13px
      color: var(--ui-fg, #0a0a0a)
      text-decoration: none
      cursor: pointer
    .cms-search-item:hover
      background-color: var(--ui-bg-3, #f5f5f5)
    .cms-search-item.is-selected
      background: linear-gradient(90deg, color-mix(in oklch, var(--brand-from, #00e5ff), transparent 88%), transparent)
      color: var(--brand-accent, #005fcc)
    .cms-search-item-icon
      width: 24px
      height: 24px
      display: flex
      align-items: center
      justify-content: center
      border-radius: 6px
      background: var(--ui-bg-3, #f5f5f5)
      flex-shrink: 0
      font-size: 13px
    .cms-search-item-label
      flex: 1
      overflow: hidden
      text-overflow: ellipsis
      white-space: nowrap
    .cms-search-item-meta
      font-size: 11px
      color: var(--ui-fg-3)
    .cms-search-empty
      padding: 32px 18px
      text-align: center
      font-size: 13px
      color: var(--ui-fg-3)
    .cms-search-foot
      padding: 10px 14px
      border-top: 1px solid var(--ui-border, rgba(0,0,0,0.08))
      font-size: 11px
      color: var(--ui-fg-3)
      font-family: ui-monospace, 'SF Mono', Consolas, monospace
