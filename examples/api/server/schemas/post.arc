model Post
  @id let id = autoincrement()
  let title: String
  let body: String
  let published: Bool = false
  let createdAt: DateTime = now()
