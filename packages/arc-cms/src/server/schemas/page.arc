model Page
  @id let id              = autoincrement()
  @unique let slug        : String
  let title               : String
  let metaDescription     : String?
  let ogImage             : String?
  let layout              : String = "default"
  let themeId             : Int?
  let parentId            : Int?
  let navLabel            : String?
  let navOrder            : Int = 0
  let showInNav           : Bool = true
  let published           : Bool = false
  let createdAt           : DateTime = now()
  let updatedAt           : DateTime = now()
