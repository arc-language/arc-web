---
name: arc-debug-state-binding
description: Use when a `@state` value isn't updating the DOM, or a `bind:value` / `on:click` handler isn't firing. The #1 cause is missing `@` prefix on writes — but several other gotchas exist.
---

# arc-debug-state-binding

**When to use:** the user reports "my button doesn't update the count", "bind:value doesn't sync", "clicking does nothing", "input typing doesn't update state".

**Reference docs:** `docs/language/reactive.md`.

## Diagnosis flow

Run through these checks in order — the first match is usually the bug.

### 1. Missing `@` prefix on writes (the #1 cause)

```arc
# ❌ Wrong — assigns to local capture, DOM doesn't update
button on:click={ count = count + 1 } "+"

# ✓ Correct — @ prefix triggers the reactive setter
button on:click={ @count += 1 } "+"
```

**Detection**: grep the source for `<varname> =` where `<varname>` matches a `@state let <varname>` declaration. If the assignment doesn't start with `@`, it's the bug.

### 2. `bind:` vs `bind:value` typo

```arc
# ❌ Wrong attribute name
input bind={name}

# ✓ Correct
input bind:value={name}

# ✓ For checkboxes/radios
input type="checkbox" bind:checked={agreed}
```

`bind:value` works on `<input>` (most types), `<select>`, `<textarea>`. `bind:checked` works on checkbox/radio.

### 3. `on:` event name not a real DOM event

```arc
# ❌ Wrong event name
button on:tap={ @count += 1 }

# ✓ Use standard DOM event names
button on:click={ @count += 1 }
```

Valid: `click`, `input`, `change`, `submit`, `keydown`, `keyup`, `mouseenter`, `mouseleave`, `focus`, `blur`, etc.

### 4. Mutating array/object in place

```arc
@state let items = []

# ❌ Wrong — push mutates, doesn't trigger setter
button on:click={ @items.push(newItem) }

# ✓ Correct — re-assignment triggers the setter
button on:click={ @items = [...items, newItem] }
```

Arc detects changes via re-assignment. Mutations are invisible to the reactive system.

### 5. Computed value not reading from reactive

```arc
@state let x = 1

# ❌ Wrong — `let` is a one-time computation, not reactive
let doubled = x * 2
text "{doubled}"

# ✓ Correct — @computed re-runs when x changes
@computed let doubled = x * 2
text "{doubled}"
```

### 6. Reading `@state` value inside an event handler — use the bare name, not `@`

```arc
@state let count = 0

# ✓ Correct — @count for WRITES, bare count for READS
button on:click={ @count = count + 1 }
```

Pattern: `@x = ...` for writes; `x` for reads within the handler.

### 7. Variable referenced before declaration

```arc
# ❌ Wrong — forward reference in template
text "{count}"
@state let count = 0

# ✓ Correct — declare reactive vars at the top of the page/widget body
@state let count = 0
text "{count}"
```

While Arc has top-level hoisting in the checker, reactive declarations should appear before their use for readability + correctness in template bodies.

### 8. Element doesn't have a recognized ID for binding

If you wrote your own raw HTML and tried to bind, Arc can only target elements it emitted. Use `<input>` (which Arc instruments) not `<div contenteditable>` (which it doesn't).

### 9. Event handler has a syntax error inside the braces

```arc
# ❌ Syntax error inside the handler — silently fails
button on:click={ @count =+ 1 }    # =+ is not an operator

# ✓
button on:click={ @count += 1 }
```

Run `arc check` to surface these.

### 10. Multiple components, each their own state

```arc
widget Counter
  @state let count = 0
  button on:click={ @count += 1 } "{count}"

page "Multi"
  Counter()
  Counter()    # Each invocation has its OWN count — separate state
```

If the user expects shared state across widget instances, use `arc/store` from the stdlib (global reactive store).

## Anti-patterns

- ❌ **Suggesting React patterns**: `useState`, `useEffect`, dependency arrays. Arc has no hooks.
- ❌ **Suggesting `setState({ count: count + 1 })`** — Arc has no setState.
- ❌ **Adding manual `getElementById` / `addEventListener`** — Arc generates these from `on:` and the reactive bindings. Manual DOM ops fight the framework.
- ❌ **Adding a re-render trigger** — Arc has no re-renders. State changes update exactly the DOM nodes that bind to that state.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Write sites use `@varname`** (not bare `varname`).
- [ ] **Read sites use bare `varname`** (not `@varname`).
- [ ] **`bind:value`** for inputs that have a value (text, email, url, password, number, search, tel, date, etc., plus `<select>`, `<textarea>`).
- [ ] **`bind:checked`** for checkbox / radio.
- [ ] **List operations use re-assignment** (`@items = [...items, x]`), not in-place mutation (`@items.push(x)`).
- [ ] **Derived values are `@computed`**, not `@state` mirroring another state.
- [ ] **No raw `addEventListener`** — use `on:click={...}` etc.
- [ ] **`arc check` clean** — many binding bugs surface as compile errors. Run it first.
- [ ] **Time complexity confirmed**: most handlers should be O(1). If a handler iterates state on every interaction, debounce or restructure.
- [ ] **No new client JS** added when the user only needed a static change. (Could `@build` have replaced this `@state`?)
