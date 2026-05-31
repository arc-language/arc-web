# CmsThemeToggle - light/dark/auto cycle. Persists in localStorage.theme.
# Pair with the no-FOUC init script in CmsLayout that reads theme before paint.
widget CmsThemeToggle
  @raw '<button class="cms-theme-toggle" id="cms-theme-toggle" type="button" aria-label="Toggle theme" title="Theme: auto"><span class="cms-theme-icon" id="cms-theme-icon">◐</span></button>'

  design
    .cms-theme-toggle
      width: 36px
      height: 36px
      display: flex
      align-items: center
      justify-content: center
      background: transparent
      border: 1px solid var(--ui-border, rgba(0,0,0,0.08))
      border-radius: 9px
      cursor: pointer
      color: var(--ui-fg-2, #525252)
      transition: background-color 0.12s, color 0.12s, border-color 0.12s
      font-family: inherit
      font-size: 15px
      line-height: 1
    .cms-theme-toggle:hover
      background-color: var(--ui-bg-3, #f5f5f5)
      color: var(--ui-fg, #0a0a0a)
      border-color: var(--brand-from, #00e5ff)
    .cms-theme-icon
      pointer-events: none
