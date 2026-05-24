---
name: arc-from-react
description: Use when the user pastes a React/Next.js component and wants the Arc equivalent. Translates hooks, props, JSX, effects, and SSR patterns one-for-one. Always returns Arc code that ships ≥70× less bytes than the original.
---

# arc-from-react

**When to use:** the user pastes React or Next.js code (uses `useState`, `useEffect`, JSX, `'use client'`, `'use server'`, `getServerSideProps`, etc.) and wants the Arc translation.

**Reference docs:** `docs/guides/migrating-from-react.md`.

## Translation table (definitive)

| React pattern | Arc equivalent |
| --- | --- |
| `function Component({ prop }) { ... return <div>{prop}</div> }` | `widget Component(prop)\n  div\n    text "{prop}"` |
| `useState(0)` | `@state let x = 0` |
| `setX(v)` | `@x = v` |
| `setX(prev => prev + 1)` | `@x += 1` |
| `useEffect(() => { setX(fetchedData) }, [])` | `@server fn getData() -> ...` + `@live let x = getData()` (data BEFORE first paint, not after) |
| `useEffect(() => { ws.onmessage = ... }, [])` | `@realtime let messages = channel("name")` |
| `useMemo(() => fn(a, b), [a, b])` | `@computed let z = fn(a, b)` (deps inferred) |
| `useCallback(fn, [deps])` | Just use `fn` — Arc doesn't re-create per render (no renders) |
| `useRef(null)` | `id="x"` + `document.getElementById('x')` (escape hatch only) |
| `useContext(Ctx)` | `import { store } from "arc/store"` |
| `createContext` | `const myStore = store({ ... })` |
| `<Children />` | `@slot` inside widget body |
| `{items.map(item => <Card {...item} key={item.id} />)}` | `for item in items\n  Card(item.title, item.body)` (no `key`, Arc handles list updates) |
| `{cond && <X />}` | `if cond\n  X()` |
| `{cond ? <A /> : <B />}` | `if cond\n  A()\nelse\n  B()` |
| `className="card"` + CSS file | `card` (Arc layout primitive) + `design { card { ... } }` block |
| `<img src={src} alt={alt} />` | `img src="{src}" alt="{alt}"` (Arc pipeline runs automatically) |
| Server Component `async function Page()` | `@server fn` + `@live` |
| `'use client'` directive | Remove — Arc decides per-context automatically |
| `'use server'` action | `@server fn name(args) -> Result<T, E>` |
| `<Link href="/about">` (Next.js) | `link href="about.html"` (Arc) — `arc build-site` injects prefetch automatically |
| `<form action={action}>` (Next.js action) | `form on:submit={ await actionFn(...) }` |
| `cookies()` (Next.js) | `@session` (inside `@server fn`) |
| `notFound()` (Next.js) | `return Err("not found")` from `@server fn`, render 404 page conditionally |

## Concrete examples

### React counter → Arc

```jsx
// React
'use client'
import { useState } from 'react'

export default function Counter() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <button onClick={() => setCount(c => c - 1)}>−</button>
      <span>{count}</span>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  )
}
```

```arc
# Arc
@state let count = 0

row
  button on:click={ @count -= 1 } "−"
  text "{count}"
  button on:click={ @count += 1 } "+"
```

Bytes shipped: React = ~225 KB (framework + component). Arc = ~250 B (direct DOM updater).

### Next.js Server Component → Arc @live

```jsx
// Next.js
async function Page() {
  const r = await fetch('/api/me', { headers: { cookie: cookies().toString() } })
  const user = await r.json()
  return <h1>Hello, {user.name}</h1>
}
```

```arc
# Arc
@server fn getUser() -> User
  const r = await fetch("/api/me", { headers: { cookie: @session.cookie } })
  return await r.json()

@live let user = getUser()
heading "Hello, {user.name}"
```

### Next.js server action → Arc @server fn

```jsx
// Next.js
async function submitContact(formData) {
  'use server'
  await db.contacts.add({ email: formData.get('email') })
}

<form action={submitContact}>
  <input name="email" type="email" required />
  <button type="submit">Send</button>
</form>
```

```arc
# Arc
@state let email = ""
@server fn submitContact(email: Email) -> Result<String, String>
  await db.contacts.add({ email })
  return Ok("Thanks!")

form on:submit={ await submitContact(email) }
  input type="email" bind:value={email} required
  button type="submit" "Send"
```

## Things that don't translate cleanly (be honest)

- **React Server Components with deep nesting** — Arc's `@live` is per-page, not per-component. Restructure to compute all server data at the page top.
- **Suspense boundaries** — Arc has no suspense (no rerender model). Use `@live` for "show once data ready" and `@state` for explicit loading UI.
- **`useTransition` / `useDeferredValue`** — Arc doesn't have priority schedulers. If you need debouncing, use `setTimeout` explicitly.
- **`forwardRef` / `useImperativeHandle`** — Arc has no ref forwarding. Widgets pass attributes through directly.
- **React Error Boundaries** — Arc has no error boundary primitive. Wrap risky `@server fn` calls in `Result<T, Err>` and handle at the call site.
- **Custom hooks** — extract shared logic into a `fn` or a stdlib widget. No hook composition rules to follow.

## Anti-patterns when translating

- ❌ **Keeping `useState` semantics** in Arc code — Arc reactivity is different (direct DOM ops, no renders, no batching).
- ❌ **Translating `useEffect` to a hand-rolled imperative block** — almost always wrong. Either it's data → `@live`, subscription → `@realtime`, or stateful interaction → `@state`.
- ❌ **Preserving `className` strings literally** — Arc generates scoped class names. Use `design` block.
- ❌ **Importing React components** into the Arc translation — Arc doesn't run React. Translate them too, or note them as out of scope.
- ❌ **Skipping `Result<T, E>` for the `@server fn`** — React throws; Arc returns Result.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **No `useState` / `useEffect` / `useMemo` / `useCallback`** in the output.
- [ ] **No JSX** — Arc's syntax is indentation-based.
- [ ] **All `@server fn` are typed** (params + return) — Arc's contract.
- [ ] **All `@server fn` use `Result<T, E>`** for fallible operations — not throws.
- [ ] **List rendering has NO `key=` props** — Arc handles list updates without React-style keys.
- [ ] **Per-component CSS lives in a `design` block** — no `className` chains.
- [ ] **Side effects (fetch, subscription) classified correctly**: data-on-load → `@live`; pushed updates → `@realtime`; user-action → `@server fn`.
- [ ] **Bundle delta calculated**: state how many bytes Arc ships vs the React original. Almost always 70–500× smaller.
- [ ] **TypeScript-isms removed**: `<T>` generics, `as Type` casts mostly drop. Arc has its own type system.
