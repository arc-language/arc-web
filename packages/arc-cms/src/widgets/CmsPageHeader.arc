# CmsPageHeader - title row with subtitle + action slot.
widget CmsPageHeader(title: String, subtitle: String = "")
  row class="cms-pageheader" justify="space-between" align="center"
    col gap="4px"
      text class="cms-pageheader-title" "{title}"
      if subtitle
        text class="cms-pageheader-subtitle" "{subtitle}"
    row class="cms-pageheader-actions" gap="8px" align="center"
      @slot

  design
    .cms-pageheader
      margin-bottom: 8px
    .cms-pageheader-title
      font-size: 20px
      font-weight: 700
      letter-spacing: -0.02em
      margin: 0
    .cms-pageheader-subtitle
      font-size: 13px
      color: var(--ui-fg-3, #a3a3a3)
      margin: 0
    .cms-pageheader-actions
      flex-wrap: wrap
