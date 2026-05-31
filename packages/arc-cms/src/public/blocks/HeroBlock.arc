# HeroBlock - public renderer for hero blocks.
# Receives parsed data (title/subtitle/ctaLabel/ctaHref) and a style object.
widget HeroBlock(title: String, subtitle: String = "", ctaLabel: String = "", ctaHref: String = "", style: Any = {})
  col class="cms-hero" align="center" style="padding:{style.padding ?? '80px 24px'}; background:{style.background ?? 'transparent'}; color:{style.textColor ?? 'inherit'}; text-align:{style.align ?? 'center'}"
    col class="cms-hero-inner" style="max-width:{style.maxWidth ?? '720px'}"
      heading class="cms-hero-title" "{title}"
      if subtitle
        text class="cms-hero-subtitle" "{subtitle}"
      if ctaLabel
        link href="{ctaHref}"
          button class="cms-hero-cta" "{ctaLabel}"

  design
    .cms-hero
      width: 100%
      box-sizing: border-box
    .cms-hero-inner
      width: 100%
      margin: 0 auto
      display: flex
      flex-direction: column
      gap: 18px
      align-items: inherit
    .cms-hero-title
      font-size: clamp(2rem, 6vw, 3.5rem)
      font-weight: 800
      letter-spacing: -0.02em
      line-height: 1.1
      margin: 0
    .cms-hero-subtitle
      font-size: 1.125rem
      line-height: 1.6
      opacity: 0.8
      margin: 0
    .cms-hero-cta
      padding: 12px 24px
      font-size: 15px
      font-weight: 600
      border-radius: 10px
      border: none
      background-color: var(--cms-accent, #5b8cff)
      color: #fff
      cursor: pointer
