# CmsLangSelect - sets a `lang` cookie + localStorage.locale, then reloads.
# Translations themselves are project-owned; this widget only manages the choice.
# Add or remove options below to match your supported locales.
widget CmsLangSelect
  @raw '<details class="cms-lang"><summary class="cms-lang-trigger" aria-label="Language"><span class="cms-lang-icon">🌐</span><span class="cms-lang-current" id="cms-lang-current">EN</span></summary><div class="cms-lang-panel" role="menu"><button class="cms-lang-item" type="button" data-locale="en" role="menuitem"><span class="cms-lang-flag">🇬🇧</span> English</button><button class="cms-lang-item" type="button" data-locale="es" role="menuitem"><span class="cms-lang-flag">🇪🇸</span> Español</button><button class="cms-lang-item" type="button" data-locale="fr" role="menuitem"><span class="cms-lang-flag">🇫🇷</span> Français</button><button class="cms-lang-item" type="button" data-locale="nl" role="menuitem"><span class="cms-lang-flag">🇳🇱</span> Nederlands</button><button class="cms-lang-item" type="button" data-locale="de" role="menuitem"><span class="cms-lang-flag">🇩🇪</span> Deutsch</button></div></details>'

  design
    .cms-lang
      position: relative
    .cms-lang-trigger
      list-style: none
      cursor: pointer
      display: flex
      align-items: center
      gap: 6px
      padding: 7px 10px
      border: 1px solid var(--ui-border, rgba(0,0,0,0.08))
      border-radius: 9px
      color: var(--ui-fg-2, #525252)
      transition: background-color 0.12s, color 0.12s, border-color 0.12s
      font-size: 12px
      font-weight: 600
    .cms-lang-trigger::-webkit-details-marker
      display: none
    .cms-lang-trigger:hover
      background-color: var(--ui-bg-3, #f5f5f5)
      color: var(--ui-fg)
      border-color: var(--brand-from, #00e5ff)
    .cms-lang-icon
      font-size: 13px
    .cms-lang-current
      letter-spacing: 0.05em
    .cms-lang-panel
      position: absolute
      top: calc(100% + 8px)
      right: 0
      min-width: 180px
      padding: 6px
      background: var(--ui-bg-2, #fff)
      border: 1px solid var(--ui-border, rgba(0,0,0,0.08))
      border-radius: 12px
      box-shadow: 0 12px 36px rgba(0,16,64,0.12)
      z-index: 100
      display: flex
      flex-direction: column
      gap: 1px
    .cms-lang-item
      display: flex
      align-items: center
      gap: 10px
      padding: 8px 12px
      border-radius: 8px
      font-size: 13px
      color: var(--ui-fg-2)
      background: none
      border: none
      cursor: pointer
      font-family: inherit
      text-align: left
      transition: background-color 0.12s, color 0.12s
    .cms-lang-item:hover
      background-color: var(--ui-bg-3, #f5f5f5)
      color: var(--ui-fg)
    .cms-lang-item.is-active
      background-color: color-mix(in oklch, var(--brand-from, #00e5ff), transparent 90%)
      color: var(--brand-accent, #005fcc)
      font-weight: 600
    .cms-lang-flag
      font-size: 16px
      line-height: 1
