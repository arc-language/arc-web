# Your First Page

A 5-minute tour from "hello world" to a real interactive app. By the end you'll understand the three things Arc does that no other framework does the same way.

## 1. Hello, Arc

Create `index.arc`:

```arc
page "Hello"
  main
    heading "Hello, Arc"
    text "Built from scratch. Zero dependencies. Zero runtime."
```

Build:

```bash
arc build
```

Output:

```
arc: built index.arc
  HTML  891 bytes
  CSS   1.3 KB
  JS    0 bytes (static)
  → dist/
```

Open `dist/index.html`. **Zero JavaScript** was shipped. The page is semantic HTML with scoped CSS and CSP, OG, accessibility defaults all auto-applied.

## 2. Add reactivity (`@state`)

```arc
page "Counter"
  @state let count = 0

  main
    card
      heading "Counter: {count}"
      row
        button on:click={ @count -= 1 } "−"
        button on:click={ @count += 1 } "+"
      text "Doubled: {count * 2}"
```

Build again. Now you'll see:

```
  JS    478 bytes
```

That JS is **direct DOM updates** — no virtual DOM, no framework. Each `@count` change is one assignment plus the textContent updates for elements that depend on it. Arc figured out the dependency graph at compile time.

## 3. Add data at build time (`@build`)

```arc
page "Blog"
  @build const posts = [
    { title: "Hello, Arc", excerpt: "Zero deps. Zero runtime." },
    { title: "The Four Contexts", excerpt: "@build, @state, @live, @realtime." },
    { title: "ADP Binary Protocol", excerpt: "3x smaller, 10x faster than JSON." },
  ]

  header
    heading "My Blog"
    text "{posts.length} posts"

  main
    for post in posts
      card
        heading "{post.title}"
        text "{post.excerpt}"
```

Build:

```
  HTML  1.4 KB
  JS    0 bytes (static)
```

Arc evaluated `@build const posts = [...]` at compile time. The for loop was unrolled. Each post card is literally written into the HTML. **Zero runtime cost.**

You can also fetch real data at build time:

```arc
@build const posts = await fetch("https://cms.example.com/posts").then(r => r.json())
```

The HTTP request fires during `arc build`, not when the user visits. The user gets pre-rendered HTML.

## 4. Add edge-rendered data (`@live`)

For data that **changes per request** (user-specific, real-time stats):

```arc
page "Dashboard"
  @server fn getUser(id: String) -> { name: String }
    const r = await fetch("/api/me", { headers: { cookie: @session.cookie } })
    return await r.json()

  @live let user = getUser("current")

  header
    heading "Welcome back, {user.name}"
```

Arc generates an edge function (Cloudflare Workers / Deno Deploy / Bun / Node) that:
1. Receives the request at the edge (<5 ms from any user)
2. Runs `getUser()` 
3. Fills `{user.name}` into the HTML server-side
4. **Streams** the response — head flushes immediately; body once data resolves

The browser receives fully-rendered HTML in one request. No loading flash. No client-side fetch.

## 5. Add styling (`design`)

```arc
page "Styled"
  card "Hello, design"

  design
    card
      p: 24px
      radius: 12px
      bg: #fff
      shadow: md
      hover: { shadow: lg }
      @mobile { p: 16px }
      @dark { bg: #1a1a1a; fg: #fff }
```

Arc compiles `design` to scoped CSS classes — no global selectors, no specificity wars. Responsive (`@mobile`, `@tablet`, `@desktop`), state (`hover:`, `focus:`, `active:`), and dark mode (`@dark`) are first-class.

## What you've learned

| Pattern | Use for |
| --- | --- |
| Just elements | Static content, marketing pages, docs |
| `@build` | Data that doesn't change per visit (blog posts, docs) |
| `@state` | UI state, counters, form toggles |
| `@live` | Per-user data, dashboards, auth-gated pages |
| `design` block | All styling, no separate CSS files |

## Next steps

- **Tutorial done. Try the examples**: `arc/examples/{hello,counter,blog,dashboard,live}`
- **Understand the model**: [Core Concepts](concepts.md)
- **Reference**: [Syntax](../language/syntax.md), [Data Contexts](../language/data-contexts.md)
- **Cookbook**: [Recipes](../recipes/)
