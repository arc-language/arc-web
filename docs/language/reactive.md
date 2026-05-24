# Reactive: State, Computed, Bindings

How `@state`, `@computed`, and event handlers work — and what the compiler ships.

## Setters: one per @state variable

```arc
@state let count = 0

main
  text "Count: {count}"
  text "Doubled: {count * 2}"
  button on:click={ @count += 1 } "+"
```

Arc emits one setter per `@state` variable. Each setter updates only the elements that depend on it:

```js
// auto-generated
let _count = 0
const _el1 = document.getElementById('_a1')
const _el2 = document.getElementById('_a2')

function _setCount(v) {
  _count = v
  _el1.textContent = `Count: ${_count}`
  _el2.textContent = `Doubled: ${_count * 2}`
}

document.getElementById('_a3').addEventListener('click', () => _setCount(_count + 1))
```

No virtual DOM. No diff. No render cycle. The compiler knows exactly which DOM nodes touch each variable.

## Writes: `@varname`

Inside event handlers, write to `@state` via the `@` prefix:

```arc
button on:click={ @count = 0 } "Reset"
button on:click={ @count += 1 } "+1"
button on:click={ @items = [...items, newItem] } "Add"
input on:input={ @query = event.target.value }
```

Without `@`, the assignment is to a local variable (and the DOM won't update).

## `@computed` — derived values

```arc
@state let items = [1, 2, 3, 4, 5]
@state let query = ""

@computed let filtered = items.filter(x => x > Number(query))
@computed let count = filtered.length

text "{count} items match"
for x in filtered
  card "{x}"
```

`filtered` recomputes when `items` OR `query` changes. `count` recomputes when `filtered` changes (transitively). The dependency graph is built at compile time:

```
items  ──┐
         ├──> filtered ──> count
query  ──┘
```

A change to `items` triggers: recompute `filtered`, recompute `count`, update DOM nodes that read `filtered` or `count`.

## Two-way binding: `bind:value`

```arc
@state let name = ""
@state let email = ""
@state let role = "user"
@state let agreed = false

form
  input type="text" bind:value={name}
  input type="email" bind:value={email}
  select bind:value={role}
    option value="user" "User"
    option value="admin" "Admin"
  label
    input type="checkbox" bind:checked={agreed}
    text "I agree"
```

`bind:value` wires both directions:
- DOM `input` event → setter
- `@state` write → DOM property update

Works on:
- `<input>` (text, email, password, number, etc.) — uses `value`
- `<input type="checkbox">` / `<input type="radio">` — uses `checked`
- `<select>` — uses `value`
- `<textarea>` — uses `value`

`type="number"` auto-parses to `Number` (with NaN guard).

## Event handlers: `on:event`

```arc
button on:click={ @count += 1 } "+"
form on:submit={ handleSubmit(event) }
input on:input={ @query = event.target.value }
div on:keydown={ if event.key == "Escape" { @open = false } }
```

`event` is in scope inside the handler. Any DOM event works: `click`, `input`, `change`, `submit`, `keydown`, `mouseenter`, etc.

For complex handlers, write a fn:

```arc
@state let items = []

fn addItem(name) {
  @items = [...items, { id: items.length, name }]
}

button on:click={ addItem("New") } "Add"
```

## Reactive interpolation

```arc
text "Hello, {name}!"
heading "{count} items"
img src="{user.avatar}" alt="{user.name}"
link href="/user/{user.id}" "View profile"
```

Every `{...}` inside a string becomes a reactive subscription. The compiler tracks which `@state` / `@computed` variables each interpolation references.

## Reactive list rendering

```arc
@state let todos = []

main
  for todo in todos
    card
      input type="checkbox" bind:checked={todo.done}
      text "{todo.title}"
      button on:click={ @todos = todos.filter(t => t.id != todo.id) } "Delete"
```

Arc generates list-update code based on size + frequency:

| List size | Updates | Strategy emitted |
| --- | --- | --- |
| < 20, frequent | Per-row updates | Individual DOM node ops (minimal reflow) |
| 20-200, infrequent | Whole list | `innerHTML` batch (single reflow) |
| > 200 | Any | Virtual list with windowed rendering |

The decision is made at compile time based on static analysis. You don't pick.

## Opt-in `aria-live` for screen readers

By default, reactive list updates do NOT have `aria-live` (would be noisy). Opt in per region:

```arc
for msg in messages live="polite"
  card "{msg.body}"
```

Emits `<div aria-live="polite">...</div>`. Use `live="assertive"` for urgent updates only.

## Reactive across widgets

```arc
widget Counter
  @state let count = 0
  button on:click={ @count += 1 } "Clicked {count} times"

page "Home"
  main
    Counter()
    Counter()    // independent state — each widget instance has its own count
```

Each widget invocation gets its own `@state`. Use `import { store } from "arc/store"` for global state (see [Stdlib](stdlib.md)).

## What the compiler ships

For a page with 2 `@state` + 3 elements referencing them:

```
ADP runtime (only if @server fns called from client): 600 B
Per-page setter code: ~50 B per @state + ~30 B per binding
```

A typical counter page ships **~300 bytes gzipped** of total client JS.

## Next

- [Data Contexts](data-contexts.md) — `@state` vs `@live` vs `@build`
- [Recipe: Forms](../recipes/forms.md) — `bind:value` patterns
- [Recipe: Interactive List](../recipes/interactive-list.md) — `@state` + `@computed`
