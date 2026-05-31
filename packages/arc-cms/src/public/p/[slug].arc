import HeroBlock     from "site/blocks/HeroBlock.arc"
import TextBlock     from "site/blocks/TextBlock.arc"
import FeaturesBlock from "site/blocks/FeaturesBlock.arc"
import CtaBlock      from "site/blocks/CtaBlock.arc"
import CodeBlock     from "site/blocks/CodeBlock.arc"
import FaqBlock      from "site/blocks/FaqBlock.arc"

page "Page"

  @param slug

  @server fn loadPage(pageSlug: String) -> Any
    const pg = db.pages.findFirst({ where: { slug: pageSlug } })
    if !pg
      return { found: false, page: null, blocks: [], theme: null }
    if !pg.published
      return { found: false, page: pg, blocks: [], theme: null }
    const blocks = db.pageblocks.findMany({ where: { page: pageSlug, visible: true }, orderBy: { order: "asc" } })
    const parsed = blocks.map(b => ({ id: b.id, type: b.type, data: JSON.parse(b.data ?? "{}") }))
    let theme = null
    if pg.themeId
      theme = db.themes.find(pg.themeId)
    return { found: true, page: pg, blocks: parsed, theme: theme }

  @live const ctx = loadPage(slug)

  if !ctx.found
    col class="cms-404" align="center"
      heading "Page not found"
      text "No published page exists at /p/{slug}."

  if ctx.found
    meta description="{ctx.page.metaDescription ?? ''}"
    meta og:title="{ctx.page.title}"
    meta og:description="{ctx.page.metaDescription ?? ''}"
    if ctx.page.ogImage
      meta og:image="{ctx.page.ogImage}"

    @raw '<style>:root{' + (ctx.theme && ctx.theme.tokens ? Object.entries(JSON.parse(ctx.theme.tokens)).map(([k,v]) => '--cms-' + k + ':' + v).join(';') : '') + '}</style>'

    col class="cms-page"
      for block in ctx.blocks
        if block.type == "hero"
          HeroBlock title="{block.data.title}" subtitle="{block.data.subtitle}" ctaLabel="{block.data.ctaLabel}" ctaHref="{block.data.ctaHref}" style={block.data._style}
        if block.type == "text"
          TextBlock heading="{block.data.heading}" body="{block.data.body}" style={block.data._style}
        if block.type == "features"
          FeaturesBlock heading="{block.data.heading}" items={block.data.items} style={block.data._style}
        if block.type == "cta"
          CtaBlock heading="{block.data.heading}" buttonLabel="{block.data.buttonLabel}" buttonHref="{block.data.buttonHref}" style={block.data._style}
        if block.type == "code"
          CodeBlock language="{block.data.language}" source="{block.data.source}" style={block.data._style}
        if block.type == "faq"
          FaqBlock items={block.data.items} style={block.data._style}

  design
    body
      margin: 0
      font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif
      background-color: var(--cms-bg, #fff)
      color: var(--cms-fg, #0a0a0a)
    .cms-404
      padding: 120px 24px
      gap: 12px
      color: #666
    .cms-page
      display: flex
      flex-direction: column
