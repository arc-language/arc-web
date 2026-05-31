widget FeaturesBlock(heading: String = "", items: Any = [], style: Any = {})
  col class="cms-features" style="padding:{style.padding ?? '64px 24px'}; background:{style.background ?? 'transparent'}; color:{style.textColor ?? 'inherit'}; text-align:{style.align ?? 'left'}"
    col class="cms-features-inner" style="max-width:{style.maxWidth ?? '1100px'}"
      if heading
        heading class="cms-features-heading" "{heading}"
      row class="cms-features-grid" wrap gap="20px"
        for item in items
          col class="cms-feature"
            text class="cms-feature-icon" "{item.icon}"
            text class="cms-feature-title" "{item.title}"
            text class="cms-feature-body" "{item.body}"

  design
    .cms-features
      width: 100%
      box-sizing: border-box
    .cms-features-inner
      width: 100%
      margin: 0 auto
      display: flex
      flex-direction: column
      gap: 32px
    .cms-features-heading
      font-size: 1.75rem
      font-weight: 700
      margin: 0
    .cms-features-grid
      display: grid
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))
    .cms-feature
      padding: 24px
      border-radius: 12px
      background-color: rgba(0,0,0,0.03)
      display: flex
      flex-direction: column
      gap: 8px
    .cms-feature-icon
      font-size: 28px
    .cms-feature-title
      font-size: 1.05rem
      font-weight: 600
      margin: 0
    .cms-feature-body
      font-size: 0.9rem
      line-height: 1.5
      opacity: 0.8
      margin: 0
