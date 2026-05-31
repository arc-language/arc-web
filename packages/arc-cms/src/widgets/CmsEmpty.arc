# CmsEmpty - empty-state placeholder using arc-ui .empty-state.
widget CmsEmpty(title: String, body: String = "", icon: String = "○")
  col class="!empty-state !empty-state--card" align="center"
    text class="!empty-state__icon" "{icon}"
    text class="!empty-state__title" "{title}"
    if body
      text class="!empty-state__body" "{body}"
    col class="!empty-state__action"
      @slot
