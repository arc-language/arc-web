page "Dashboard"
  @server fn getUser(id: String) -> { name: String, role: String }
    return { name: "Alex Chen", role: "admin" }

  @server fn getStats() -> { users: Number, posts: Number, revenue: Number }
    return { users: 12483, posts: 3721, revenue: 94200 }

  @live let user = getUser("current")
  @live let stats = getStats()

  @state let activeTab = "overview"

  header
    heading "Dashboard"
    text "Welcome back, {user.name}"

  main
    row
      card
        heading "Users"
        text "{stats.users}"
      card
        heading "Posts"
        text "{stats.posts}"
      card
        heading "Revenue"
        text "${stats.revenue}"

    card
      row
        button on:click={ @activeTab = "overview" } "Overview"
        button on:click={ @activeTab = "analytics" } "Analytics"

      text "Tab: {activeTab}"
