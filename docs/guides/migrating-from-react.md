# Migrating from React

A side-by-side translation of the patterns React developers use most. The shift takes about an hour.

## Mental model shift

| React thinks in | Arc thinks in |
| --- | --- |
| **Runtime** rendering | **Compile-time** computation |
| Components are functions of props → JSX | Widgets inline as templates with bound attrs |
| `useState` / `useReducer` for ALL mutable data | `@state` for client; `@live` for server; `@build` for compile-time |
| `useEffect` for side effects, data fetching, subscriptions | Almost never needed — Arc's reactivity has no render cycle |
| Virtual DOM diffing | Direct DOM updates from compile-time dependency graph |

## Common patterns

### `useState`

```jsx
// React
const [count, setCount] = useState(0)
return <button onClick={() => setCount(count + 1)}>{count}</button>
```

```arc
// Arc
@state let count = 0
button on:click={ @count += 1 } "{count}"
```

### `useEffect` for data fetch

```jsx
// React
const [user, setUser] = useState(null)
useEffect(() => {
  fetch('/api/me').then(r => r.json()).then(setUser)
}, [])
if (!user) return <Spinner />
return <h1>Hi {user.name}</h1>
```

```arc
// Arc — no spinner needed; data is server-rendered
@server fn getUser() -> User
  return await fetch("/api/me").then(r => r.json())
@live let user = getUser()
heading "Hi {user.name}"
```

### `useEffect` for subscription

```jsx
// React
useEffect(() => {
  const ws = new WebSocket('wss://chat/room')
  ws.onmessage = e => setMessages(m => [...m, JSON.parse(e.data)])
  return () => ws.close()
}, [])
```

```arc
// Arc
@realtime let messages = channel("chat/room")
// done. auto-reconnect, binary frames, no cleanup.
```

### `useMemo` / `useCallback`

```jsx
// React
const filtered = useMemo(() => items.filter(x => x.name.includes(query)), [items, query])
```

```arc
// Arc
@computed let filtered = items.filter(x => x.name.includes(query))
// dependency graph derived at compile time; no [items, query] array to maintain
```

### Component props

```jsx
// React
function Card({ title, body, onClose }) {
  return <div>
    <h2>{title}</h2>
    <p>{body}</p>
    <button onClick={onClose}>×</button>
  </div>
}

<Card title="Hi" body="World" onClose={() => setOpen(false)} />
```

```arc
// Arc
widget Card(title, body, onClose)
  card
    heading "{title}"
    text "{body}"
    button on:click={ onClose() } "×"

Card("Hi", "World", { @open = false })
```

### Children / slots

```jsx
// React
function Wrapper({ title, children }) {
  return <div><h2>{title}</h2>{children}</div>
}
<Wrapper title="Greeting">
  <p>Hello, world</p>
  <button>OK</button>
</Wrapper>
```

```arc
// Arc
widget Wrapper(title)
  card
    heading "{title}"
    @slot

Wrapper("Greeting")
  text "Hello, world"
  button "OK"
```

### Conditional render

```jsx
{isOpen && <Dialog />}
{user ? <Welcome name={user.name} /> : <SignIn />}
```

```arc
if isOpen
  Dialog()

if user
  Welcome(user.name)
else
  SignIn()
```

### List render

```jsx
{items.map(item => <Card key={item.id} {...item} />)}
```

```arc
for item in items
  Card(item.title, item.body, item.onClose)
// no `key` — Arc handles list reconciliation in the emitter
```

### Forms

```jsx
const [email, setEmail] = useState('')
<form onSubmit={async e => {
  e.preventDefault()
  await fetch('/api/contact', { method: 'POST', body: JSON.stringify({ email }) })
}}>
  <input value={email} onChange={e => setEmail(e.target.value)} required />
  <button type="submit">Send</button>
</form>
```

```arc
@state let email = ""

@server fn contact(email: Email) -> none
  await db.contacts.add(email)

form on:submit={ await contact(email) }
  input type="email" bind:value={email} required
  button type="submit" "Send"
```

`bind:value` replaces the `value`+`onChange` pair. Email validation comes from the type.

### CSS

```jsx
// React: CSS Modules / styled-components / Tailwind / plain CSS
import styles from './Card.module.css'
<div className={styles.card}>...</div>
```

```arc
// Arc: design block, scoped automatically
card "..."
design
  card
    p: 24px
    radius: md
    bg: #fff
```

### Routing

```jsx
// React: React Router
<BrowserRouter>
  <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/about" element={<About />} />
  </Routes>
</BrowserRouter>
```

```arc
// Arc: one .arc per route + arc build-site
// home.arc, about.arc
// arc build-site → dist/home.html, dist/about.html
// Or import { router } from "arc/router" for SPA-feel routing
```

### Global state

```jsx
// React: Context / Redux / Zustand
const useStore = create(set => ({
  count: 0,
  inc: () => set(s => ({ count: s.count + 1 }))
}))
```

```arc
// Arc: arc/store
import { store } from "arc/store"
const counter = store({ count: 0, inc: function() { @count++ } })
```

### Server data fetch (Next.js Server Components)

```jsx
// Next.js
async function Page() {
  const data = await fetch('https://api', { cache: 'no-store' })
  return <div>{data.title}</div>
}
```

```arc
@server fn loadData() -> Data
  return await fetch("https://api").then(r => r.json())
@live let data = loadData()
text "{data.title}"
```

## Things you'll stop doing

- ❌ Importing React, ReactDOM, hooks
- ❌ Memo / forwardRef / lazy / Suspense ceremony
- ❌ Key props on list items
- ❌ Render bailouts
- ❌ Effect cleanup functions
- ❌ Component re-render debugging
- ❌ Reducers + actions + dispatch
- ❌ Hydration mismatch debugging
- ❌ 225 KB of framework JS

## Things you'll start doing

- ✅ Pick the right `@` context for each value
- ✅ Trust the compiler — there's no runtime to second-guess
- ✅ Write less code

## Common gotchas

| You wrote | Arc rejects | Use instead |
| --- | --- | --- |
| `const [x] = useState()` | `useState` not defined | `@state let x = ...` |
| `function MyComp() { ... }` | `function` keyword banned | `widget MyComp` |
| `useEffect(() => fetch(...), [])` | n/a — pattern not needed | `@live` for server data |
| `setX(x + 1)` from event | calls undefined `setX` | `@x += 1` |
| `<div className=...>` | className on `div` is fine but Arc-scoped classes preferred | `design` block |
| `null` literal | compile error | `none` |

## Next

- [Core Concepts](../getting-started/concepts.md) — full mental model
- [Recipe: Forms](../recipes/forms.md)
- [Recipe: Auth Flow](../recipes/auth-flow.md)
