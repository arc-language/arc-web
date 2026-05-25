job NotifySubscribers(postId: Int)
  const post = db.posts.find(postId)
  console.log("notifying subscribers for post", postId)
  email.send({ to: "subscribers@example.com", subject: "New post published", text: "A new post is available" })
