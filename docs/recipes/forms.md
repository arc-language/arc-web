# Recipe: Forms

Validated inputs, two-way binding, server submission.

## Basic form

```arc
@state let name = ""
@state let email = ""

form on:submit={ await submit({ name, email }) }
  label for="name" "Name"
  input id="name" type="text" bind:value={name} required minlength=2

  label for="email" "Email"
  input id="email" type="email" bind:value={email} required

  button type="submit" "Send"
```

`bind:value` wires both directions — typing updates `@name`, programmatic writes update the DOM.

`required`, `minlength`, `maxlength`, `pattern`, `min`, `max`, `step` use native HTML5 validation. The browser prevents submit if invalid.

## Server submit with typed validation

```arc
type ContactInput = {
  name: String
  email: Email          // server + client validation auto-derived
  message: String
}

@server fn submitContact(data: ContactInput) -> Result<String, String>
  if data.message.length < 10
    return Err("Message must be at least 10 chars")
  await db.contacts.add(data)
  return Ok("Thanks!")

@state let name = ""
@state let email = ""
@state let message = ""
@state let result: String | none = none

form on:submit={
  const r = await submitContact({ name, email, message })
  match r {
    Ok(msg)  => { @result = msg; @name = ""; @email = ""; @message = "" }
    Err(msg) => { @result = msg }
  }
}
  input type="text" bind:value={name} required minlength=2
  input type="email" bind:value={email} required
  textarea bind:value={message} required minlength=10
  button type="submit" "Send"

  if result
    text "{result}"
```

The `Email` field type auto-generates client-side validation matching the server's check — no duplication.

## Inline error display

```arc
@state let errors: { name?: String, email?: String, message?: String } = {}

form on:submit={
  const r = await submitContact({ name, email, message })
  match r {
    Ok(_)    => { @errors = {} }
    Err(msg) => { @errors = { _: msg } }
  }
}
  input type="text" bind:value={name} required
  if errors.name
    text "{errors.name}"

  ...
```

For per-field server errors, return a structured error from `@server`:

```arc
@server fn submitContact(data: ContactInput) -> Result<String, { [String]: String }>
  const errs = {}
  if data.name.length < 2  errs.name = "Name too short"
  if !isValidEmail(data.email)  errs.email = "Invalid email"
  if Object.keys(errs).length > 0
    return Err(errs)
  await db.contacts.add(data)
  return Ok("Thanks!")
```

## Multi-step form

```arc
@state let step = 1
@state let formData = { name: "", email: "", company: "" }

main
  match step {
    1 => col
      heading "Step 1: Identity"
      input bind:value={formData.name} required
      input type="email" bind:value={formData.email} required
      button on:click={ @step = 2 } "Next"
    2 => col
      heading "Step 2: Company"
      input bind:value={formData.company}
      row
        button on:click={ @step = 1 } "Back"
        button on:click={ await submit(formData); @step = 3 } "Submit"
    3 => text "Thanks! All set."
  }
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

## Optimistic UI

```arc
@state let likeCount = post.likes
@state let liked = post.userLiked

@server fn toggleLike(postId: String) -> { count: Number, liked: Boolean }
  return await db.likes.toggle({ user: @session.userId, postId })

button on:click={
  // Optimistic: update local state first
  @liked = !liked
  @likeCount = liked ? likeCount - 1 : likeCount + 1
  // Then sync with server
  const r = await toggleLike(post.id)
  @likeCount = r.count
  @liked = r.liked
} "{liked ? '❤' : '♡'} {likeCount}"
```

## Form via `arc/form` (validation helper)

```arc
import { Form } from "arc/form"

Form(onSubmit={ data => submitContact(data) })
  input name="name" type="text" required minlength=2
  input name="email" type="email" required
  textarea name="message" required minlength=10
  button type="submit" "Send"

  @slot errors
    for err in errors
      text "{err.field}: {err.message}"
```

The `Form` widget auto-collects fields by `name`, derives client validation from the bound `@server` fn's type, and renders errors via the named slot.

## Native `<dialog>` for confirmation

```arc
button on:click={ document.getElementById('confirm').showModal() } "Delete account"

modal id="confirm"
  heading "Delete your account?"
  text "This cannot be undone."
  row
    button on:click={ document.getElementById('confirm').close() } "Cancel"
    button on:click={ await deleteAccount(); document.getElementById('confirm').close() } "Delete"
```

## See also

- [Recipe: Auth Flow](auth-flow.md) — `@server` + form
- [Types](../language/types.md) — `Email`, `Url`, `Phone` field types
