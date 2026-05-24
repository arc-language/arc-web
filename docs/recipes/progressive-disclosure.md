# Recipe: Progressive Disclosure (Modal, Tooltip, Accordion — zero JS)

Three patterns developers usually reach for JS to build — Arc emits them with native browser elements. Zero JavaScript shipped.

## Modal: `<dialog>`

```arc
button on:click={ document.getElementById('confirm').showModal() } "Delete"

modal id="confirm"
  heading "Are you sure?"
  text "This cannot be undone."
  row
    button on:click={ document.getElementById('confirm').close() } "Cancel"
    button on:click={ await deleteIt(); document.getElementById('confirm').close() } "Delete"
```

Compiles to:

```html
<button onclick="document.getElementById('confirm').showModal()">Delete</button>
<dialog id="confirm">
  <h2>Are you sure?</h2>
  <p>This cannot be undone.</p>
  ...
</dialog>
```

Native `<dialog>` provides:
- Focus trap (Tab cycles inside the modal)
- Escape key closes
- `::backdrop` pseudo-element for the overlay
- Restores focus to the trigger button on close

**No JavaScript beyond the `showModal()` / `close()` calls.** Arc emits the calls inline — no event listener registry needed.

## Tooltip: Popover API

```arc
button tooltip="Save to disk" "Save"
```

Compiles to:

```html
<button popovertarget="tt_HASH" tabindex="0">Save</button>
<span popover id="tt_HASH" role="tooltip" class="arc-tooltip_HASH">Save to disk</span>
```

Browser's native Popover API handles show/hide on hover, focus, click. Works with keyboard (Tab to focus button → tooltip appears). **Zero JavaScript.**

For more complex tooltips:

```arc
button "Hover me"
  tooltip
    heading "Pro tip"
    text "Press ⌘K to open the command palette."
```

## Accordion: `<details>` / `<summary>`

```arc
accordion summary="What is Arc?"
  text "Arc is a new language for the web that compiles to optimal HTML, CSS, and JavaScript."

accordion summary="Do I need to install anything else?"
  text "Just Node 20+. Arc has zero runtime dependencies."
```

Compiles to:

```html
<details>
  <summary>What is Arc?</summary>
  <p>Arc is a new language for the web…</p>
</details>
<details>
  <summary>Do I need to install anything else?</summary>
  <p>Just Node 20+. Arc has zero runtime dependencies.</p>
</details>
```

Native `<details>`:
- Click summary toggles open/closed
- Keyboard: Enter or Space toggles
- Screen reader: announces "collapsed" / "expanded"
- Animation: use `details[open]` + `@starting-style` CSS

```arc
design
  details
    transition: height 200ms ease
    @starting-style { opacity: 0 }
```

## Why these patterns matter

| Pattern | Bytes Arc ships | Alternative framework |
| --- | --- | --- |
| Modal | 0 JS | React-Modal / Headless UI Dialog: ~5 KB |
| Tooltip | 0 JS | Floating UI: ~7 KB |
| Accordion | 0 JS | React-Accordion: ~3 KB |

Three patterns × ~5 KB saved per pattern = ~15 KB Brotli on a marketing page.

## Combining: confirmation modal with form

```arc
@state let confirming = false
@state let itemToDelete: String | none = none

@server fn deleteItem(id: String) -> none
  await db.items.delete(id)

for item in items
  card
    text "{item.name}"
    button on:click={
      @itemToDelete = item.id
      document.getElementById('confirm-modal').showModal()
    } "Delete"

modal id="confirm-modal"
  heading "Delete this item?"
  text "This cannot be undone."
  row
    button on:click={ document.getElementById('confirm-modal').close() } "Cancel"
    button on:click={
      if itemToDelete
        await deleteItem(itemToDelete)
        @items = items.filter(i => i.id != itemToDelete)
      document.getElementById('confirm-modal').close()
    } "Delete"
```

## Disclosure pattern: FAQ page

```arc
page "FAQ"
  @build const faqs = readFile("./content/faqs.json")

  main
    heading "Frequently Asked Questions"
    for faq in faqs
      accordion summary="{faq.question}"
        text "{faq.answer}"
```

Zero JS. Each `<details>` is independently controllable by the user.

## Native vs ARIA-only

Arc prefers native HTML elements over JS-built widgets:

| Pattern | Native | Why |
| --- | --- | --- |
| Modal | `<dialog>` | Built-in focus trap |
| Tooltip | Popover API | Native show/hide |
| Disclosure | `<details>` | Free keyboard support |
| Combobox | `<select>` (when simple) / `<input list=...>` (typeahead) | Free |
| Date picker | `<input type="date">` | Free locale-aware UI |
| Color picker | `<input type="color">` | Free OS-native UI |

When native doesn't fit, Arc still emits accessible custom widgets — but the default is to lean on the browser.

## See also

- [Structure](../language/structure.md) — `modal`, `tooltip`, `accordion` syntax
- [Accessibility](../features/accessibility.md) — focus management, ARIA defaults
