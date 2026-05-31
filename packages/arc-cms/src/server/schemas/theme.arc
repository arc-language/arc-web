model Theme
  @id let id              = autoincrement()
  @unique let slug        : String
  let name                : String
  let tokens              : String = "{}"
  let createdAt           : DateTime = now()
  let updatedAt           : DateTime = now()
