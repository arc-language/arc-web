page "Counter"
  meta
    favicon "/favicon.png"
  @state let count = 0

  main
    card
      heading "Counter"
      text "{count}"
      row
        button on:click={ @count -= 1 } "−"
        button on:click={ @count += 1 } "+"
      text "Double: {count * 2}"
