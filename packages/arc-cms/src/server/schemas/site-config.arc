model SiteConfig
  @id let id          = autoincrement()
  let siteName        : String = "Arc Site"
  let ogImage         : String?
  let primaryColor    : String = "#5b8cff"
  let updatedAt       : DateTime = now()
