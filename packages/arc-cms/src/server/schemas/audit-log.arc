model AuditLog
  @id let id          = autoincrement()
  let actorId         : Int?
  let action          : String
  let entityType      : String
  let entityId        : String?
  let after           : String?
  let at              : DateTime = now()
