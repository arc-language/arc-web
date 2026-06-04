import QRCode from "../../stdlib/qrcode"

page "Arc Packages"
  meta description="Arc stdlib packages — zero-dependency widgets for QR codes, syntax highlighting, gradient text, and particle effects."
  meta og:title="Arc Packages"
  meta og:description="Browse Arc's stdlib widget collection: QRCode, GradientText, Code, Snow, Fireworks, and more."

  main
    header
      h1 "Arc Packages"
      p "Zero-dependency stdlib widgets. Drop in, compile, ship."

    // ── QRCode ────────────────────────────────────────────────────────────
    section id="qrcode"
      div class="pkg-header"
        div class="pkg-title"
          span class="pkg-badge" "stdlib"
          h2 "QRCode"
        p "Inline SVG, single path, ISO 18004 byte-mode v1–40. Zero JS beyond the one-time encoder init."
        div class="pkg-links"
          a href="https://www.npmjs.com/package/@arc-lang/qrcode" "npm"
          a href="https://github.com/KCuppens/arc-qrcode" "GitHub"
          a href="../qrcode/" "Full demo →"

      div class="demo-row"
        div class="demo-card"
          QRCode value="https://arc.codes" size=160
          span "URL"
        div class="demo-card"
          QRCode value="https://arc.codes" size=160 dark="#0d1117" light="#f6f8fa"
          span "Dark theme"
        div class="demo-card"
          QRCode value="https://arc.codes" size=160 dark="#6366f1" light="#f5f3ff"
          span "Custom color"
        div class="demo-card"
          QRCode value="https://arc.codes" size=160 level="H"
          span "Level H (30%)"

      pre class="code-block"
        'import QRCode from "arc/qrcode"\n\nQRCode value="https://arc.codes"\nQRCode value="https://arc.codes" size=300 level="H" dark="#1a1a2e"'

    // ── GradientText ──────────────────────────────────────────────────────
    section id="gradient"
      div class="pkg-header"
        div class="pkg-title"
          span class="pkg-badge" "stdlib"
          h2 "GradientText"
        p "CSS-first gradient text. Zero runtime bytes for static. ~50 bytes for animated, hardware-accelerated."
        div class="pkg-links"
          a href="../gradient/" "Full demo →"

      div class="demo-row plain"
        div class="demo-card gradient-card" style="background: linear-gradient(to right,#6366f1,#ec4899,#f97316); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text"
          span "rainbow"
        div class="demo-card gradient-card" style="background: linear-gradient(to right,#0ea5e9,#06b6d4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text"
          span "ocean"
        div class="demo-card gradient-card" style="background: linear-gradient(to right,#f97316,#ef4444,#fbbf24); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text"
          span "fire"
        div class="demo-card gradient-card" style="background: linear-gradient(to right,#22d3ee,#a78bfa,#f472b6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text"
          span "neon"

      pre class="code-block"
        'import { GradientText } from "arc/gradient"\n\nGradientText name="rainbow" "Hello"\nGradientText name="fire" animate=true duration="2s" "Animated"'

    // ── Code ──────────────────────────────────────────────────────────────
    section id="highlight"
      div class="pkg-header"
        div class="pkg-title"
          span class="pkg-badge" "stdlib"
          h2 "Code"
        p "Syntax highlighting. ~2 KB runtime tokenizer. JS/TS, Python, HTML, CSS, JSON, Shell, SQL."
        div class="pkg-links"
          a href="../highlight/" "Full demo →"

      pre class="code-block"
        'import { Code } from "arc/highlight"\n\nCode lang="javascript"\n  const x = 1 + 2'

    // ── Particles ─────────────────────────────────────────────────────────
    section id="particles"
      div class="pkg-header"
        div class="pkg-title"
          span class="pkg-badge" "stdlib"
          h2 "Particles"
        p "15 presets — Snow, Stars, Bubbles, Fire, Confetti, Hyperspace and more. One typed-array pool. Zero GC per frame."
        div class="pkg-links"
          a href="../particles/" "Full demo →"

      pre class="code-block"
        'import Snow from "arc/particles"\nimport { Stars, Fire, Confetti } from "arc/particles"\n\nSnow pool=200 fullscreen=true\nStars speed=0.5\nConfetti'

    // ── Fireworks ─────────────────────────────────────────────────────────
    section id="fireworks"
      div class="pkg-header"
        div class="pkg-title"
          span class="pkg-badge" "stdlib"
          h2 "Fireworks"
        p "~2 KB particle burst system. Click anywhere or use autoLaunch."
        div class="pkg-links"
          a href="../fireworks/" "Full demo →"

      pre class="code-block"
        'import Fireworks from "arc/fireworks"\n\nFireworks autoLaunch=true autoInterval=3000'

    // ── arc-versioning ────────────────────────────────────────────────────
    section id="versioning"
      div class="pkg-header"
        div class="pkg-title"
          span class="pkg-badge pkg-badge--npm" "npm"
          h2 "arc-versioning"
        p "Automatic model versioning for Arc CMS. Every mutation snapshotted, full history with field-level diffs, and one-click revert. Zero config beyond adding the package name."
        div class="pkg-links"
          a href="https://github.com/arc-language/arc-versioning" "GitHub"
          a href="https://www.npmjs.com/package/arc-versioning" "npm"
          a href="../versioning/" "Full demo →"

      pre class="code-block"
        '// arc.config.json\n{\n  "packages": ["arc-versioning"]\n}\n\n// History UI auto-mounted at:\n// /admin/history/:model/:id\n\n// REST API:\n// GET  /admin/api/versions/:model/:id\n// POST /admin/api/versions/:model/:id/revert/:versionId'

  design
    main
      max-width: 960px
      margin: 0 auto
      padding: 48px 24px
      font-family: var(--arc-font-sans)

    header
      text-align: center
      margin-bottom: 64px
      padding-bottom: 40px
      border-bottom: 2px solid #6366f1

    h1
      font-size: 2.5rem
      font-weight: 800
      background: linear-gradient(135deg, #6366f1, #8b5cf6)
      -webkit-background-clip: text
      -webkit-text-fill-color: transparent
      background-clip: text
      margin: 0 0 12px

    header p
      color: #666
      font-size: 1.1rem
      margin: 0

    section
      margin-bottom: 64px
      padding-bottom: 64px
      border-bottom: 1px solid #eee

    section:last-child
      border-bottom: none

    .pkg-header
      margin-bottom: 28px

    .pkg-title
      display: flex
      align-items: center
      gap: 10px
      margin-bottom: 8px

    h2
      font-size: 1.5rem
      font-weight: 700
      margin: 0

    .pkg-badge
      font-size: 0.65rem
      font-weight: 600
      text-transform: uppercase
      letter-spacing: 0.05em
      background: #f0f0ff
      color: #4338ca
      border: 1px solid #c7d2fe
      border-radius: 4px
      padding: 2px 6px
    .pkg-badge--npm
      background: #fff3e0
      color: #b45309
      border-color: #fcd34d

    .pkg-header p
      color: #555
      margin: 0 0 12px
      max-width: 560px

    .pkg-links
      display: flex
      gap: 12px

    .pkg-links a
      font-size: 0.8rem
      font-weight: 500
      color: #4f46e5
      text-decoration: none
      padding: 2px 0
      border-bottom: 1px solid #c7d2fe

    .pkg-links a:hover
      color: #4f46e5
      border-bottom-color: #6366f1

    .demo-row
      display: flex
      gap: 20px
      flex-wrap: wrap
      margin-bottom: 24px
      align-items: flex-end

    .demo-card
      display: flex
      flex-direction: column
      align-items: center
      gap: 8px
      padding: 16px
      background: #fafafa
      border: 1px solid #eee
      border-radius: 10px

    .demo-card span
      font-size: 0.75rem
      color: #6b7280

    .gradient-card span
      font-size: 1.8rem
      font-weight: 800

    pre.code-block
      background: #0d1117
      border-radius: 8px
      padding: 20px 24px
      margin: 0
      overflow-x: auto
      font-family: var(--arc-font-mono)
      font-size: 0.85rem
      color: #e6edf3
      white-space: pre
