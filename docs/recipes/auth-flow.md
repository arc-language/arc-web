# Recipe: Authentication Flow

A complete login → dashboard → logout flow using `@session`, `@live`, and `@server`.

## Login page

```arc
page "Sign in"
  @state let email = ""
  @state let password = ""
  @state let error: String | none = none

  @server fn login(email: Email, password: String) -> Result<String, String>
    const user = await db.users.findByEmail(email)
    if !user || !await verifyPassword(password, user.passwordHash)
      return Err("Invalid credentials")
    const sessionToken = await createSession(user.id)
    @session.set(sessionToken)
    return Ok("/dashboard")

  main
    heading "Sign in"
    form on:submit={
      const r = await login(email, password)
      match r {
        Ok(url)  => { window.location.href = url }
        Err(msg) => { @error = msg }
      }
    }
      input type="email" bind:value={email} required placeholder="Email"
      input type="password" bind:value={password} required placeholder="Password"
      if error
        text "{error}"
      button type="submit" "Sign in"
```

## Dashboard (auth-gated)

```arc
page "Dashboard"
  @server fn getUser() -> User
    // @session.userId is validated automatically by the edge boundary.
    // If no valid session, Arc returns 401 before this body runs.
    return await db.users.find(@session.userId)

  @live let user = getUser()

  header
    heading "Welcome, {user.name}"
    button on:click={ await logout() } "Sign out"
  main
    text "Email: {user.email}"
    text "Role: {user.role}"

  @server fn logout() -> none
    await db.sessions.delete(@session.token)
    @session.clear()
    return none
```

## What happens at the edge

1. Browser → `GET /dashboard` with `Cookie: session=...`
2. Edge worker runs `_resolveData(request)` which:
   - Extracts session cookie, calls your configured `session.validate(cookie)`
   - If invalid: returns 401 before any `@server` fn runs
   - If valid: sets `@session.userId` and proceeds
3. `getUser()` runs at the edge, returns the User
4. HTML is filled in and streamed

## Session configuration

In `arc.config.json`:

```json
{
  "session": {
    "cookieName": "session",
    "validate": "./auth/validate-session.js"
  }
}
```

In `auth/validate-session.js`:

```js
const db = require('./db')

module.exports = async function validate(cookieValue) {
  if (!cookieValue) return null
  const session = await db.sessions.findByToken(cookieValue)
  if (!session || session.expiresAt < new Date()) return null
  return { userId: session.userId, token: cookieValue }
}
```

The returned object becomes `@session.*` inside your `@server` and `@live`.

## Signup

```arc
page "Sign up"
  @state let email = ""
  @state let password = ""

  @server fn signup(email: Email, password: String) -> Result<String, String>
    const existing = await db.users.findByEmail(email)
    if existing
      return Err("Email already in use")
    const user = await db.users.create({ email, passwordHash: await hash(password) })
    const sessionToken = await createSession(user.id)
    @session.set(sessionToken)
    return Ok("/onboarding")

  main
    form on:submit={
      const r = await signup(email, password)
      match r {
        Ok(url)  => { window.location.href = url }
        Err(msg) => { alert(msg) }
      }
    }
      input type="email" bind:value={email} required
      input type="password" bind:value={password} required minlength=8
      button type="submit" "Create account"
```

## Password validation

The `Email` type validates server-side and emits matching client-side validation. For password rules:

```arc
input type="password" bind:value={password} required minlength=8 pattern="(?=.*[A-Z])(?=.*\d).*"
```

Browser enforces the pattern client-side; your `@server fn signup` should re-validate server-side.

## CSRF

For state-changing `@server` calls (login, signup, logout, etc.), Arc adds a CSRF token automatically when the page is `@live`-rendered. The edge function validates the token before invoking your `@server` body.

For static pages with `@server` calls, configure CSRF in `arc.config.json`:

```json
{ "session": { "csrf": true } }
```

## Roles + authorization

`@session.role` (if your validator returns it) can be checked in `@server` bodies:

```arc
@server fn deletePost(id: String) -> Result<none, String>
  if @session.role != "admin"
    return Err("Forbidden")
  await db.posts.delete(id)
  return Ok(none)
```

For UI-level authorization (hide buttons admins shouldn't see), use `@live`:

```arc
@live let user = getUser()

if user.role == "admin"
  button on:click={ await deletePost(post.id) } "Delete"
```

The button is **not in the HTML at all** for non-admins. Server-side enforcement still required (defense in depth).

## See also

- [Edge Rendering](../features/edge-rendering.md) — `@session` lifecycle
- [Recipe: Forms](forms.md) — validation patterns
