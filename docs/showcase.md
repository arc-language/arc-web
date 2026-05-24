# Showcase

Sites and apps built with Arc. Add yours by opening a PR or a [Discussion thread](https://github.com/arc-language/arc/discussions/categories/showcase).

> **Submission criteria:** the site/app should be (a) publicly accessible, (b) built primarily with Arc, and (c) something you're willing to be contacted about for case-study quotes.

---

## How to submit

Open a PR adding an entry to this file under "Live sites" with:

```markdown
### [Your project name](https://your-url.example)

**One-line description.** What problem it solves, who it's for.

- **Built with:** Arc 0.x + (any other tech)
- **Stats:** Lighthouse score, page weight, deploy target (Cloudflare Pages / Netlify / Vercel / self-hosted)
- **Repo:** (optional) link to source
- **Author:** Your name + GitHub handle
```

Maintainers will review for the criteria above and merge if eligible. Submitting your project authorizes Arc to feature it in the README, conference talks, blog posts, and the [arc-language.dev](https://arc-language.dev) landing page (when live).

---

## Live sites

*This section is empty pending the public 0.1.0 launch. Submit yours!*

## Examples + reference projects

These live in this repo under `examples/` and demonstrate specific patterns:

| Project | Demonstrates | Output |
| --- | --- | --- |
| [`examples/hello`](../examples/hello) | Static page, semantic HTML | 891 B HTML, 0 JS |
| [`examples/counter`](../examples/counter) | `@state` reactivity | 478 B HTML, 478 B JS |
| [`examples/blog`](../examples/blog) | `@build` data inlining | All posts inline, 0 JS |
| [`examples/dashboard`](../examples/dashboard) | `@server` + ADP binary | Edge function + ~250 B client |
| [`examples/live`](../examples/live) | `@live` streaming render | Pre-rendered HTML, no flash |
| [`examples/chat`](../examples/chat) | `@realtime` WebSocket | Binary frames, auto-reconnect |
| [`examples/patterns`](../examples/patterns) | Native `<dialog>` / Popover / `<details>` | 0 JS using browser primitives |

---

## Benchmarks

For head-to-head comparisons with other frameworks (Next.js, Astro, vanilla HTML), see [`arc-bench/RESULTS.md`](https://github.com/arc-language/arc-bench/blob/main/RESULTS.md). Reproducible — every number ships with the harness used to generate it.

---

## Want to be featured but can't open-source your site?

Send a short writeup to `showcase@arc-language.dev` (replace with actual contact). We'll consider closed-source projects with permission to share metrics + screenshots.
