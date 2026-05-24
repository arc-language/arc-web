---
name: arc-add-state
description: Use when adding reactive client-side state to an Arc page or widget — counters, toggles, form inputs, anything that updates the DOM without a server round-trip. Triggers on "make this interactive", "add a counter", "toggle", "track this value".
---

# arc-add-state

**When to use:** the user wants a value that lives in the browser and updates the DOM when it changes. Not server data (use `@live`/`@server`); not compile-time data (use `@build`).

**Reference docs:** `docs/language/reactive.md`, `docs/recipes/interactive-list.md`.

## Pattern

`@state let name = initialValue` declares a reactive variable. Writes use `@name` (with the `@` prefix). The compiler emits one setter per `@state` variable that updates exactly the DOM nodes that reference it — no virtual DOM, no diff.

### Minimal counter

```arc
@state let count = 0

main
  text "Count: {count}"
  button on:click={ @count += 1 } "+"
  button on:click={ @count -= 1 } "−"
  button on:click={ @count = 0 } "Reset"
```

Time complexity: O(1) per click. Space complexity: O(1) for `_count` + O(1) per element reference.
Client bytes: ~150 B (one setter + three event listeners).

### Two-way binding (form input)

```arc
@state let name = ""
@state let agreed = false

form
  input type="text" bind:value={name} placeholder="Name"
  label
    input type="checkbox" bind:checked={agreed}
    text "I agree"
  text "Hello, {name ?? "stranger"}"
```

`bind:value` wires both directions automatically — typing updates `@name`, programmatic `@name = "new"` updates the input.

### Derived values via @computed

```arc
@state let items = [1, 2, 3, 4, 5]
@state let multiplier = 2

@computed let doubled = items.map(x => x * multiplier)
@computed let sum = doubled.reduce((a, b) => a + b, 0)

text "Sum: {sum}"
button on:click={ @multiplier += 1 } "Multiply more"
```

Dependency graph: `items` + `multiplier` → `doubled` → `sum`. Changing `multiplier` recomputes `doubled` then `sum`; touching `items` does the same. Arc derives this graph at compile time — no runtime tracking overhead.

## Writes: ALWAYS use `@varname`

```arc
@state let count = 0

# ✓ Correct — @count triggers the setter, updates the DOM
button on:click={ @count += 1 } "+"

# ❌ Wrong — `count = count + 1` reassigns the local capture only;
#    DOM does NOT update. This is the #1 LLM mistake.
button on:click={ count = count + 1 } "+"

# ✓ Bulk update (replace whole array)
button on:click={ @items = [...items, newItem] } "Add"
```

## Don't reach for @state when…

- The value is the same for every visitor → use `@build`
- The value comes from the server per-request → use `@live`
- The value is derived from other reactive values → use `@computed`
- The user only needs the value at a single point in time (no re-render needed) → use a local `let`

## Anti-patterns

- ❌ Writing `count = count + 1` instead of `@count += 1` — the most common LLM mistake. The reactive update only fires with the `@` prefix.
- ❌ `@state let isLoading = false` for `@live` data — `@live` already has no loading state because it's server-rendered. Loading state is a vanilla-SPA anti-pattern.
- ❌ Mutating arrays/objects in place (`@items.push(x)`) — Arc's reactive setter requires re-assignment to detect changes. Use spread: `@items = [...items, x]`.
- ❌ Storing derived data: `@state let doubled = count * 2` then manually updating both — use `@computed`.
- ❌ `bind:value` on non-input elements — only `<input>`, `<select>`, `<textarea>`. For other elements, set the attribute via interpolation: `<div title="{name}">`.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Writes use `@` prefix**: grep the generated code for `<var> = ` where `<var>` is a `@state` name without `@` — that's a silent bug.
- [ ] **`bind:value`** used on the right input type (`bind:checked` for checkbox/radio; `bind:value` for everything else).
- [ ] **Number inputs**: `type="number"` auto-parses to Number; verify the user wants Number (not String).
- [ ] **Derived values use `@computed`**: any value that's `f(otherState)` should be `@computed`, not `@state`.
- [ ] **List updates use spread/re-assignment**: `@items = [...items, x]`, not `@items.push(x)`.
- [ ] **Initial value matches the declared type**: `@state let count = 0` (number), `@state let name = ""` (string), `@state let items = []` (array).
- [ ] **Client JS cost noted**: each `@state` ships ~50–200 B. Three `@state` vars = ~500 B before any handlers. If approaching 1 KB, consider whether `@build` could replace any of them.
