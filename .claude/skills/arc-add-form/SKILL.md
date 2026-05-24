---
name: arc-add-form
description: Use when the user wants a form with validated inputs and a submit handler. Triggers on "form", "input validation", "submit handler", "contact form", "login form".
---

# arc-add-form

**When to use:** the user wants HTML form elements bound to state, validated, and submitted.

**Reference docs:** `docs/recipes/forms.md`, `docs/language/types.md` (for `Email`, `Phone`, etc. field types).

## Pattern

Use `@state` for each field, `bind:value` for two-way binding, an `@server fn` for submission with a typed input shape, and `on:submit` on the form.

### Minimal contact form

```arc
@state let name = ""
@state let email = ""
@state let message = ""
@state let result: String | none = none

@server fn submitContact(data: { name: String, email: Email, message: String }) -> Result<String, String>
  if data.message.length < 10
    return Err("Message must be at least 10 characters.")
  await db.contacts.add(data)
  return Ok("Thanks!")

form on:submit={
  const r = await submitContact({ name, email, message })
  match r {
    Ok(msg)  => { @result = msg; @name = ""; @email = ""; @message = "" }
    Err(err) => @result = err
  }
}
  label for="name" "Name"
  input id="name" type="text" bind:value={name} required minlength=2

  label for="email" "Email"
  input id="email" type="email" bind:value={email} required

  label for="message" "Message"
  textarea id="message" bind:value={message} required minlength=10

  button type="submit" "Send"

  if result
    text "{result}"
```

Time complexity: O(1) submission. Server-side depends on `db.contacts.add`.
Space complexity: O(1) per field + O(1) result.
Client bytes: ~400 B (three `@state` + form + submit handler) + ~600 B ADP runtime (shared with any other `@server` invocations on the page).

## Built-in validators (semantic types)

Arc has typed field types that serve as both server validators AND auto-generate matching client validation:

| Type | Validates | Matching `<input type>` |
| --- | --- | --- |
| `String` | non-empty if `required` | `text` |
| `Email` | RFC 5321 | `email` |
| `Url` | absolute URL | `url` |
| `Phone` | E.164 | `tel` |
| `Number` | numeric | `number` |
| `Date` / `DateTime` / `Time` | ISO 8601 | `date` / `datetime-local` / `time` |
| `Color` | hex/rgb/hsl/oklch | `color` |
| `Slug` | URL-safe ASCII | `text pattern=...` |

Use these in the `@server fn` parameter type — Arc auto-emits matching client validation.

## bind:value vs bind:checked

```arc
@state let name = ""        # text/email/etc
@state let agreed = false   # checkbox/radio
@state let role = "user"    # select

input type="text" bind:value={name}
input type="checkbox" bind:checked={agreed}
select bind:value={role}
  option value="user" "User"
  option value="admin" "Admin"
```

`bind:value` for text-like inputs and `<select>`. `bind:checked` for checkbox/radio.

`type="number"` auto-parses to Number with NaN guard.

## Inline error display

For per-field server errors, return a structured `Result`:

```arc
@server fn submitContact(data: ContactInput) -> Result<String, { [String]: String }>
  const errs = {}
  if data.name.length < 2  errs.name = "Name too short"
  if !isValidEmail(data.email)  errs.email = "Invalid email"
  if Object.keys(errs).length > 0
    return Err(errs)
  await db.contacts.add(data)
  return Ok("Thanks!")

@state let errors: { [String]: String } = {}

form on:submit={
  const r = await submitContact({ name, email, message })
  match r {
    Ok(_)    => @errors = {}
    Err(es)  => @errors = es
  }
}
  input type="text" bind:value={name}
  if errors.name
    text "{errors.name}"
  ...
```

## File upload

```arc
@state let file: File | none = none

@server fn upload(file: ArrayBuffer, name: String) -> Result<String, String>
  await storage.put(name, file)
  return Ok("Uploaded")

form on:submit={
  if file
    const buf = await file.arrayBuffer()
    await upload(buf, file.name)
}
  input type="file" on:change={ @file = event.target.files[0] }
  button type="submit" disabled={file == none} "Upload"
```

## Native `<dialog>` for confirmation

```arc
button on:click={ document.getElementById('confirm').showModal() } "Delete"

modal id="confirm"
  heading "Delete this?"
  row
    button on:click={ document.getElementById('confirm').close() } "Cancel"
    button on:click={ await deleteItem(); document.getElementById('confirm').close() } "Delete"
```

## Anti-patterns

- ❌ **No `<label>`** for inputs — `arc check` warns. Use `<label for="id">` + `id=`, OR `aria-label`, OR `placeholder` (last resort).
- ❌ **Untyped `@server fn` params**: `@server fn submit(data)` — Arc can't auto-validate. Always type.
- ❌ **Throwing instead of `Err`**: `if (!valid) throw "bad"` — use `return Err("bad")` so client pattern-matches.
- ❌ **Forgetting `e.preventDefault()`**: Arc's `on:submit` does NOT auto-preventDefault. The form will navigate unless you handle the submit (typically with `await fn(...)`).
- ❌ **`bind:value` on a checkbox**: use `bind:checked`.
- ❌ **Manual `getElementById`** for form fields — use `bind:value` for state, `name=` for native form submission.

## Verification

Apply the universal **arc-self-verify** checklist. In addition:

- [ ] **Every input has an accessible name** (`<label for>`, `aria-label`, or `placeholder`). `arc check` warns; satisfy it.
- [ ] **Required fields use `required` attribute** (client-side; server-side validation is in the `@server fn` body).
- [ ] **Field types match `@server fn` parameter types**: `<input type="email">` → fn param `Email`. Mismatch breaks auto-validation.
- [ ] **Submit handler awaits the `@server` call** — naked `submitContact(...)` returns a Promise; UI updates won't fire.
- [ ] **Form prevents default**: Arc's `on:submit={ await fn() }` blocks the native form submit only if the handler completes synchronously OR you explicitly call `event.preventDefault()` in the handler.
- [ ] **Errors handled with `match`**: `match` on `Result<T, E>` instead of try/catch — Arc's contract.
- [ ] **Time complexity stated** for any validation logic: per-keystroke validations should be O(1); per-submit can be O(n) for things like cross-field rules.
- [ ] **No double-submit guard missing**: disable the submit button while awaiting (`disabled={submitting}`), OR rely on the `Result` pattern to surface state.
- [ ] **Reset form state on success** if the user wants to submit again (`@name = ""` etc.).
