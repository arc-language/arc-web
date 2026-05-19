page "Arc Blog"
  @build const posts = [
    { title: "Hello, Arc", date: "2026-01-01", excerpt: "Arc is a new language for the web. Write less, ship faster, load instantly." },
    { title: "Zero JavaScript", date: "2026-01-15", excerpt: "Static pages in Arc ship with exactly 0 bytes of JavaScript. Not minified — zero." },
    { title: "The Four Data Contexts", date: "2026-02-01", excerpt: "Every piece of web data is @build, @state, @live, or @realtime. Arc names them." },
    { title: "ADP: Replacing JSON", date: "2026-02-15", excerpt: "Binary encoding. 3x smaller. 10x faster to decode. Zero boilerplate." }
  ]

  header
    heading "Arc Blog"
    text "{posts.length} posts"

  main
    for post in posts
      card
        heading "{post.title}"
        text "{post.date}"
        text "{post.excerpt}"

  footer
    text "Built with Arc at compile time. Zero JavaScript shipped."
