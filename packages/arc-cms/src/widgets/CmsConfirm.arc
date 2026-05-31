// CmsConfirm - accessible confirmation dialog replacing browser confirm.
// Pages declare a string state var (e.g. confirmOpen) and assign the dialog
// id to open it; the matching CmsConfirm with that id shows itself. The slot
// inside this widget is where the parent passes the confirm action button so
// it fully owns the action. Open state is keyed by id so multiple dialogs
// can coexist on the page.
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
        @slot

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
