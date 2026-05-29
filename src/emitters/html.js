'use strict'

// Module-scope constants hoisted from buildAttrs to avoid per-call allocations
const _FLEX_TAGS = new Set(['row', 'col', 'stack', 'wrap', 'center'])
const _CSS_SHORTHANDS = {
  p: 'padding', m: 'margin',
  'p-x': 'padding-left', 'p-y': 'padding-top',
  'p-t': 'padding-top', 'p-b': 'padding-bottom',
  'p-l': 'padding-left', 'p-r': 'padding-right',
  'm-x': 'margin-left', 'm-y': 'margin-top',
  'm-t': 'margin-top', 'm-b': 'margin-bottom',
  'm-l': 'margin-left', 'm-r': 'margin-right',
  w: 'width', h: 'height',
  'max-w': 'max-width', 'min-w': 'min-width',
  'max-h': 'max-height', 'min-h': 'min-height',
  radius: 'border-radius', shadow: 'box-shadow',
  bg: 'background-color', fg: 'color',
}

// Recursively check whether an AST node subtree contains an <h1> element
function _hasH1(nodes, depth = 0) {
  if (!Array.isArray(nodes) || depth > 20) return false
  for (const n of nodes) {
    if (n?.type === 'Element' && n.tag === 'h1') return true
    if (_hasH1(n?.children ?? [], depth + 1)) return true
    if (n?.type === 'IfNode' || n?.type === 'UnlessNode') {
      if (_hasH1(n.consequent ?? [], depth + 1) || _hasH1(n.alternate ?? [], depth + 1)) return true
    }
    if (n?.type === 'ForNode') {
      const b = n.body; if (_hasH1(Array.isArray(b) ? b : (b ? [b] : []), depth + 1)) return true
    }
    if (n?.type === 'MatchTemplateNode') {
      for (const arm of n.arms ?? []) {
        const b = arm.body; if (_hasH1(Array.isArray(b) ? b : (b ? [b] : []), depth + 1)) return true
      }
    }
  }
  return false
}

const _INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary'])

// Locale maps hoisted to module scope - constructed once, not per-element-emit
const _LOCALE_NEW_TAB = { en: '(opens in new tab)', fr: '(ouvre dans un nouvel onglet)', es: '(se abre en nueva pestaña)', de: '(öffnet in neuem Tab)', pt: '(abre em nova aba)', ja: '(新しいタブで開く)', zh: '（在新标签页中打开）', ar: '(يفتح في علامة تبويب جديدة)' }
const _LOCALE_CLOSE_DIALOG = { en: 'Close dialog', fr: 'Fermer la boîte de dialogue', es: 'Cerrar diálogo', de: 'Dialog schließen', pt: 'Fechar diálogo', ja: 'ダイアログを閉じる', zh: '关闭对话框', ar: 'إغلاق مربع الحوار' }
const _LOCALE_SKIP_LINK = { en: 'Skip to main content', fr: 'Aller au contenu principal', es: 'Ir al contenido principal', de: 'Zum Hauptinhalt springen', pt: 'Ir para o conteúdo principal', ja: 'メインコンテンツへスキップ', zh: '跳到主要内容', ar: 'تخطى إلى المحتوى الرئيسي' }
const _LOCALE_DETAILS = { en: 'Details', fr: 'Détails', es: 'Detalles', de: 'Details', pt: 'Detalhes', ja: '詳細', zh: '详情', ar: 'تفاصيل' }

// BCP 47-aware locale lookup: tries full tag (zh-TW) then primary subtag (zh) then 'en'
function _localize(map, lang) {
  return map[lang] ?? map[(lang ?? 'en').split('-')[0]] ?? map['en']
}

const _ESC_RE = /[&<>"']/g
const _ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }

