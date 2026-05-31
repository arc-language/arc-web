model Media
  @id let id        = autoincrement()
  let filename      : String
  let url           : String
  let mime          : String
  let size          : Int
  let uploadedBy    : Int?
  let createdAt     : DateTime = now()
