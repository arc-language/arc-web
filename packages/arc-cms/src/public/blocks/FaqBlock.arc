widget FaqBlock(items: Any = [], style: Any = {})
  col class="cms-faq" style="padding:{style.padding ?? '64px 24px'}; background:{style.background ?? 'transparent'}; color:{style.textColor ?? 'inherit'}; text-align:{style.align ?? 'left'}"
    col class="cms-faq-inner" gap="12px" style="max-width:{style.maxWidth ?? '720px'}"
      for item in items
        col class="cms-faq-item"
          text class="cms-faq-q" "{item.question}"
          text class="cms-faq-a" "{item.answer}"

  design
    .cms-faq
      width: 100%
      box-sizing: border-box
    .cms-faq-inner
      width: 100%
      margin: 0 auto
    .cms-faq-item
      padding: 18px 20px
      border-radius: 10px
      background-color: rgba(0,0,0,0.03)
      display: flex
      flex-direction: column
      gap: 8px
    .cms-faq-q
      font-size: 1rem
      font-weight: 600
      margin: 0
    .cms-faq-a
      font-size: 0.95rem
      line-height: 1.6
      opacity: 0.85
      margin: 0
      white-space: pre-wrap
