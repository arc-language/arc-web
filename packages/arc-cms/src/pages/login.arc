page "Sign in - Admin"

  @raw '<link rel="stylesheet" href="/arc-ui/arc-ui.css">'
  @raw '<style>:root{--brand-from:#00e5ff;--brand-to:#7b2fff;--ui-bg:#f0f7ff;--ui-fg:#050d1f;--ui-fg-2:#1e3a5f;--ui-fg-3:#4a6080;--ui-border:rgba(123,47,255,.28);--ui-accent:#7b2fff;--ui-accent-glass:rgba(123,47,255,.12);--ui-error:#dc2626;--glass-bg:rgba(0,0,0,.04);--glass-border:rgba(123,47,255,.18);--glass-blur:0px;--glass-saturate:100%}.input{color:#050d1f!important;background:rgba(255,255,255,.8)!important;color-scheme:light}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ui-bg:#03040f;--ui-fg:#edf4ff;--ui-fg-2:#8ba8d4;--ui-fg-3:#3d5475;--ui-border:rgba(0,229,255,.14);--ui-accent:#00e5ff;--ui-accent-glass:rgba(0,229,255,.12)}}:root[data-theme="dark"]{--ui-bg:#03040f;--ui-fg:#edf4ff;--ui-fg-2:#8ba8d4;--ui-fg-3:#3d5475;--ui-border:rgba(0,229,255,.14);--ui-accent:#00e5ff;--ui-accent-glass:rgba(0,229,255,.12)}</style>'

  col class="login-bg"
    form method="post" action="/auth/login" class="login-card"
      img src="/logo.png" alt="Arc" width="48" height="48" class="login-logo"
      col class="login-field" tag="label"
        text class="login-label-text" "Email"
        @raw '<input class="input" type="email" name="email" required autocomplete="email">'
      col class="login-field"
        text class="login-label-text" tag="label" for="login-password" "Password"
        div class="!input-wrap !input-wrap--password login-pw-wrap"
          @raw '<input class="input" id="login-password" type="password" name="password" required autocomplete="current-password">'
          @raw '<button type="button" class="input-password-toggle" id="login-pw-toggle" aria-label="Show password" tabindex="-1"><svg id="login-pw-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>'
          @raw '<script>document.addEventListener("DOMContentLoaded",function(){var btn=document.getElementById("login-pw-toggle"),inp=document.getElementById("login-password"),icon=document.getElementById("login-pw-icon");if(!btn)return;btn.addEventListener("click",function(){var show=inp.type==="password";inp.type=show?"text":"password";btn.setAttribute("aria-label",show?"Hide password":"Show password");icon.innerHTML=show?\'<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>\':\'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>\'})});</script>'
      button type="submit" class="login-submit" "Sign in"
      row class="login-divider" align="center" gap="10px"
        div class="login-divider-line"
        text class="login-divider-text" "or"
        div class="login-divider-line"
      row class="login-oauth-row" gap="8px"
        link href="/auth/github" class="login-oauth-btn"
          @raw '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>'
          "GitHub"
        link href="/auth/google" class="login-oauth-btn"
          @raw '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>'
          "Google"

  design
    body
      margin: 0
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif
      background-color: #f0f4ff
    .login-bg
      min-height: 100vh
      display: flex
      align-items: center
      justify-content: center
      background-color: #f0f4ff
    .login-card
      width: 360px
      padding: 36px 32px 28px
      background: rgba(0,95,204,0.06)
      border: 1.5px solid rgba(0,95,204,0.25)
      border-radius: 16px
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.6), 0 4px 24px rgba(0,95,204,0.08)
      display: flex
      flex-direction: column
      gap: 14px
    .login-logo
      display: block
      margin: 0 auto 4px
    .login-title
      font-size: 18px
      font-weight: 700
      margin: 0 0 4px
      text-align: center
      color: var(--ui-fg, #050d1f)
    .login-field
      gap: 6px
    .login-pw-wrap
      width: 100%
    .login-label-text
      font-size: 11px
      font-weight: 600
      text-transform: uppercase
      letter-spacing: 0.07em
      color: var(--ui-fg-3, #4a6080)
    .login-submit
      width: 100%
      padding: 9px 16px
      margin-top: 2px
      background: #7b2fff
      color: #fff
      border: none
      border-radius: 8px
      font-size: 14px
      font-weight: 600
      cursor: pointer
      font-family: inherit
      letter-spacing: 0.01em
      transition: background 0.15s ease, box-shadow 0.15s ease
    .login-submit:hover
      background: #6a1fe8
      box-shadow: 0 4px 16px rgba(123,47,255,0.3)
    .login-divider
      margin-top: 2px
    .login-divider-line
      flex: 1
      height: 1px
      background: rgba(0,95,204,0.15)
    .login-divider-text
      font-size: 11px
      font-weight: 500
      color: var(--ui-fg-3, #4a6080)
      text-transform: uppercase
      letter-spacing: 0.06em
      white-space: nowrap
    .login-oauth-row
      width: 100%
    .login-oauth-btn
      flex: 1
      display: flex
      align-items: center
      justify-content: center
      gap: 7px
      padding: 8px 12px
      border: 1.5px solid rgba(0,95,204,0.18)
      border-radius: 8px
      background: rgba(255,255,255,0.6)
      color: var(--ui-fg-2, #1e3a5f)
      font-size: 13px
      font-weight: 500
      text-decoration: none
      font-family: inherit
      transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease
    .login-oauth-btn:hover
      border-color: rgba(0,95,204,0.35)
      background: rgba(255,255,255,0.85)
      box-shadow: 0 2px 8px rgba(0,95,204,0.08)
