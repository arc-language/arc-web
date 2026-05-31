page "Sign in - Admin"

  @raw '<link rel="stylesheet" href="/arc-ui/arc-ui.css">'
  @raw '<form method="post" action="/auth/login" class="login-card"><img src="/logo.png" alt="Arc" width="56" height="56" style="display:block;margin:0 auto 8px;border-radius:50%;"><h1>Arc Admin</h1><label class="login-label">Email<input class="input" type="email" name="email" required></label><label class="login-label">Password<input class="input" type="password" name="password" required></label><button class="btn btn--primary" type="submit">Sign in</button><div class="alt"><a href="/auth/github">GitHub</a> · <a href="/auth/google">Google</a></div></form>'

  design
    body
      margin: 0
      min-height: 100vh
      display: flex
      align-items: center
      justify-content: center
      background-color: var(--ui-bg, #f5f5f5)
      font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif
    .login-card
      padding: 32px
      width: 360px
      background-color: #fff
      border: 1px solid var(--ui-border, #e5e5e5)
      border-radius: 14px
      box-shadow: 0 8px 24px rgba(0,0,0,0.06)
      display: flex
      flex-direction: column
      gap: 16px
    .login-card h1
      font-size: 18px
      font-weight: 700
      margin: 0 0 8px
    .login-card .login-label
      display: flex
      flex-direction: column
      gap: 6px
      font-size: 12px
      font-weight: 600
      text-transform: uppercase
      letter-spacing: 0.06em
      color: var(--ui-fg-3, #525252)
    .login-card .alt
      text-align: center
      font-size: 13px
      color: var(--ui-fg-3, #525252)
