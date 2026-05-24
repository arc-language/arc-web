# Recipe: Interactive List (Filter / Sort / Paginate)

The canonical client-state pattern: a list with a search input + sort + pagination — all client-side, no server round-trip.

## Full example

```arc
page "Products"
  @build const products = await fetch("/api/products").then(r => r.json())

  @state let query = ""
  @state let sortBy = "name"          // "name" | "price"
  @state let page = 1
  const pageSize = 20

  @computed let filtered = products.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase())
  )
  @computed let sorted = match sortBy {
    "name"   => [...filtered].sort((a, b) => a.name.localeCompare(b.name))
    "price"  => [...filtered].sort((a, b) => a.price - b.price)
    _        => filtered
  }
  @computed let pageItems = sorted.slice((page - 1) * pageSize, page * pageSize)
  @computed let totalPages = Math.ceil(sorted.length / pageSize)

  header
    row
      input
        type="search"
        placeholder="Search products…"
        bind:value={query}
        on:input={ @page = 1 }     // reset to page 1 on new filter
      select bind:value={sortBy}
        option value="name" "Sort: Name"
        option value="price" "Sort: Price"

  main
    text "{sorted.length} products"
    grid cols=4 gap=16
      for product in pageItems
        card
          img src="{product.image}" alt="{product.name}"
          heading "{product.name}"
          text "${product.price.toFixed(2)}"
          button on:click={ addToCart(product.id) } "Add"

    row align="center"
      button on:click={ @page = Math.max(1, page - 1) } disabled={page == 1} "‹"
      text "Page {page} of {totalPages}"
      button on:click={ @page = Math.min(totalPages, page + 1) } disabled={page == totalPages} "›"
```

## What ships to the browser

- **All `products` data** — inlined into HTML at build time (via `@build`)
- **Setters for `@state`** — `_setQuery`, `_setSortBy`, `_setPage`
- **Dependency graph** — `query` change → recompute `filtered` → recompute `sorted` → recompute `pageItems` → update list DOM
- **List update strategy** — for ~20 items per page, Arc emits per-row DOM ops (not innerHTML batch)

Estimated client JS: ~600 B gzipped for the full filter/sort/paginate state machine. **No external dependencies.**

## Dependency graph

```
products ──┐
           │
query    ──┼──> filtered ──> sorted ──> pageItems
           │                              │
sortBy   ──┘                              │
                                          │
page     ──────────────────────────────── ┘
```

Arc derives this at compile time. Changing `query`:
- Recomputes `filtered`, `sorted`, `pageItems`
- Updates the list DOM
- Does NOT re-run `match sortBy` (sortBy didn't change)

Changing `page`:
- Recomputes `pageItems` only (no need to re-filter or re-sort)
- Updates the list DOM

This is more targeted than any runtime framework can do without manual `useMemo`.

## Server-side filtered (when `products` is too big to inline)

If you have 10,000+ products, `@build` inlining bloats the HTML. Switch to `@server`:

```arc
page "Products"
  @server fn search(query: String, sort: String, page: Number) -> Product[]
    return await db.products.search(query, sort, page * 20, 20)

  @state let query = ""
  @state let sortBy = "name"
  @state let page = 1
  @state let results: Product[] = []
  @state let loading = false

  @computed _ = async {
    @loading = true
    @results = await search(query, sortBy, page)
    @loading = false
  }

  header
    input type="search" bind:value={query} on:input={ @page = 1 }
    select bind:value={sortBy}
      option value="name" "Name"
      option value="price" "Price"

  main
    if loading
      text "Loading…"
    grid cols=4
      for p in results
        card "{p.name}"
```

`@computed _` (anonymous) acts as a side-effect trigger — runs whenever `query`/`sortBy`/`page` change.

## Debounced input

For search-as-you-type, debounce the server call:

```arc
@state let queryInput = ""
@state let query = ""

fn debounce() {
  clearTimeout(window._t)
  window._t = setTimeout(() => @query = queryInput, 300)
}

input type="search" bind:value={queryInput} on:input={ debounce() }
```

Or import `debounce` from a helper module.

## Virtual scrolling (huge lists)

For 500+ items in a single view, Arc auto-emits virtual scrolling (windowed rendering) — only the visible items render. You don't opt in; Arc detects list size and picks the strategy. See [Reactive](../language/reactive.md).

## See also

- [Reactive](../language/reactive.md) — `@computed` dependency graph
- [Data Contexts](../language/data-contexts.md) — `@build` vs `@server` for product lists
