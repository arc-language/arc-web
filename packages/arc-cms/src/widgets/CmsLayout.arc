import Theme from "site/cms/theme.arc"

# CmsLayout - admin panel chrome.
# Uses the arc-ui nav-sidebar component (floating glass + brand-gradient).
# Brand the admin by editing site/theme.arc (--brand-from / --brand-to).
widget CmsLayout(title: String, active: String)
  @raw '<link rel="stylesheet" href="/arc-ui/arc-ui.css">'
  @raw '<script src="/arc-ui/js/toast.js" defer></script>'
  @raw '<style>body[data-role="viewer"] .cms-role-admin,body[data-role="viewer"] .cms-role-editor,body[data-role="editor"] .cms-role-admin{display:none!important}</style>'
  @raw '<script>(async()=>{try{const r=await fetch("/admin/check-auth",{headers:{Accept:"application/json"},redirect:"manual"});if(r.status===401||r.type==="opaqueredirect"||r.status===0){location.replace("/admin/login");return}const j=await r.json().catch(()=>({}));if(j&&j.role){document.body.setAttribute("data-role",j.role);if(j.role!=="admin"&&location.pathname!=="/admin/403"){location.replace("/admin/403");return}}}catch(e){}})();</script>'

  row class="!nav-shell"
    col class="!nav-sidebar"
      row class="!nav-sidebar__brand"
        col class="!nav-sidebar__mark" align="center" justify="center"
          @raw '<img src="/logo.png" alt="Arc" width="32" height="32" style="border-radius:50%;object-fit:cover;">'
        col class="!nav-sidebar__brand-text"
          text class="!nav-sidebar__name" "arc"
          text class="!nav-sidebar__sub" "ADMIN"

      col class="!nav-sidebar__nav"
        text class="!nav-sidebar__group" "Content"
        link href="/admin"        class="!nav-sidebar__item {active == 'dashboard' ? '!is-active' : ''}"
          col class="!nav-sidebar__icon" align="center" justify="center"
            text "▦"
          text class="!nav-sidebar__label" "Dashboard"
        link href="/admin/pages"   class="!nav-sidebar__item cms-role-editor {active == 'pages' ? '!is-active' : ''}"
          col class="!nav-sidebar__icon" align="center" justify="center"
            text "▤"
          text class="!nav-sidebar__label" "Pages"
        link href="/admin/blocks"  class="!nav-sidebar__item cms-role-editor {active == 'blocks' ? '!is-active' : ''}"
          col class="!nav-sidebar__icon" align="center" justify="center"
            text "◫"
          text class="!nav-sidebar__label" "Blocks"
        link href="/admin/media"   class="!nav-sidebar__item cms-role-editor {active == 'media' ? '!is-active' : ''}"
          col class="!nav-sidebar__icon" align="center" justify="center"
            text "▣"
          text class="!nav-sidebar__label" "Media"

        text class="!nav-sidebar__group cms-role-admin" "People"
        link href="/admin/users"   class="!nav-sidebar__item cms-role-admin {active == 'users' ? '!is-active' : ''}"
          col class="!nav-sidebar__icon" align="center" justify="center"
            text "◉"
          text class="!nav-sidebar__label" "Users"
        link href="/admin/groups"  class="!nav-sidebar__item cms-role-admin {active == 'groups' ? '!is-active' : ''}"
          col class="!nav-sidebar__icon" align="center" justify="center"
            text "◎"
          text class="!nav-sidebar__label" "Groups"

        text class="!nav-sidebar__group cms-role-admin" "System"
        link href="/admin/themes"   class="!nav-sidebar__item cms-role-admin {active == 'themes' ? '!is-active' : ''}"
          col class="!nav-sidebar__icon" align="center" justify="center"
            text "◐"
          text class="!nav-sidebar__label" "Themes"
        link href="/admin/settings" class="!nav-sidebar__item cms-role-admin {active == 'settings' ? '!is-active' : ''}"
          col class="!nav-sidebar__icon" align="center" justify="center"
            text "⚙"
          text class="!nav-sidebar__label" "Settings"
        link href="/admin/audit"    class="!nav-sidebar__item cms-role-admin {active == 'audit' ? '!is-active' : ''}"
          col class="!nav-sidebar__icon" align="center" justify="center"
            text "≡"
          text class="!nav-sidebar__label" "Audit log"

      col class="!nav-sidebar__footer"
        link href="/admin/profile" class="!nav-sidebar__item {active == 'profile' ? '!is-active' : ''}"
          col class="!nav-sidebar__icon" align="center" justify="center"
            text "◐"
          text class="!nav-sidebar__label" "Profile"
        link href="/auth/logout" class="!nav-sidebar__item !nav-sidebar__item--signout"
          col class="!nav-sidebar__icon" align="center" justify="center"
            text "↩"
          text class="!nav-sidebar__label" "Sign out"

    col class="!nav-main"
      row class="!nav-topbar" align="center"
        text class="!nav-title" "{title}"
      col class="!nav-content"
        @slot

  design
    body
      margin: 0
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif
      font-size: 14px
      background-color: var(--ui-bg, #f0f7ff)
      color: var(--ui-fg, #050d1f)
      min-height: 100vh
