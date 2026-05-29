# CmsConfirm - accessible confirmation dialog replacing browser confirm().
# Usage in a page:
#   @state let confirmOpen = ""
#   button class="!btn !btn--danger" on:click={ @confirmOpen = "delete-foo" } "Delete"
#   CmsConfirm id="delete-foo" open="{confirmOpen}" title="Delete this?" message="Cannot be undone."
#     button class="!btn !btn--danger" on:click={ @confirmOpen = ""; @deleted = (deleteItem(id).ok == true) } "Delete"
# The slot provides the confirm action button so the parent fully controls the action.
# Open state is keyed by id so multiple dialogs can coexist on the page.
widget CmsConfirm(id: String, title: String, message: String = "", cancelLabel: String = "Cancel", open: String = "")
  if open == id
    div class="cms-confirm-backdrop" on:click={ @open = "" }
    col class="cms-confirm-card !modal__box" role="dialog" aria-modal="true"
      col class="!modal__header"
        text class="!modal__title" "{title}"
        if message
          text class="!modal__subtitle" "{message}"
      row class="!modal__footer" justify="flex-end" gap="8px"
        button class="!btn !btn--ghost" on:click={ @open = "" } "{cancelLabel}"
        slot

  design
    .cms-confirm-backdrop
      position: fixed
      inset: 0
      background-color: rgba(0,0,0,0.4)
      z-index: 9000
    .cms-confirm-card
      position: fixed
      top: 50%
      left: 50%
      transform: translate(-50%, -50%)
      z-index: 9001
      min-width: 360px
      max-width: 480px
