---
name: arc-self-verify
description: Run this checklist BEFORE returning ANY Arc code to the user. Verifies simplicity, performance, Core Web Vitals impact, time/space complexity, bundle bytes, accessibility, and type safety. Every other Arc skill ends by invoking this.
---

# arc-self-verify

The universal verification checklist Arc skills run before returning code. Apply every item; for items that don't apply, write `N/A` with a one-line reason.

## Reference docs

- `docs/internals/optimizer.md` — Arc's compile-time optimizations (loop unrolling, CSS tree-shake)
- `docs/features/accessibility.md` — defaults Arc auto-applies (don't regress these)
- `docs/language/data-contexts.md` — `@build` ships 0 client bytes; prefer over `@state` when data is static
- `docs/reference/errors.md` — every compile error and its fix

## The checklist

### 1. Simplicity

- [ ] **Line count ≤ what the problem requires.** No code added for hypothetical futures. Three similar lines beats a premature abstraction.
- [ ] **No half-finished work.** No TODOs. No commented-out branches. No "we'll wire this up later."
- [ ] **No dead branches.** If `if false { ... }` exists in the generated code, remove it.
- [ ] **No premature `widget` extraction.** Inline a pattern until it's used in ≥3 places.

### 2. Time complexity

- [ ] **State the Big-O** of any new function you wrote.
  - `fn double(x)` → `O(1)`
  - `for x in items` → `O(n)`
  - Nested loop → `O(n × m)` — flag if both could grow
- [ ] **Flag anything ≥ O(n²)** for review. Most Arc operations should be O(n) or O(log n).
- [ ] **Static loops should be `@build`-unrolled.** If you write `for x in items` where `items` is `@build const`, Arc unrolls at compile time → effectively O(1) at runtime.

### 3. Space complexity

- [ ] **State the allocation pattern** of any new data structure.
  - `@state let count = 0` → O(1) per page instance
  - `@state let items = []` → O(n) where n = items.length over the page lifetime
- [ ] **Flag any persistent structure ≥ O(n)** that the user didn't explicitly request.
- [ ] **`@build` data** is allocated once at compile time and inlined as HTML strings — runtime allocation is O(1) for the rendered text.

### 4. Core Web Vitals impact

For each generated change, ask: does it affect a Core Vital? Answer for all four:

- [ ] **LCP (Largest Contentful Paint)** — target ≤ 2.5 s
  - Does this delay first paint? (synchronous data fetch, render-blocking script)
  - **Fix:** use `@build` for static data; use `@live` with parallel `Promise.all` for per-request; auto `fetchpriority="high"` on hero `<img>` (Arc does this for the first 2 imgs)
- [ ] **CLS (Cumulative Layout Shift)** — target ≤ 0.1
  - Does this insert content after initial paint?
  - **Fix:** always set explicit `width`/`height` on images (Arc auto-adds via image pipeline); reserve space for loading skeletons
- [ ] **INP (Interaction to Next Paint)** — target ≤ 200 ms
  - Does this add an event handler that does heavy work?
  - **Fix:** debounce expensive handlers; offload CPU work to `@worker`; avoid `JSON.parse` on huge payloads (use ADP via `@server`)
- [ ] **FCP (First Contentful Paint)** — target ≤ 1.8 s
  - Does this add to the critical render path?
  - **Fix:** prefer `@build` over runtime fetch; let Arc inline critical CSS automatically (default behavior under 14 KB)

### 5. Bundle bytes (client-shipped JS)

- [ ] **How many bytes** does this add to client JS?
- [ ] **Could `@build` replace `@state`?** `@build` ships **0 client bytes**. Use it when data doesn't change per visitor.
- [ ] **Could `@live` replace client-side `@server` calls?** `@live` ships the data **inline in HTML** — no ADP runtime needed in browser.
- [ ] **Are `@server` functions called from event handlers?** If not, Arc's tree-shake removes the ADP runtime (saves ~600 B gzipped).
- [ ] **Did this add new utility CSS classes?** Arc tree-shakes unused base utilities; verify the new HTML actually references the class.

### 6. Reversibility / Defaults

- [ ] **Sensible default + explicit override.** If you added a feature, can the user opt out via page meta or `arc.config.json`?
- [ ] **No global side effects.** No code that pollutes window, sets globals, or monkey-patches built-ins.
- [ ] **No new hard dependencies** in `package.json` — Arc is zero-prod-deps.

### 7. Accessibility (don't regress Arc's defaults)

- [ ] `<img>` has `alt=` (use `alt=""` for decorative).
- [ ] `<button>` has visible label OR `aria-label`.
- [ ] `<input>` / `<select>` / `<textarea>` has accessible name (label/aria-label/placeholder).
- [ ] Color contrast in design block: body text ≥ 4.5:1, large text ≥ 3:1.
- [ ] No animation longer than 200 ms without a `prefers-reduced-motion` override (Arc auto-emits the reset; verify your custom animations don't bypass it).
- [ ] Focus indicators preserved (`:focus-visible` outline — Arc emits this by default).

### 8. Type safety

- [ ] **Every `@server fn` has typed parameters and return type.** Arc derives client validation from these — incomplete types = no validation.
- [ ] **`@live let` annotated** when the value's type isn't obvious.
- [ ] **Use `Result<T, E>` for fallible functions.** Never throw across the `@server` boundary — return `Err("message")` so the client can pattern-match.
- [ ] **Use `none` not `null`.** Use `?? "default"` not `|| "default"` for empty-value fallback (Arc's truthiness rules: only `false` and `none` are falsy).

## How to apply

When generating Arc code in response to a user prompt:

1. Generate the code following the requesting skill's pattern.
2. Walk through this checklist line by line.
3. For each item, decide: ✓ (passes), ⚠ (flag to user), or N/A (with reason).
4. If any item is ⚠, **show the warning + the simpler/faster alternative** before returning the code.
5. State the time and space complexity of any new function in a one-line comment above its declaration.

## Example application

User: "Add a search input that filters a list of products."

After generating code:

```
✓ Simplicity: 6 lines added, no premature widget extraction
✓ Time complexity: O(n) filter where n = products.length, runs on every keystroke
⚠ INP: filtering 10,000 products on every keystroke may exceed 200 ms.
  Suggestion: debounce to 300 ms via setTimeout, OR move to @server fn if products.length > 1000
✓ Space complexity: O(n) for the filtered result, garbage-collected after render
✓ Bundle bytes: ~200 B (one @state + one @computed + one bind:value listener)
✓ LCP/CLS/FCP: no change (interactive widget, fires after initial render)
✓ A11y: input has type="search", will use placeholder for label hint
✓ Reversibility: nothing global; user can replace any time

Returning code with the debounce suggestion inline.
```

---

When invoked by another skill, that skill's specific verification appends below this checklist — but every dimension here is still checked.