// U+2028/U+2029 are JS line terminators: must be escaped when embedded in inline event handlers
const _LS2028 = '\u2028', _LS2029 = '\u2029'
function _safeInlineId(val) {
  return JSON.stringify(String(val))
    .split(_LS2028).join('\\u2028')
    .split(_LS2029).join('\\u2029')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function _hasRealLabel(v, emitter) {
  return v && (typeof v === 'string' || (typeof v === 'object' && v.type && emitter.isStaticExpr(v)))
}

// Maps Arc element names to HTML element names
const ELEMENT_MAP = {
  // Arc layout primitives → semantic/div HTML
  card: 'div',
  row: 'div',
  col: 'div',
  stack: 'div',
  center: 'div',
  spacer: 'div',
  wrap: 'div',
  badge: 'span',
  tag: 'span',
  avatar: 'img',
  icon: 'span',

  // Arc semantic → same HTML
  page: null,        // handled specially
  widget: null,      // handled specially
  heading: 'h2',    // default level, overridden by size attr
  text: 'p',
  paragraph: 'p',
  link: 'a',
  divider: 'hr',

  // Pass-through (same name)
  nav: 'nav',
  main: 'main',
  header: 'header',
  footer: 'footer',
  aside: 'aside',
  article: 'article',
  section: 'section',
  figure: 'figure',
  figcaption: 'figcaption',
  blockquote: 'blockquote',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  span: 'span',
  img: 'img',
  button: 'button',
  input: 'input',
  select: 'select',
  textarea: 'textarea',
  form: 'form',
  label: 'label',
  fieldset: 'fieldset',
  code: 'code',
  pre: 'pre',
  kbd: 'kbd',
  video: 'video',
  audio: 'audio',
  canvas: 'canvas',
  table: 'table',
  tr: 'tr',
  cell: 'td',
  td: 'td',
  th: 'th',
  thead: 'thead',
  tbody: 'tbody',
  details: 'details',
  summary: 'summary',
  modal: 'dialog',
  h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6',
  p: 'p',
  a: 'a',
  em: 'em',
  strong: 'strong',
  time: 'time',
}

// Arc layout primitive → default CSS classes
const ELEMENT_CLASSES = {
  row: ['arc-row'],
  col: ['arc-col'],
  stack: ['arc-col'],
  center: ['arc-center'],
  spacer: ['arc-spacer'],
  card: ['arc-card'],
  wrap: ['arc-wrap'],
}

// Void elements that don't need closing tags
const VOID_ELEMENTS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'])

class HtmlEmitter {
  constructor(options = {}) {
    this.options = options
    this.componentHash = options.hash ?? 'arc'
    this.buildContext = options.buildContext ?? {}  // @build name → value
    this.reactiveIds = new Map()  // expr string → generated id
    this.reactiveCounter = 0
    this.eventBindings = []       // collected event bindings for JS emitter
    this.stateBindings = []       // collected state bindings
    this.indent = 0
    this.widgets = new Map()      // name → WidgetDecl
    this.currentAttrs = {}        // @attr values for current widget invocation
    this.imgPipeline = options.imgPipeline ?? null  // optional ImagePipeline instance
    this._imgOrdinal = 0          // increments for each img encountered (for above-fold detection)
    this._sawSection = false      // toggles true after first <section>
    this._currentLang = 'en'     // set in emitPage(); used by locale-aware helpers before page is emitted
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  emitProgram(program) {
    // Register all widgets first so they can be used by name in templates
    for (const decl of program.declarations) {
      if (decl.type === 'WidgetDecl') {
        this.widgets.set(decl.name, decl)
      }
    }
    const parts = []
    for (const decl of program.declarations) {
      if (decl.type === 'PageDecl') {
        parts.push(this.emitPage(decl))
      }
      // Widgets are only emitted when invoked, not as top-level fragments
    }
    return parts.join('\n')
  }

  emitPage(node) {
    const title = node.title ? this.evalStaticExpr(node.title) : 'Arc App'
    const lang = node.meta?.lang ? this.evalStaticExpr(node.meta.lang) : 'en'
    this._currentLang = lang
    const description = node.meta?.description ? this.evalStaticExpr(node.meta.description) : ''
    const meta = node.meta ?? {}
    const evalMeta = (k) => meta[k] ? this.evalStaticExpr(meta[k]) : ''
    const seo = {
      canonical: evalMeta('canonical'),
      image: evalMeta('image'),
      author: evalMeta('author'),
      published: evalMeta('published'),
      modified: evalMeta('modified'),
      keywords: evalMeta('keywords'),
      schemaType: evalMeta('schemaType') || (meta.schemaType ? 'Article' : ''),
      twitterSite: evalMeta('twitterSite'),
      ogType: evalMeta('ogType') || 'website',
      siteName: evalMeta('siteName'),
      robots: evalMeta('robots'),
    }

    // Don't double-wrap if the page already has a top-level <main>
    const hasUserMain = (node.body ?? []).some(
      n => n.type === 'Element' && (n.tag === 'main' || n.attrs?.role === 'main')
    )
    // a11y: warn at compile time if user's <main> has no <h1> - screen readers use the h1 as page title
    if (hasUserMain && !_hasH1(node.body ?? [])) {
      console.warn(`[arc] a11y: page "${title}" has a <main> but no <h1> inside it — add an <h1> so screen reader users can identify the page topic`)
    }

    // Ensure skip link target exists: inject id="main-content" on user's <main> if not already set
    const bodyNodes = hasUserMain
      ? (node.body ?? []).map(n => {
          if (n.type === 'Element' && (n.tag === 'main' || n.attrs?.role === 'main') && !n.id && !n.attrs?.id) {
            return { ...n, id: 'main-content' }
          }
          return n
        })
      : (node.body ?? [])

    const bodyContent = this.emitChildren(bodyNodes)

    // Build JSON-LD only when a schemaType was requested
    const jsonLd = seo.schemaType ? {
      '@context': 'https://schema.org',
      '@type': seo.schemaType,
      name: title,
      headline: title,
      ...(description && { description }),
      ...(seo.image && { image: seo.image }),
      ...(seo.author && { author: { '@type': 'Person', name: seo.author } }),
      ...(seo.published && { datePublished: seo.published }),
      ...(seo.modified && { dateModified: seo.modified }),
      ...(seo.canonical && { url: seo.canonical }),
    } : null

    return [
      '<!DOCTYPE html>',
      `<html lang="${this.escape(lang)}">`,
      ...this._emitHead(title, description, seo, jsonLd),
      '</head>',
      '<body>',
      // Skip link text: override via page meta { skipLinkText: "..." }, or built-in locale defaults
      `<a href="#main-content" class="arc-skip-link">${this.escape(
        node.meta?.skipLinkText ? this.evalStaticExpr(node.meta.skipLinkText)
          : _localize(_LOCALE_SKIP_LINK, lang)
      )}</a>`,
      hasUserMain ? '' : `<main id="main-content" aria-label="${this.escape(title)}">`,
      hasUserMain ? '' : `<h1 class="arc-sr-only">${this.escape(title)}</h1>`,
      bodyContent,
      hasUserMain ? '' : '</main>',
      '</body>',
      '</html>',
    ].filter(Boolean).join('\n')
  }

  _emitHead(title, description, seo, jsonLd) {
    return [
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      `<meta name="robots" content="${this.escape(seo?.robots ?? 'index,follow')}">`,
      '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; object-src \'none\'; base-uri \'self\'; form-action \'self\';">',
      `<title>${this.escape(title)}</title>`,
      description ? `<meta name="description" content="${this.escape(description)}">` : '',
      seo.keywords ? `<meta name="keywords" content="${this.escape(seo.keywords)}">` : '',
      seo.author ? `<meta name="author" content="${this.escape(seo.author)}">` : '',
      seo.canonical ? `<link rel="canonical" href="${this.escape(seo.canonical)}">` : '',
      // Open Graph
      `<meta property="og:title" content="${this.escape(title)}">`,
      description ? `<meta property="og:description" content="${this.escape(description)}">` : '',
      `<meta property="og:type" content="${this.escape(seo.ogType)}">`,
      seo.canonical ? `<meta property="og:url" content="${this.escape(seo.canonical)}">` : '',
      seo.image ? `<meta property="og:image" content="${this.escape(seo.image)}">` : '',
      seo.siteName ? `<meta property="og:site_name" content="${this.escape(seo.siteName)}">` : '',
      `<meta property="og:locale" content="${this.escape(this._ogLocale())}">`,
      // Twitter Card
      `<meta name="twitter:card" content="${seo.image ? 'summary_large_image' : 'summary'}">`,
      `<meta name="twitter:title" content="${this.escape(title)}">`,
      description ? `<meta name="twitter:description" content="${this.escape(description)}">` : '',
      seo.image ? `<meta name="twitter:image" content="${this.escape(seo.image)}">` : '',
      seo.twitterSite ? `<meta name="twitter:site" content="${this.escape(seo.twitterSite)}">` : '',
      // JSON-LD structured data
      jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}</script>` : '',
      '<link rel="stylesheet" href="styles.css">',
    ]
  }

  _ogLocale() {
    const l = (this._currentLang ?? 'en').replace('-', '_')
    if (l.includes('_')) return l
    // Map primary language subtags to their canonical OG locale — fallback doubles the subtag
    const _OG_LOCALE_MAP = { en: 'en_US', fr: 'fr_FR', de: 'de_DE', es: 'es_ES', pt: 'pt_BR', ja: 'ja_JP', zh: 'zh_CN', ar: 'ar_SA', nl: 'nl_NL', it: 'it_IT', ko: 'ko_KR', ru: 'ru_RU', pl: 'pl_PL', sv: 'sv_SE', da: 'da_DK', fi: 'fi_FI', nb: 'nb_NO' }
    return _OG_LOCALE_MAP[l] ?? `${l}_${l.toUpperCase()}`
  }

  emitWidget(node) {
    return this.emitChildren(node.body)
  }

  emitWidgetInvocation(widgetDecl, attrs, slotChildren) {
    // Save and replace currentAttrs/slotChildren for this widget invocation
    const outerAttrs = this.currentAttrs
    const outerSlot = this.slotChildren
    // Resolve attr values: string literals, static exprs
    const resolvedAttrs = {}
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v === true) resolvedAttrs[k] = true
      else if (v && typeof v === 'object' && v.type) {
        resolvedAttrs[k] = this.isStaticExpr(v) ? this.evalStaticExpr(v) : this.emitExpr(v)
      } else {
        resolvedAttrs[k] = v
      }
    }
    // Apply param defaults for any param not explicitly passed
    for (const param of (widgetDecl.params ?? [])) {
      if (param.name && !Object.prototype.hasOwnProperty.call(resolvedAttrs, param.name) && param.defaultValue != null) {
        const dv = param.defaultValue
        if (dv.type === 'Literal') {
          resolvedAttrs[param.name] = dv.value
        } else if (this.isStaticExpr(dv)) {
          resolvedAttrs[param.name] = this.evalStaticExpr(dv)
        } else {
          resolvedAttrs[param.name] = this.emitExpr(dv)
        }
      }
    }
    this.currentAttrs = resolvedAttrs
    this.slotChildren = slotChildren ?? []
    const result = this.emitChildren(widgetDecl.body)
    this.currentAttrs = outerAttrs
    this.slotChildren = outerSlot
    return result
  }

  emitExpr(expr) {
    if (!expr) return ''
    if (expr.type === 'Literal') return this.escape(String(expr.value ?? ''))
    if (expr.type === 'TemplateLiteral') {
      return expr.parts.map(p => p.type === 'Literal' ? this.escape(String(p.value ?? '')) : '').join('')
    }
    return ''
  }

  // ── Template node emission ─────────────────────────────────────────────────

  emitChildren(children) {
    if (!children || children.length === 0) return ''
    const parts = []
    for (const c of children) {
      const s = this.emitNode(c)
      if (s) parts.push(s)
    }
    return parts.join('\n')
  }

  emitNode(node) {
    if (!node) return ''

    switch (node.type) {
      case 'Element':           return this.emitElement(node)
      case 'TextNode':          return this.emitText(node)
      case 'InterpolationNode': return this.emitInterpolation(node)
      case 'TemplateLiteral':   return this.emitTemplateLiteral(node)
      case 'IfNode':            return this.emitIf(node)
      case 'UnlessNode':        return this.emitUnless(node)
      case 'ForNode':           return this.emitFor(node)
      case 'MatchTemplateNode': return this.emitMatchTemplate(node)
      case 'RawNode':           return this.emitRaw(node)
      default:                  return ''
    }
  }

  emitElement(node) {
    const { tag, classes: _classes = [], attrs = {}, children = [] } = node
    let classes = _classes
    let { id } = node

    // Widget invocation: inline the widget body with bound attrs
    if (this.widgets.has(tag)) {
      return this.emitWidgetInvocation(this.widgets.get(tag), attrs, children)
    }

    // Check for native pattern overrides
    if (tag === 'modal') return this.emitModal(node)
    if (tag === 'tooltip') return this.emitTooltip(node)
    if (tag === 'accordion') return this.emitAccordion(node)
    if (tag === 'slider') return this.emitSlider(node)
    if (tag === 'section') this._sawSection = true

    // <img>: route through the image pipeline when available (sharp + processed).
    // Pipeline handles AVIF/WebP transcoding, srcset, lazy/eager, dominant color.
    if (tag === 'img' && this.imgPipeline) {
      const rawSrc = attrs.src
      const src = (rawSrc && rawSrc.type) ? this.evalStaticExpr(rawSrc) : rawSrc
      if (typeof src === 'string') {
        const alt = (attrs.alt && attrs.alt.type) ? this.evalStaticExpr(attrs.alt) : (attrs.alt ?? '')
        const ordinal = this._imgOrdinal++
        const position = (!this._sawSection && ordinal < 2) ? 'above-fold' : 'below-fold'
        const picture = this.imgPipeline.emitPicture(src, alt, position)
        if (picture) return picture
      }
    }

    // tooltip="" attribute on any element: wrap with tooltip anchor
    if (attrs.tooltip) {
      const rawTip = attrs.tooltip
      const tipText = (rawTip && rawTip.type) ? this.evalStaticExpr(rawTip) : rawTip
      return this.emitTooltipAttr(node, String(tipText))
    }

    // Single pass: collect bind:/on: bindings AND pre-filter static attrs for HTML output.
    // This eliminates the second traversal in buildAttrs which would otherwise re-scan all attrs.
    const { staticAttrs, id: collectedId } = this._collectBindings(node)
    if (collectedId && !id) id = collectedId

    // Merge class="" attr into the classes list so we emit a single class attribute.
    // class="nav" ends up in attrs.class (separate from node.classes which uses .dot syntax).
    // Without this merge, emitElement emits two class attributes and browsers take the first,
    // so user-defined CSS selectors like .nav_hash never apply.
    const rawClassAttr = staticAttrs.class
    if (rawClassAttr !== undefined) {
      delete staticAttrs.class
      const classStr = (rawClassAttr && typeof rawClassAttr === 'object' && rawClassAttr.type)
        ? (this.isStaticExpr(rawClassAttr) ? String(this.evalStaticExpr(rawClassAttr) ?? '') : '')
        : String(rawClassAttr ?? '')
      const extraClasses = classStr.split(/\s+/).filter(Boolean)
      if (extraClasses.length > 0) classes = [...classes, ...extraClasses]
    }

    let htmlTag = ELEMENT_MAP[tag] ?? tag

    // heading size=N → <hN>. Strip size so it doesn't render as an invalid HTML attr.
    if (tag === 'heading' && staticAttrs.size != null) {
      const rawSize = staticAttrs.size
      const sizeVal = (rawSize && typeof rawSize === 'object' && rawSize.type)
        ? this.evalStaticExpr(rawSize) : rawSize
      const n = Number(sizeVal)
      if (Number.isInteger(n) && n >= 1 && n <= 6) {
        htmlTag = `h${n}`
        delete staticAttrs.size
      }
    }

    // Skip allocations for elements with no layout or user classes (majority of elements)
    // Base structural classes (arc-row, arc-col, etc.) are defined globally without hash - don't scope them.
    // User-defined classes get the component hash to prevent cross-component CSS leakage.
    const baseClasses = ELEMENT_CLASSES[tag]
    const scopedClasses = (baseClasses != null || classes.length > 0)
      ? [
          ...(baseClasses ?? []),
          ...classes.map(c => c.startsWith('!') ? c.slice(1) : `${c}_${this.componentHash}`)
        ]
      : []

    const attrStr = this.buildAttrs(id, scopedClasses, staticAttrs, node)

    if (VOID_ELEMENTS.has(htmlTag)) {
      return `<${htmlTag}${attrStr}>`
    }

    let inner = this.emitChildren(children)

    // Append a visually-hidden "opens in new tab" notice for screen readers
    // on auto-injected target="_blank" links (matches the auto-injection above).
    // Check staticAttrs (not raw attrs): bind:aria-label entries stay in attrs but are
    // filtered out of staticAttrs, so a reactive label doesn't suppress this notice.
    if (htmlTag === 'a' && staticAttrs.target === '_blank' && !_hasRealLabel(staticAttrs['aria-label'], this) && !_hasRealLabel(staticAttrs['aria-labelledby'], this)) {
      inner += `<span class="arc-sr-only"> ${_localize(_LOCALE_NEW_TAB, this._currentLang)}</span>`
    }

    return `<${htmlTag}${attrStr}>${inner}</${htmlTag}>`
  }

  // Single-pass collection of bind:/on: bindings and static attrs.
  // Returns { staticAttrs, id } where id is the reactive element id (or null).
  _collectBindings(node) {
    const { tag, attrs = {} } = node
    let id = node.id ?? null
    const staticAttrs = {}
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('bind:')) {
        if (!id) id = this.getReactiveId(`bind_${tag}_${node.line}`)
        if (value?.type === 'MemberExpr') {
          // Dotted path: user.name → expr="user.name", bindRoot="user"
          const exprStr = this.exprToString(value)
          const bindRoot = this._extractRootIdent(value)
          if (!bindRoot) {
            throw new Error(`Arc: bind:value path must be a simple variable or dotted path (e.g. user.name), got: ${exprStr}`)
          }
          this.stateBindings.push({ id, expr: exprStr, bindRoot, kind: 'bind', line: node.line })
        } else {
          const boundName = value?.type === 'Identifier' ? value.name
            : value?.type === 'AtProperty' ? value.name
            : (typeof value === 'string' ? value : null)
          if (boundName) {
            this.stateBindings.push({ id, expr: boundName, kind: 'bind', line: node.line })
          }
        }
        // bind: attrs are JS-only: don't include in HTML output
      } else if (key.startsWith('on:')) {
        if (!id) id = this.getReactiveId(`ev_${tag}_${node.line}`)
        const event = key.slice(3)
        this.eventBindings.push({ elementId: id, event, handler: value, line: node.line })
        // on: attrs are JS-only: don't include in HTML output
      } else {
        staticAttrs[key] = value
      }
    }
    return { staticAttrs, id }
  }

  // attrs has already had bind:/on: filtered out by emitElement.
  // Only "tooltip" needs to be skipped here (consumed by emitTooltipAttr wrapper).
  buildAttrs(id, classes, attrs, node) {
    const parts = []

    if (id) parts.push(`id="${this.escape(id)}"`)

    if (classes.length > 0) {
      parts.push(`class="${classes.map(c => this.escape(c)).join(' ')}"`)
    }

    // Arc layout/style attributes → inline CSS style properties.
    // These never render as valid HTML attributes so must be intercepted here.
    {
      const styleParts = []

      // Flex-container-only attrs
      if (_FLEX_TAGS.has(node.tag)) {
        if (attrs.align !== undefined) {
          styleParts.push(`align-items:${this._resolveAttrVal(attrs.align)}`)
          delete attrs.align
        }
        if (attrs.justify !== undefined) {
          styleParts.push(`justify-content:${this._resolveAttrVal(attrs.justify)}`)
          delete attrs.justify
        }
        if (attrs.gap !== undefined) {
          styleParts.push(`gap:${this._resolveAttrVal(attrs.gap)}`)
          delete attrs.gap
        }
      }

      // Universal CSS shorthand attrs (any element)
      for (const [shorthand, cssProp] of Object.entries(_CSS_SHORTHANDS)) {
        if (attrs[shorthand] !== undefined) {
          // p-x and m-x expand to two properties
          if (shorthand === 'p-x') {
            const v = this._resolveAttrVal(attrs[shorthand])
            styleParts.push(`padding-left:${v}`, `padding-right:${v}`)
          } else if (shorthand === 'm-x') {
            const v = this._resolveAttrVal(attrs[shorthand])
            styleParts.push(`margin-left:${v}`, `margin-right:${v}`)
          } else if (shorthand === 'p-y') {
            const v = this._resolveAttrVal(attrs[shorthand])
            styleParts.push(`padding-top:${v}`, `padding-bottom:${v}`)
          } else if (shorthand === 'm-y') {
            const v = this._resolveAttrVal(attrs[shorthand])
            styleParts.push(`margin-top:${v}`, `margin-bottom:${v}`)
          } else {
            styleParts.push(`${cssProp}:${this._resolveAttrVal(attrs[shorthand])}`)
          }
          delete attrs[shorthand]
        }
      }

      if (styleParts.length > 0) {
        const existing = attrs.style ? this._resolveAttrVal(attrs.style) : ''
        const merged = existing ? existing + ';' + styleParts.join(';') : styleParts.join(';')
        parts.push(`style="${this.escape(merged)}"`)
        delete attrs.style
      }
    }

    for (const [key, rawValue] of Object.entries(attrs)) {
      if (key === 'tooltip') continue

      // Resolve AST node to its static value when possible
      const value = (rawValue && typeof rawValue === 'object' && rawValue.type)
        ? (this.isStaticExpr(rawValue) ? this.evalStaticExpr(rawValue) : rawValue)
        : rawValue

      if (this._emitSpecialAttr(key, value, parts, node)) continue

      if (value === true) {
        parts.push(this.escape(key))
      } else if (value !== false && value !== undefined) {
        const safeValue = this._safeUri(key, value)
        if (safeValue === null) {
          parts.push(`${this.escape(key)}="#"`)
          continue
        }
        parts.push(`${this.escape(key)}="${this.escape(String(safeValue))}"`)
      }
    }

    this._applyAutoAttrs(node, attrs, parts)

    return parts.length > 0 ? ' ' + parts.join(' ') : ''
  }

  // Handles special-case attribute keys. Pushes to parts and returns true if handled, false otherwise.
  _emitSpecialAttr(key, value, parts, node) {
    // <dialog> trigger: trigger="id" → onclick that calls showModal() then focuses first focusable child
    if (key === 'trigger') {
      const safeId = _safeInlineId(value)
      // safeId is JSON.stringify(id) with " → &quot; (via _safeInlineId), so onclick is XSS-safe.
      // &quot; inside onclick="..." is decoded by the browser before JS executes.
      // requestAnimationFrame defers focus until after the dialog is painted - avoids silent focus
      // failure in Safari where the dialog display transition isn't complete at showModal() time.
      const _action = `var _d=document.getElementById(${safeId});if(_d){_d.showModal();var _f=_d.querySelector('button,input,select,textarea,a[href],[tabindex]:not([tabindex=&quot;-1&quot;])');if(_f)requestAnimationFrame(function(){_f.focus();});}`
      parts.push(`onclick="${_action}"`)
      // Keyboard accessibility: non-interactive elements need tabindex + role so keyboard users can trigger them
      const tag = node?.tag ?? ''
      parts.push('aria-haspopup="dialog"')
      parts.push(`aria-controls="${this.escape(String(value))}"`)
      if (!_INTERACTIVE_TAGS.has(tag)) {
        parts.push('tabindex="0"')
        parts.push('role="button"')
        // Enter/Space don't fire onclick on non-button elements with role="button"
        parts.push(`onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${_action}}"`)
      }
      return true
    }
    // <dialog> close: close="id" → onclick that calls close()
    if (key === 'close') {
      const safeId = _safeInlineId(value)
      const _action = `var _d=document.getElementById(${safeId});if(_d)_d.close()`
      parts.push(`onclick="${_action}"`)
      const tag = node?.tag ?? ''
      parts.push(`aria-controls="${this.escape(String(value))}"`)
      // Only inject aria-label for icon-only close triggers — if element has visible text, use that instead
      const hasVisibleText = (node?.children ?? []).some(c => c.type === 'TextNode' && c.text?.trim())
      if (!hasVisibleText && !node?.attrs?.['aria-label']) {
        parts.push(`aria-label="${this.escape(_localize(_LOCALE_CLOSE_DIALOG, this._currentLang))}"`)
      }
      if (!_INTERACTIVE_TAGS.has(tag)) {
        parts.push('tabindex="0"')
        parts.push('role="button"')
        parts.push(`onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${_action}}"`)
      }
      return true
    }
    // Native dialog attrs (legacy)
    if (key === 'dialog:open') {
      parts.push(`data-arc-dialog-open="${this.escape(String(value))}"`)
      return true
    }
    if (key === 'dialog:close' || key === 'dialog:cancel') {
      parts.push(`data-arc-dialog-close`)
      return true
    }
    return false
  }

  // Returns the safe string value for URI attributes, or null if the value is dangerous.
  // Non-URI attributes are returned as-is (the value unchanged).
  _safeUri(key, value) {
    if (key === 'href' || key === 'src' || key === 'action' || key === 'formaction') {
      let normalized = String(value)
      // Decode percent-encoding iteratively until stable - prevents double-encoded bypasses
      // like javascript%253A → javascript%3A → javascript: slipping through a single-pass check.
      for (let _i = 0; _i < 10; _i++) {
        try { const _d = decodeURIComponent(normalized); if (_d === normalized) break; normalized = _d } catch { break }
      }
      // Strip all whitespace (including Unicode) and control characters before scheme comparison
      normalized = normalized.replace(/[\u0000-\u001F\u007F-\u009F\u00AD\uFEFF\s]/g, '').toLowerCase()
      if (normalized.startsWith('javascript:') || normalized.startsWith('data:') || normalized.startsWith('vbscript:') || normalized.startsWith('blob:')) {
        return null
      }
    }
    return value
  }

  // Applies HTML semantic auto-enhancements by pushing additional attribute strings onto parts.
  // Handles: img defaults, button type injection, external link rel/target, icon aria-hidden.
  _applyAutoAttrs(node, attrs, parts) {
    if (node.tag === 'img') {
      if (!attrs.loading) parts.push('loading="lazy"')
      if (!attrs.decoding) parts.push('decoding="async"')
      if (attrs.alt === undefined) parts.push('alt=""')
    }
    // <avatar> maps to <img>. A missing alt makes the identity image invisible to AT users.
    if (node.tag === 'avatar' && attrs.alt === undefined) {
      process.stderr.write(`[arc] a11y: <avatar> at line ${node.line ?? '?'} is missing alt= — add alt="Person's name" for identity images, or alt="" if purely decorative\n`)
    }

    // <button> defaults to type="submit" inside a <form> per HTML spec.
    // Arc buttons typically use on:click handlers - submit-by-default is a
    // surprise. Inject type="button" unless the user explicitly opted in.
    if (node.tag === 'button' && attrs.type === undefined) {
      parts.push('type="button"')
    }

    const hrefVal = attrs.href && attrs.href.type ? this.evalStaticExpr(attrs.href) : attrs.href
    const isLink = node.tag === 'a' || node.tag === 'link'
    const hrefStr = hrefVal != null ? String(hrefVal) : ''
    if (isLink && (hrefStr.startsWith('https://') || hrefStr.startsWith('http://'))) {
      if (!attrs.target) parts.push('target="_blank"')
      if (!attrs.rel) parts.push('rel="noopener noreferrer"')
    }

    // Auto-inject aria-hidden on decorative icon elements
    if (node.tag === 'icon') {
      if (!attrs['aria-label']) parts.push('aria-hidden="true"')
      else parts.push('role="img"')
    }
  }

  emitText(node) {
    return this.escape(node.value)
  }

  emitTemplateLiteral(node) {
    // A template literal mixes static string parts and reactive expressions.
    // Render each part inline (no wrapper element).
    return node.parts.map(part => {
      if (part.type === 'Literal') {
        const s = String(part.value)
        // In for-template mode, static parts must have backticks/$ escaped (done by emitForBodyTemplate wrapper)
        return this.escape(s)
      }
      // Expression part
      const exprStr = this.exprToString(part)
      if (this.isStaticExpr(part)) {
        const val = this.evalStaticExpr(part)
        return val !== undefined ? this.escape(String(val)) : ''
      }
      // Inside a for-loop template: inline the expression
      if (this._inForTemplate) {
        return `\${_esc(String(${exprStr}??''))}`
      }
      const id = this.getReactiveId(exprStr)
      this.stateBindings.push({ id, expr: exprStr, line: node.line })
      return `<span id="${id}" data-arc-live></span>`
    }).join('')
  }

  emitInterpolation(node) {
    // For reactive expressions, emit a placeholder span with an ID
    const exprStr = this.exprToString(node.expr)

    if (this.isStaticExpr(node.expr)) {
      return this.escape(this.evalStaticExpr(node.expr))
    }

    // Inside a for-loop template: inline the expression as ${_esc(...)} so each item renders correctly
    if (this._inForTemplate) {
      return `\${_esc(String(${exprStr}??''))}`
    }

    // Reactive: emit a span placeholder (no aria-live: avoid announcing every tiny text update)
    const id = this.getReactiveId(exprStr)
    this.stateBindings.push({ id, expr: exprStr, line: node.line })
    return `<span id="${id}" data-arc-live></span>`
  }

  emitIf(node) {
    const condStr = this.exprToString(node.condition)

    if (this.isStaticExpr(node.condition)) {
      const val = this.evalStaticExpr(node.condition)
      return val ? this.emitChildren(node.consequent)
                 : (node.alternate ? this.emitChildren(node.alternate) : '')
    }

    // Reactive if: wrap in data-arc-if container
    const ifId = this.getReactiveId(`if_${condStr}`)
    const elseId = node.alternate ? this.getReactiveId(`else_${condStr}`) : null

    this.stateBindings.push({ id: ifId, expr: condStr, kind: 'if-show', line: node.line })
    if (elseId) this.stateBindings.push({ id: elseId, expr: condStr, kind: 'if-hide', line: node.line })

    const ifContent = this.emitChildren(node.consequent)
    const elseContent = node.alternate ? this.emitChildren(node.alternate) : ''

    const ifHtml = `<div id="${ifId}" hidden>${ifContent}</div>`
    const elseHtml = elseId ? `<div id="${elseId}">${elseContent}</div>` : ''

    // No aria-live by default - most reactive changes are visual-only. Authors opt in
    // with an explicit aria-live attr on a parent element when content changes are meaningful to AT.
    return `<div>${ifHtml}${elseHtml ? '\n' + elseHtml : ''}</div>`
  }

  emitUnless(node) {
    // unless X = if !X (UnlessNode has 'body', not 'consequent')
    return this.emitIf({
      ...node,
      type: 'IfNode',
      condition: { type: 'UnaryExpr', op: '!', operand: node.condition },
      consequent: node.consequent ?? node.body,
      alternate: null,
    })
  }

  emitFor(node) {
    const collStr = this.exprToString(node.collection)

    if (this.isStaticExpr(node.collection)) {
      // Build-time loop: unroll to static HTML
      const items = this.evalStaticExpr(node.collection)
      if (Array.isArray(items)) {
        return items.map((item, i) => {
          return this.emitForBody(node.body, item, i, node.itemName ?? 'item', node.indexName ?? 'i')
        }).join('\n')
      }
      return ''
    }

    // Reactive for: emit a container, JS will manage children
    const listId = this.getReactiveId(`list_${collStr}`)

    // Extract key= attr from first body node (for keyed diffing)
    const firstChild = node.body?.[0]
    const keyAttr = (firstChild?.type === 'Element') ? firstChild.attrs?.key : null
    const keyExpr = keyAttr ? this.exprToString(keyAttr) : null

    // Emit body as a JS template-literal source with item expressions inlined
    const bodyTpl = this.emitForBodyTemplate(node.body, node.itemName ?? 'item', node.indexName ?? 'i', keyExpr)
    this.stateBindings.push({
      id: listId,
      expr: collStr,
      kind: 'list',
      itemName: node.itemName,
      indexName: node.indexName,
      bodyTemplate: bodyTpl,
      bodyIsTemplate: true,
      keyExpr,
      line: node.line
    })

    return `<div id="${listId}"></div>`
  }

  emitForBody(bodyNodes, item, index, itemName = 'item', indexName = 'i') {
    // Static unrolling: inject item and index into buildContext so evalStaticExpr
    // can resolve expressions like {post.title} against the actual item data
    const prevBuildContext = this.buildContext
    this.buildContext = { ...prevBuildContext, [itemName]: item, [indexName]: index }
    const html = this.emitChildren(bodyNodes)
    this.buildContext = prevBuildContext
    return html
  }

  // Emit a for-loop body as a JS template-literal source string.
  // Item property expressions are inlined as ${_esc(item.field)}: no global reactive spans needed.
  // When keyExpr is provided, strips key= from the root element and injects data-arc-key instead.
  _withForContext(itemName, indexName, fn) {
    if (!this._forStack) this._forStack = []
    this._forStack.push({ itemName: this._forItemName, indexName: this._forIndexName, inFor: this._inForTemplate })
    this._forItemName = itemName
    this._forIndexName = indexName
    this._inForTemplate = true
    try {
      return fn()
    } finally {
      const frame = this._forStack.pop()
      this._forItemName = frame.itemName
      this._forIndexName = frame.indexName
      this._inForTemplate = frame.inFor
    }
  }

  emitForBodyTemplate(bodyNodes, itemName, indexName, keyExpr) {
    // Strip key= from root element attrs before emitting, then inject data-arc-key
    let nodes = bodyNodes
    if (keyExpr && bodyNodes?.[0]?.type === 'Element' && bodyNodes[0].attrs?.key) {
      const { key: _k, ...rest } = bodyNodes[0].attrs
      nodes = [{ ...bodyNodes[0], attrs: rest }, ...bodyNodes.slice(1)]
    }

    let html = this._withForContext(itemName, indexName, () => this.emitChildren(nodes))

    // Escape backticks and bare $ in the static HTML portions, then return as template-literal source
    html = html.replace(/`/g, '\\`').replace(/\$(?!\{)/g, '\\$')

    // Inject data-arc-key AFTER the backtick-escape pass so keyExpr is not double-escaped
    if (keyExpr) {
      // Sanitize keyExpr: escape any backticks/backslashes that would break the outer template literal
      const safeKeyExpr = keyExpr.replace(/\\/g, '\\\\').replace(/`/g, '\\`')
      const keyVal = `\${_esc(String(${safeKeyExpr}??''))}`
      // Insert data-arc-key after the first tag opening.
      // Use a quoted-attribute-aware regex so a > inside an attribute value (e.g.
      // data-x="a>b") doesn't cause a premature match. In practice the emitter
      // HTML-escapes > to &gt; in attribute values, but this is future-proof.
      html = html.replace(/^(<\w+(?:[^"'>]|"[^"]*"|'[^']*')*?)>/, `$1 data-arc-key="${keyVal}">`)
    }

    return html
  }

  emitMatchTemplate(node) {
    // For static subject, resolve at compile time
    if (this.isStaticExpr(node.subject)) {
      const val = this.evalStaticExpr(node.subject)
      for (const arm of node.arms) {
        if (arm.pattern?.type === 'Wildcard') return arm.body ? this.emitNode(arm.body) : ''
        const patVal = this.evalStaticExpr(arm.pattern)
        if (patVal === val) return arm.body ? this.emitNode(arm.body) : ''
      }
      return ''
    }
    // Reactive match: emit all branches with reactive show/hide
    const subjStr = this.exprToString(node.subject)
    const arms = node.arms.map((arm, i) => {
      const armId = this.getReactiveId(`match_arm_${i}_${subjStr}`)
      const body = arm.body ? this.emitNode(arm.body) : ''
      let condExpr
      if (!arm.pattern || arm.pattern.type === 'Wildcard') {
        condExpr = 'true'
      } else if (arm.pattern.type === 'Literal') {
        condExpr = `(${subjStr}===${JSON.stringify(arm.pattern.value)})`
      } else {
        condExpr = `(${subjStr}===${this.exprToString(arm.pattern)})`
      }
      this.stateBindings.push({ id: armId, expr: condExpr, kind: 'if-show', line: node.line })
      return `<div id="${armId}" hidden>${body}</div>`
    }).join('\n')
    return `<div>${arms}</div>`
  }

  // ── Native patterns (zero JS) ──────────────────────────────────────────────

  emitModal(node) {
    // Uses native <dialog> element: opened via showModal() from trigger= attr
    const rawId = node.id ?? node.attrs?.id
    const id = rawId
      ? (rawId.type ? this.evalStaticExpr(rawId) : rawId)
      : 'modal'
    const { labelAttr, resolvedNode } = this._resolveModalLabel(node, id)
    // Note: autofocus is intentionally omitted: autofocus on <dialog> is ignored by spec.
    // The trigger= onclick handler focuses the first focusable child after showModal().
    return `<dialog id="${this.escape(String(id))}" aria-modal="true"${labelAttr}>${this.emitChildren(resolvedNode.children)}</dialog>`
  }

  // Resolve aria-label or aria-labelledby for a modal node.
  // When no explicit label= is given, looks for a heading child and clones the node
  // to inject an id without mutating the shared AST (emitModal may run multiple times).
  _resolveModalLabel(node, id) {
    const rawLabel = node.attrs?.label
    const label = rawLabel ? (rawLabel.type ? this.evalStaticExpr(rawLabel) : rawLabel) : null
    if (label) {
      return { labelAttr: ` aria-label="${this.escape(String(label))}"`, resolvedNode: node }
    }
    const headingIdx = (node.children ?? []).findIndex(c =>
      c.type === 'Element' && (c.tag === 'heading' || /^h[1-6]$/.test(c.tag))
    )
    if (headingIdx >= 0) {
      const orig = node.children[headingIdx]
      const existingId = orig.id ?? orig.attrs?.id
      const actualId = existingId ?? `${id}-title`
      const labelAttr = ` aria-labelledby="${this.escape(String(actualId))}"`
      if (!existingId) {
        const patchedChildren = [...node.children]
        patchedChildren[headingIdx] = { ...orig, attrs: { ...(orig.attrs ?? {}), id: actualId } }
        return { labelAttr, resolvedNode: { ...node, children: patchedChildren } }
      }
      return { labelAttr, resolvedNode: node }
    }
    return { labelAttr: ` aria-label="${this.escape(String(id))}"`, resolvedNode: node }
  }

  emitTooltip(node) {
    const rawText = node.attrs?.text
    const text = rawText
      ? (rawText.type ? this.evalStaticExpr(rawText) : rawText)
      : ''
    const id = `tip_${this.componentHash}_${this.reactiveCounter++}`
    return [
      `<span class="arc-tooltip-anchor_${this.componentHash}" aria-describedby="${id}" tabindex="0">`,
      `  ${this.emitChildren(node.children)}`,
      `  <span role="tooltip" id="${id}" class="arc-tooltip-tip_${this.componentHash}">${this.escape(text)}</span>`,
      `</span>`,
    ].join('\n')
  }

  emitAccordion(node) {
    const hasSummary = node.children?.some(c => c.tag === 'summary')
    // Fallback summary text - accordion's own `summary=` attr overrides the default
    // English string so non-English pages can localize it.
    const rawSummary = node.attrs?.summary
    if (!rawSummary && !hasSummary) {
      process.stderr.write(`[arc] i18n: <accordion> at line ${node.line ?? '?'} is missing summary= — defaulting to English 'Details'. Add summary="..." to localize.\n`)
    }
    const summaryText = rawSummary
      ? (rawSummary.type ? this.evalStaticExpr(rawSummary) : rawSummary)
      : _localize(_LOCALE_DETAILS, this._currentLang)
    const summaryFallback = hasSummary ? '' : `<summary>${this.escape(String(summaryText))}</summary>\n`
    return `<details class="arc-accordion_${this.componentHash}">\n${summaryFallback}${this.emitChildren(node.children)}\n</details>`
  }

  emitSlider(node) {
    const attrs = node.attrs ?? {}
    const uid = `${this.componentHash}_${this.reactiveCounter++}`

    const getAttr = (key, fallback) => {
      const v = attrs[key]
      if (v == null) return fallback
      return (v && typeof v === 'object' && v.type) ? this.evalStaticExpr(v) : v
    }

    const autoplay    = getAttr('autoplay', false)
    const rawTimeout  = Number(getAttr('timeout', 4000))
    const timeout     = Number.isFinite(rawTimeout) ? Math.max(500, rawTimeout) : 4000
    const items       = Math.max(1, Number(getAttr('items', 1)))
    const showNav     = getAttr('nav', true) !== false && getAttr('nav', true) !== 'false'
    const showDots    = getAttr('dots', true) !== false && getAttr('dots', true) !== 'false'
    const center      = getAttr('center', false)
    const gap         = getAttr('gap', 0)
    const label       = getAttr('label', 'Slider')

    const children = node.children ?? []
    const count    = children.length
    const trackId  = `arc-t-${uid}`
    const snapAlign = center ? 'center' : 'start'

    const slidesHtml = children.map((child, i) =>
      `<div class="arc-slide_${uid}" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${count}">${this.emitNode(child)}</div>`
    ).join('\n')

    const navHtml = (showNav && count > 1) ? [
      `<button class="arc-slider-prev_${uid}" aria-label="Previous slide" onclick="var t=document.getElementById('${trackId}');if(t)t.scrollBy({left:-t.offsetWidth/${items},behavior:'smooth'})">&#8592;</button>`,
      `<button class="arc-slider-next_${uid}" aria-label="Next slide" onclick="var t=document.getElementById('${trackId}');if(t)t.scrollBy({left:t.offsetWidth/${items},behavior:'smooth'})">&#8594;</button>`,
    ].join('\n') : ''

    const dotsHtml = (showDots && count > 1) ? [
      `<div class="arc-slider-dots_${uid}" role="group" aria-label="Slide navigation">`,
      ...children.map((_, i) =>
        `<button class="arc-slider-dot_${uid}" aria-label="Go to slide ${i + 1}" aria-current="${i === 0 ? 'true' : 'false'}"></button>`
      ),
      `</div>`,
    ].join('\n') : ''

    const scriptHtml = (showDots || autoplay) ? this._sliderScript(uid, trackId, showDots, autoplay, timeout) : ''

    const style = [
      items !== 1 ? `--arc-si:${items}` : '',
      gap ? `--arc-sg:${typeof gap === 'number' ? gap + 'px' : gap}` : '',
      `--arc-ss:${snapAlign}`,
    ].filter(Boolean).join(';')

    return [
      `<div class="arc-slider_${uid}" role="region" aria-roledescription="carousel" aria-label="${this.escape(String(label))}">`,
      navHtml,
      `<div id="${trackId}" class="arc-slider-track_${uid}"${style ? ` style="${style}"` : ''}>`,
      slidesHtml,
      `</div>`,
      dotsHtml,
      scriptHtml,
      `</div>`,
    ].filter(Boolean).join('\n')
  }

  // Wrap an element that has a tooltip="" attr as a tooltip-anchor.
  _sliderScript(uid, trackId, showDots, autoplay, timeout) {
    const dotsJs = showDots
      ? `var sl=t.children,dt=t.parentElement.querySelectorAll('.arc-slider-dot_${uid}');` +
        `if(dt.length){var ob=new IntersectionObserver(function(es){es.forEach(function(e){` +
        `if(e.isIntersecting){var i=Array.prototype.indexOf.call(sl,e.target);` +
        `dt.forEach(function(d,j){d.setAttribute('aria-current',i===j?'true':'false');});}` +
        `});},{root:t,threshold:.5});Array.prototype.forEach.call(sl,function(s){ob.observe(s);});}`
      : ''
    const autoplayJs = autoplay
      ? `var idx=0,sl2=t.children;` +
        `t.addEventListener('mouseenter',function(){clearInterval(_ap);});` +
        `t.addEventListener('mouseleave',function(){_ap=setInterval(_fn,${timeout});});` +
        `function _fn(){idx=(idx+1)%sl2.length;sl2[idx].scrollIntoView({behavior:'smooth',block:'nearest',inline:'start'});}` +
        `var _ap=setInterval(_fn,${timeout});`
      : ''
    return `<script>(function(){var t=document.getElementById('${trackId}');if(!t)return;${dotsJs}${autoplayJs}})();</script>`
  }

  // Add tabindex="0" so non-interactive wrapped elements (e.g. <span tooltip="...">)
  // are keyboard-focusable and can surface the tooltip via :focus styles.
  emitTooltipAttr(node, tooltipText) {
    const id = `tip_${this.componentHash}_${this.reactiveCounter++}`
    const { tooltip: _t, ...attrsWithout } = node.attrs
    const inner = this.emitElement({ ...node, attrs: attrsWithout })
    return [
      `<span class="arc-tooltip-anchor_${this.componentHash}" aria-describedby="${id}" tabindex="0">`,
      `  ${inner}`,
      `  <span role="tooltip" id="${id}" class="arc-tooltip-tip_${this.componentHash}">${this.escape(tooltipText)}</span>`,
      `</span>`,
    ].join('\n')
  }

  emitRaw(node) {
    if (this.options.allowRaw !== true) {
      throw new Error('Arc: RawNode requires opt-in via allowRaw: true')
    }
    // WARNING: node.html is emitted verbatim with no sanitization.
    // allowRaw must ONLY be used for trusted, developer-authored content.
    // Never pass user-supplied input through RawNode - use escape() instead.
    return node.html
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  escape(str) {
    if (typeof str !== 'string') return String(str ?? '')
    return str.replace(_ESC_RE, c => _ESC_MAP[c])
  }

  getReactiveId(key) {
    if (!this.reactiveIds.has(key)) {
      this.reactiveIds.set(key, `_a${++this.reactiveCounter}`)
    }
    return this.reactiveIds.get(key)
  }

  isStaticExpr(expr) {
    if (!expr) return true
    if (expr.type === 'Literal') return true
    if (expr.type === 'AtProperty') return Object.prototype.hasOwnProperty.call(this.currentAttrs, expr.name)
    if (expr.type === 'Identifier') {
      // Known @build variable or widget prop → static
      return Object.prototype.hasOwnProperty.call(this.buildContext, expr.name) ||
             Object.prototype.hasOwnProperty.call(this.currentAttrs, expr.name)
    }
    if (expr.type === 'MemberExpr' && !expr.computed) {
      return this.isStaticExpr(expr.object)
    }
    if (expr.type === 'BinaryExpr') {
      return this.isStaticExpr(expr.left) && this.isStaticExpr(expr.right)
    }
    if (expr.type === 'TemplateLiteral') {
      return expr.parts.every(p => this.isStaticExpr(p))
    }
    if (expr.type === 'TernaryExpr') {
      return this.isStaticExpr(expr.condition) && this.isStaticExpr(expr.consequent) && this.isStaticExpr(expr.alternate)
    }
    if (expr.type === 'ArrayLiteral') {
      return expr.elements.every(e => this.isStaticExpr(e))
    }
    return false
  }

  evalStaticExpr(expr) {
    if (!expr) return undefined
    if (expr.type === 'Literal') return expr.value
    // @attr reference inside a widget invocation
    if (expr.type === 'AtProperty' && Object.prototype.hasOwnProperty.call(this.currentAttrs, expr.name)) {
      return this.currentAttrs[expr.name]
    }
    if (expr.type === 'Identifier') {
      if (Object.prototype.hasOwnProperty.call(this.buildContext, expr.name)) return this.buildContext[expr.name]
      if (Object.prototype.hasOwnProperty.call(this.currentAttrs, expr.name)) return this.currentAttrs[expr.name]
      return undefined
    }
    if (expr.type === 'MemberExpr' && !expr.computed) {
      const evaluated = this.evalStaticExpr(expr.object)
      if (evaluated !== undefined && evaluated !== null) {
        const key = expr.property.name ?? expr.property.value
        return evaluated[key]
      }
      return undefined
    }
    if (expr.type === 'BinaryExpr') {
      const l = this.evalStaticExpr(expr.left)
      const r = this.evalStaticExpr(expr.right)
      if (l !== undefined && r !== undefined) return this.applyOp(expr.op, l, r)
      return undefined
    }
    if (expr.type === 'TemplateLiteral') {
      const parts = expr.parts.map(p => this.evalStaticExpr(p))
      if (parts.every(p => p !== undefined)) return parts.join('')
      return undefined
    }
    if (expr.type === 'TernaryExpr') {
      const cond = this.evalStaticExpr(expr.condition)
      if (cond === undefined) return undefined
      return cond ? this.evalStaticExpr(expr.consequent) : this.evalStaticExpr(expr.alternate)
    }
    if (expr.type === 'ArrayLiteral') {
      return expr.elements.map(e => this.evalStaticExpr(e))
    }
    return undefined
  }

  _resolveAttrVal(v) {
    return (v && typeof v === 'object' && v.type)
      ? (this.isStaticExpr(v) ? String(this.evalStaticExpr(v) ?? '') : '')
      : String(v ?? '')
  }

  applyOp(op, l, r) {
    switch (op) {
      case '+':   return l + r
      case '-':   return l - r
      case '*':   return l * r
      case '/':   return l / r
      case '%':   return l % r
      case '==':  return l == r  // eslint-disable-line eqeqeq
      case '!=':  return l != r  // eslint-disable-line eqeqeq
      case '===': return l === r
      case '!==': return l !== r
      case '<':   return l < r
      case '>':   return l > r
      case '<=':  return l <= r
      case '>=':  return l >= r
      case '&&':  return l && r
      case '||':  return l || r
      default:    return undefined
    }
  }

  _extractRootIdent(expr) {
    // OptionalChain in a bind:value path would generate invalid setter code: reject it
    if (this._hasOptionalChain(expr)) return null
    while (expr?.type === 'MemberExpr') expr = expr.object
    return expr?.type === 'Identifier' ? expr.name : null
  }

  _hasOptionalChain(expr) {
    if (!expr) return false
    if (expr.type === 'OptionalChain') return true
    if (expr.type === 'MemberExpr') return this._hasOptionalChain(expr.object)
    return false
  }

  exprToString(expr) {
    if (!expr) return 'undefined'
    switch (expr.type) {
      case 'Literal':       return JSON.stringify(expr.value)
      case 'Identifier':    return expr.name
      case 'AtProperty':    return `@${expr.name}`
      case 'MemberExpr':
        if (expr.computed) {
          return `${this.exprToString(expr.object)}[${this.exprToString(expr.property)}]`
        }
        return `${this.exprToString(expr.object)}.${expr.property.name ?? expr.property.value ?? this.exprToString(expr.property)}`
      case 'OptionalChain':
        return `${this.exprToString(expr.object)}?.${expr.property.name ?? expr.property.value ?? this.exprToString(expr.property)}`
      case 'BinaryExpr':
        return `(${this.exprToString(expr.left)}${expr.op}${this.exprToString(expr.right)})`
      case 'LogicalExpr':
        return `(${this.exprToString(expr.left)}${expr.op}${this.exprToString(expr.right)})`
      case 'NullCoalesce':
        return `(${this.exprToString(expr.left)}??${this.exprToString(expr.right)})`
      case 'TernaryExpr':
        return `(${this.exprToString(expr.condition)}?${this.exprToString(expr.consequent)}:${this.exprToString(expr.alternate)})`
      case 'UnaryExpr':
        return `(${expr.op}${this.exprToString(expr.operand)})`
      case 'CallExpr': {
        const args = (expr.args ?? []).map(a => this.exprToString(a)).join(',')
        return `${this.exprToString(expr.callee)}(${args})`
      }
      case 'TemplateLiteral':
        return '`' + (expr.parts ?? []).map(p => {
          if (p.type === 'Literal') return String(p.value).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')
          return `\${${this.exprToString(p)}}`
        }).join('') + '`'
      case 'ArrayLiteral':
        return `[${(expr.elements ?? []).map(e => this.exprToString(e)).join(',')}]`
      case 'AwaitExpr':
        return `await ${this.exprToString(expr.argument)}`
      default:
        return 'undefined'
    }
  }
}

module.exports = { HtmlEmitter }
