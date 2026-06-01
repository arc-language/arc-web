import HeroBlock     from "site/blocks/HeroBlock.arc"
import TextBlock     from "site/blocks/TextBlock.arc"
import FeaturesBlock from "site/blocks/FeaturesBlock.arc"
import CtaBlock      from "site/blocks/CtaBlock.arc"
import CodeBlock     from "site/blocks/CodeBlock.arc"
import FaqBlock      from "site/blocks/FaqBlock.arc"
import CmsEditBar    from "site/CmsEditBar.arc"

page "Page"

  @param slug

  @server fn loadPage(pageSlug: String) -> Any
    const isEditor = session && (session.role == "admin" || session.role == "editor")
    const pg = db.pages.findFirst({ where: { slug: pageSlug } })
    if !pg
      return { found: false, page: null, blocks: [], theme: null, editable: false }
    if !pg.published && !isEditor
      return { found: false, page: pg, blocks: [], theme: null, editable: false }
    const blocks = db.pageblocks.findMany({ where: { page: pageSlug, visible: true }, orderBy: { order: "asc" } })
    const parsed = blocks.map(b => ({ id: b.id, type: b.type, data: JSON.parse(b.data ?? "{}") }))
    let theme = null
    if pg.themeId
      theme = db.themes.find(pg.themeId)
    return { found: true, page: pg, blocks: parsed, theme: theme, editable: isEditor }

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

    @raw '<style>:root{' + (function(){try{if(!ctx.theme||!ctx.theme.tokens)return '';return Object.entries(JSON.parse(ctx.theme.tokens)).filter(function(e){return /^[a-zA-Z0-9-]+$/.test(e[0])}).map(function(e){var v=String(e[1]);return /^[\w\s.,#%\-\/]+$/.test(v)?'--cms-'+e[0]+':'+v:''}).filter(Boolean).join(';')}catch(e){return ''}})() + '}</style>'

    if ctx.editable
      CmsEditBar pageId="{ctx.page.id}" pageTitle="{ctx.page.title}" published={ctx.page.published}

    col class="cms-page"
      for block in ctx.blocks
        if block.type == "hero"
          HeroBlock blockId="{block.id}" title="{block.data.title}" subtitle="{block.data.subtitle}" ctaLabel="{block.data.ctaLabel}" ctaHref="{block.data.ctaHref}" style={block.data._style}
        if block.type == "text"
          TextBlock blockId="{block.id}" heading="{block.data.heading}" body="{block.data.body}" style={block.data._style}
        if block.type == "features"
          FeaturesBlock blockId="{block.id}" heading="{block.data.heading}" items={block.data.items} style={block.data._style}
        if block.type == "cta"
          CtaBlock blockId="{block.id}" heading="{block.data.heading}" buttonLabel="{block.data.buttonLabel}" buttonHref="{block.data.buttonHref}" style={block.data._style}
        if block.type == "code"
          CodeBlock blockId="{block.id}" language="{block.data.language}" source="{block.data.source}" style={block.data._style}
        if block.type == "faq"
          FaqBlock blockId="{block.id}" items={block.data.items} style={block.data._style}

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
