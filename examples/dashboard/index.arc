page "Dashboard"
  @state let count = 0
  @server fn getStats() -> { users: Number, posts: Number }
    return { users: 1247, posts: 8392 }

  @server fn incrementCounter(by: Number) -> Number
    return count + by

  header
    heading "Dashboard"

  main
    card
      heading "Stats"
      text "This card's data comes from @server functions via ADP."

    card
      heading "Counter: {count}"
      row
        button on:click={ @count -= 1 } "−"
        button on:click={ @count += 1 } "+"

  footer
    text "Arc — built with @server edge functions."
