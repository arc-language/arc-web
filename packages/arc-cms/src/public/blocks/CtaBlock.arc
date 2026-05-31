widget CtaBlock(heading: String = "", buttonLabel: String = "", buttonHref: String = "", style: Any = {})
  col class="cms-cta" align="center" style="padding:{style.padding ?? '64px 24px'}; background:{style.background ?? 'transparent'}; color:{style.textColor ?? 'inherit'}; text-align:{style.align ?? 'center'}"
    col class="cms-cta-inner" gap="20px" align="center" style="max-width:{style.maxWidth ?? '640px'}"
      heading class="cms-cta-heading" "{heading}"
      if buttonLabel
        link href="{buttonHref}"
          button class="cms-cta-btn" "{buttonLabel}"

  design
    .cms-cta
      width: 100%
      box-sizing: border-box
    .cms-cta-inner
      width: 100%
      margin: 0 auto
    .cms-cta-heading
      font-size: 1.75rem
      font-weight: 700
      letter-spacing: -0.02em
      margin: 0
    .cms-cta-btn
      padding: 12px 28px
      font-size: 15px
      font-weight: 600
      border-radius: 10px
      border: none
      background-color: var(--cms-accent, #5b8cff)
      color: #fff
      cursor: pointer
