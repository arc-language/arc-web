widget TextBlock(heading: String = "", body: String = "", style: Any = {})
  col class="cms-text" style="padding:{style.padding ?? '40px 24px'}; background:{style.background ?? 'transparent'}; color:{style.textColor ?? 'inherit'}; text-align:{style.align ?? 'left'}"
    col class="cms-text-inner" style="max-width:{style.maxWidth ?? '720px'}"
      if heading
        heading class="cms-text-heading" "{heading}"
      text class="cms-text-body" "{body}"

  design
    .cms-text
      width: 100%
      box-sizing: border-box
    .cms-text-inner
      width: 100%
      margin: 0 auto
      display: flex
      flex-direction: column
      gap: 16px
    .cms-text-heading
      font-size: 1.75rem
      font-weight: 700
      letter-spacing: -0.02em
      margin: 0
    .cms-text-body
      font-size: 1rem
      line-height: 1.7
      margin: 0
      white-space: pre-wrap
