widget CodeBlock(language: String = "js", source: String = "", style: Any = {})
  col class="cms-code" style="padding:{style.padding ?? '32px 24px'}; background:{style.background ?? 'transparent'}; text-align:{style.align ?? 'left'}"
    col class="cms-code-inner" style="max-width:{style.maxWidth ?? '900px'}"
      @raw '<pre class="cms-code-pre"><code class="lang-' + language + '">' + source + '</code></pre>'

  design
    .cms-code
      width: 100%
      box-sizing: border-box
    .cms-code-inner
      width: 100%
      margin: 0 auto
    .cms-code-pre
      padding: 18px 20px
      background-color: #0d1117
      color: #e6edf3
      border-radius: 10px
      font-family: ui-monospace, 'SF Mono', Consolas, monospace
      font-size: 13px
      line-height: 1.6
      overflow-x: auto
      margin: 0
