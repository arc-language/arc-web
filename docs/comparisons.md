# Arc vs other web tools

Honest side-by-side comparisons. Numbers from [`arc-bench/RESULTS.md`](https://github.com/arc-language/arc-web-bench/blob/main/RESULTS.md) — reproducible.

Quick table first; detailed sections below.

| | React/Next.js | Astro | SvelteKit | Vanilla | **Arc** |
|---|:---:|:---:|:---:|:---:|:---:|
| Runtime JS shipped | 200+ KB | 0 KB (or partial hydration) | 5–10 KB | 0 KB | **0 KB static / 225 B reactive** |
| Build time (20-page docs) | 14 s | 1.5 s | 3 s | 0.02 s | **0.11 s** |
| Per-page Brotli (with shared CSS) | 3.2 KB + 225 KB JS | 1.5 KB | 1.8 KB | **992 B** | 1.0 KB |
| Image pipeline | `next/image` (plugin) | `@astrojs/image` (plugin) | `enhanced:img` (Vite plugin) | manual | **built-in** |
| Sitemap | `next-sitemap` (plugin) | `@astrojs/sitemap` (plugin) | manual | manual | **built-in** |
| `_headers` / cache-control | manual | manual | manual | manual | **built-in** |
| Edge SSR | Vercel/Cloudflare adapter | adapter per host | adapter per host | n/a | **built-in (WinterCG)** |
| Realtime / WebSocket | bring your own | bring your own | bring your own | bring your own | **`@realtime`** |
| Binary RPC format | JSON | JSON | JSON | JSON | **ADP (3× smaller)** |
| Production deps | hundreds | tens | dozens | 0 | **0** |

Tradeoffs follow.

---

## Arc vs Next.js (React)

**Pick Next.js when:** you need the React ecosystem (large component libraries, hiring pool, mature TypeScript support); your team already writes React; you ship to Vercel and want first-class integration.

**Pick Arc when:** runtime payload matters; your app is mostly read-heavy with sprinkled interactivity; you want zero framework JS for static content; build time / DX speed matters.

### Side-by-side

```jsx
// Next.js
'use client'
import { useState } from 'react'

export default function Counter() {
  const [count, setCount] = useState(0)
  return (
    <button onClick={() => setCount(c => c + 1)}>
      Clicked {count} times
    </button>
  )
}
```

```arc
# Arc
@state let count = 0
button on:click={ @count += 1 } "Clicked {count} times"
```

**What ships:**
- Next.js: ~225 KB framework + the component code (typically 5–50 KB more)
- Arc: ~250 B of direct DOM updater code, no framework

### Honest about Next.js's wins

- **React Server Components** are powerful when used well; Arc's `@live` covers the same territory but with less type-system support and a smaller component ecosystem.
- **Next.js's deploy story on Vercel** is one-click; Arc's `arc deploy --target cloudflare` is also one-step but Vercel has more built-in integrations (analytics, OG generation, edge config).
- **TypeScript ecosystem** — Next has full TS; Arc has its own type system that doesn't accept `.ts` files.

---

## Arc vs Astro

**Pick Astro when:** you want islands of React/Vue/Svelte components inside static pages; you have an existing component library you want to keep using; you need MDX content collections.

**Pick Arc when:** you want one consistent language end-to-end; you want built-in `_headers` / sitemap / image-dedup without plugins; you want `@live` + `@realtime` first-class.

### Side-by-side

```astro
---
import Card from './Card.astro'
const posts = await Astro.glob('./posts/*.md')
---
<h1>{posts.length} posts</h1>
{posts.map(p => <Card title={p.frontmatter.title} />)}
```

```arc
# Arc
@build const posts = ["./posts/1.md", "./posts/2.md"].map(p => readFile(p))

heading "{posts.length} posts"
for p in posts
  Card(p.title)
```

**What ships (20-section docs page):**
- Astro: 1.8 KB Brotli HTML, 0 KB JS (no islands)
- Arc: **1.7 KB Brotli HTML, 0 KB JS** — slightly smaller because Arc's HTML+CSS compress together better than Astro's per-route output

### Where they overlap

| | Astro | Arc |
| --- | :---: | :---: |
| Zero-JS default | ✓ | ✓ |
| File-per-route | ✓ | ✓ |
| Image pipeline | plugin | built-in |
| Sitemap | plugin | built-in |
| View Transitions | plugin | auto-injected |
| Cache `_headers` | manual | auto-emitted |
| Edge SSR | adapter | built-in |

### Honest about Astro's wins

- **Multi-framework islands** — Astro lets you embed React/Vue/Svelte components. Arc is Arc-only.
- **MDX content collections** — first-class. Arc handles markdown via `@build readFile()` but lacks Astro's frontmatter + schema validation tooling.
- **Mature ecosystem** — more themes, more integrations, more community examples.

---

## Arc vs SvelteKit

**Pick SvelteKit when:** you want fine-grained reactivity with Svelte's runes; you need a mature SSR/hydration story; you have a Svelte component library.

**Pick Arc when:** you want zero runtime (Svelte still ships ~5–10 KB); you want compile-time data inlining (`@build`); you want simpler deploy targets.

### Side-by-side

```svelte
<!-- SvelteKit -->
<script>
  let count = $state(0)
</script>
<button on:click={() => count++}>{count}</button>
```

```arc
# Arc
@state let count = 0
button on:click={ @count += 1 } "{count}"
```

The syntax is similar — both are compile-time reactive frameworks. Differences:
- **Svelte runtime** is ~5–10 KB (still smaller than React but non-zero)
- **Arc emits direct DOM updates** with no runtime helper
- **Svelte's stores + actions** are a richer abstraction set; Arc is more spartan

### Honest about Svelte's wins

- **Component ergonomics** are excellent — slots, props, transitions are well-thought-out
- **`bind:` directive** in Svelte is more comprehensive than Arc's `bind:value`
- **DevTools support** — Svelte has a browser extension; Arc doesn't (yet)

---

## Arc vs vanilla HTML

**Pick vanilla when:** you have <5 pages; you don't need a build step; you control every byte by hand.

**Pick Arc when:** you have ≥2 pages and want CSS dedup automatically; you want SEO meta / OG / JSON-LD without writing the boilerplate; you want a `<button>` to default to `type="button"` and `<img>` to get `loading="lazy"` without remembering.

### Side-by-side (a counter button)

```html
<!-- vanilla -->
<button id="incr">Count: 0</button>
<script>
  let count = 0
  const btn = document.getElementById('incr')
  btn.addEventListener('click', () => {
    count++
    btn.textContent = `Count: ${count}`
  })
</script>
```

```arc
# Arc
@state let count = 0
button on:click={ @count += 1 } "Count: {count}"
```

Arc's output is the same idea but auto-emits:
- Direct DOM updater (no manual `getElementById` + `addEventListener`)
- Scoped CSS class on the button
- `type="button"` (prevents accidental form submit)

### Honest about vanilla's wins

- **No build step** — edit HTML, refresh browser
- **Zero learning curve** for anyone who knows HTML
- **Smallest absolute byte count** for tiny pages — Arc adds ~80 B of auto-emitted SEO/security defaults that vanilla skips

---

## When NOT to use Arc

- **You need React Native / native mobile UI today** — Arc is web-only at 1.x. Webview-based mobile + desktop is on the 2.x [roadmap](https://github.com/arc-language/arc-web/blob/main/ROADMAP.md) but not shippable yet.
- **You're integrating into an existing React/Vue/Svelte app** — Arc replaces, doesn't embed
- **You need full TypeScript types from npm libraries** — Arc has its own type system; `.ts` files aren't compilable input
- **Your team's existing skills are React/Vue/etc.** — switching cost matters more than payload bytes for many projects
- **You need a mature plugin ecosystem TODAY** — Arc is 0.1.0; the plugin story is still emerging

---

## Methodology for these comparisons

- **Bytes:** Brotli level 11 of the assets the browser actually downloads
- **Build time:** `time` of the equivalent CLI command, median of 3 runs
- **Lighthouse:** mobile profile, simulated Slow 4G + 4× CPU
- **Reproduce:** [`arc-bench/`](https://github.com/arc-language/arc-web-bench/blob/main/RESULTS.md) — every number ships with the test harness

If you find these numbers are out of date or wrong, open an issue with your repro setup and we'll investigate.
