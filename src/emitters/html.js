'use strict'

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

// Attributes that map to HTML event handlers (removed — use Arc reactive)
const SKIP_ATTRS = new Set(['on:click','on:input','on:change','on:submit','on:keydown','on:keyup','on:focus','on:blur','bind:value'])

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
    const description = node.meta?.description ? this.evalStaticExpr(node.meta.description) : ''

    const bodyContent = this.emitChildren(node.body)

    return [
      '<!DOCTYPE html>',
      `<html lang="${this.escape(lang)}">`,
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      `<title>${this.escape(title)}</title>`,
      description ? `<meta name="description" content="${this.escape(description)}">` : '',
      `<meta property="og:title" content="${this.escape(title)}">`,
      description ? `<meta property="og:description" content="${this.escape(description)}">` : '',
      '<meta property="og:type" content="website">',
      '<link rel="stylesheet" href="styles.css">',
      '</head>',
      '<body>',
      `<a href="#main-content" class="arc-skip-link">Skip to main content</a>`,
      `<main id="main-content">`,
      `<h1 class="arc-sr-only">${this.escape(title)}</h1>`,
      bodyContent,
      '</main>',
      '</body>',
      '</html>',
    ].filter(Boolean).join('\n')
  }

  emitWidget(node) {
    return this.emitChildren(node.body)
  }

  emitWidgetInvocation(widgetDecl, attrs, slotChildren) {
    // Save and replace currentAttrs for this widget invocation
    const outerAttrs = this.currentAttrs
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
    this.currentAttrs = resolvedAttrs
    this.slotChildren = slotChildren ?? []
    const result = this.emitChildren(widgetDecl.body)
    this.currentAttrs = outerAttrs
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
    return children.map(c => this.emitNode(c)).filter(Boolean).join('\n')
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
    const { tag, classes, attrs, children } = node
    let { id } = node

    // Widget invocation — inline the widget body with bound attrs
    if (this.widgets.has(tag)) {
      return this.emitWidgetInvocation(this.widgets.get(tag), attrs, children)
    }

    // Check for native pattern overrides
    if (tag === 'modal') return this.emitModal(node)
    if (tag === 'tooltip') return this.emitTooltip(node)
    if (tag === 'accordion') return this.emitAccordion(node)

    // tooltip="" attribute on any element — wrap with tooltip anchor
    if (attrs.tooltip) {
      const rawTip = attrs.tooltip
      const tipText = (rawTip && rawTip.type) ? this.evalStaticExpr(rawTip) : rawTip
      return this.emitTooltipAttr(node, String(tipText))
    }

    // Handle bind:value two-way binding — give element an id and register bind
    for (const [key, value] of Object.entries(attrs)) {
      if (!key.startsWith('bind:')) continue
      if (!id) id = this.getReactiveId(`bind_${tag}_${node.line}`)
      const boundName = value?.type === 'Identifier' ? value.name
        : value?.type === 'AtProperty' ? value.name
        : (typeof value === 'string' ? value : null)
      if (boundName) {
        this.stateBindings.push({ id, expr: boundName, kind: 'bind', line: node.line })
      }
    }

    // Collect event handlers — give element an id if it has on:event attrs
    const hasEvents = Object.keys(attrs).some(k => k.startsWith('on:'))
    if (hasEvents && !id) {
      id = this.getReactiveId(`ev_${tag}_${node.line}`)
    }
    for (const [key, value] of Object.entries(attrs)) {
      if (!key.startsWith('on:')) continue
      const event = key.slice(3)
      this.eventBindings.push({ elementId: id, event, handler: value, line: node.line })
    }

    const htmlTag = ELEMENT_MAP[tag] ?? tag
    const allClasses = [...(ELEMENT_CLASSES[tag] ?? []), ...classes]

    // Build scoped class names
    const scopedClasses = allClasses.map(c => `${c}_${this.componentHash}`)

    const attrStr = this.buildAttrs(id, scopedClasses, attrs, node)

    if (VOID_ELEMENTS.has(htmlTag)) {
      return `<${htmlTag}${attrStr}>`
    }

    const inner = this.emitChildren(children)
    if (!inner && children.length === 0) {
      return `<${htmlTag}${attrStr}></${htmlTag}>`
    }
    return `<${htmlTag}${attrStr}>${inner}</${htmlTag}>`
  }

  buildAttrs(id, classes, attrs, node) {
    const parts = []

    if (id) parts.push(`id="${this.escape(id)}"`)

    if (classes.length > 0) {
      parts.push(`class="${classes.map(c => this.escape(c)).join(' ')}"`)
    }

    for (const [key, rawValue] of Object.entries(attrs)) {
      // Skip reactive attrs — handled by JS emitter
      if (SKIP_ATTRS.has(key) || key.startsWith('on:') || key.startsWith('bind:')) continue
      // Tooltip attribute handled in emitElement — skip here
      if (key === 'tooltip') continue

      // Resolve AST node to its static value when possible
      const value = (rawValue && typeof rawValue === 'object' && rawValue.type)
        ? (this.isStaticExpr(rawValue) ? this.evalStaticExpr(rawValue) : rawValue)
        : rawValue

      // Popover API: trigger="id" → popovertarget="id"
      if (key === 'trigger') {
        parts.push(`popovertarget="${this.escape(String(value))}"`)
        continue
      }
      // Popover API: close="id" → popovertarget="id" popovertargetaction="hide"
      if (key === 'close') {
        parts.push(`popovertarget="${this.escape(String(value))}" popovertargetaction="hide"`)
        continue
      }
      // Native dialog attrs (legacy)
      if (key === 'dialog:open') {
        parts.push(`data-arc-dialog-open="${this.escape(String(value))}"`)
        continue
      }
      if (key === 'dialog:close' || key === 'dialog:cancel') {
        parts.push(`data-arc-dialog-close`)
        continue
      }

      if (value === true) {
        parts.push(this.escape(key))
      } else if (value !== false && value !== undefined) {
        parts.push(`${this.escape(key)}="${this.escape(String(value))}"`)
      }
    }

    // Auto-enhancements
    if (node.tag === 'img') {
      if (!attrs.loading) parts.push('loading="lazy"')
      if (!attrs.decoding) parts.push('decoding="async"')
      if (attrs.alt === undefined) parts.push('alt=""')
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

    return parts.length > 0 ? ' ' + parts.join(' ') : ''
  }

  emitText(node) {
    return this.escape(node.value)
  }

  emitTemplateLiteral(node) {
    // A template literal mixes static string parts and reactive expressions.
    // Render each part inline (no wrapper element).
    return node.parts.map(part => {
      if (part.type === 'Literal') return this.escape(String(part.value))
      // Expression part
      const exprStr = this.exprToString(part)
      if (this.isStaticExpr(part)) {
        const val = this.evalStaticExpr(part)
        return val !== undefined ? this.escape(String(val)) : ''
      }
      const id = this.getReactiveId(exprStr)
      this.stateBindings.push({ id, expr: exprStr, line: node.line })
      return `<span id="${id}"></span>`
    }).join('')
  }

  emitInterpolation(node) {
    // For static expressions, evaluate them
    // For reactive ones, emit a placeholder span with an ID
    const exprStr = this.exprToString(node.expr)

    if (this.isStaticExpr(node.expr)) {
      return this.escape(this.evalStaticExpr(node.expr))
    }

    // Reactive — emit a span placeholder
    const id = this.getReactiveId(exprStr)
    this.stateBindings.push({ id, expr: exprStr, line: node.line })
    return `<span id="${id}"></span>`
  }

  emitIf(node) {
    const condStr = this.exprToString(node.condition)

    if (this.isStaticExpr(node.condition)) {
      const val = this.evalStaticExpr(node.condition)
      return val ? this.emitChildren(node.consequent)
                 : (node.alternate ? this.emitChildren(node.alternate) : '')
    }

    // Reactive if — wrap in data-arc-if container
    const ifId = this.getReactiveId(`if_${condStr}`)
    const elseId = node.alternate ? this.getReactiveId(`else_${condStr}`) : null

    this.stateBindings.push({ id: ifId, expr: condStr, kind: 'if-show', line: node.line })
    if (elseId) this.stateBindings.push({ id: elseId, expr: condStr, kind: 'if-hide', line: node.line })

    const ifContent = this.emitChildren(node.consequent)
    const elseContent = node.alternate ? this.emitChildren(node.alternate) : ''

    const ifHtml = `<div id="${ifId}" hidden>${ifContent}</div>`
    const elseHtml = elseId ? `<div id="${elseId}">${elseContent}</div>` : ''

    return ifHtml + (elseHtml ? '\n' + elseHtml : '')
  }

  emitUnless(node) {
    // unless X = if !X
    return this.emitIf({
      ...node,
      type: 'IfNode',
      condition: { type: 'UnaryExpr', op: '!', operand: node.condition },
      consequent: node.consequent,
      alternate: null,
    })
  }

  emitFor(node) {
    const collStr = this.exprToString(node.collection)

    if (this.isStaticExpr(node.collection)) {
      // Build-time loop — unroll to static HTML
      const items = this.evalStaticExpr(node.collection)
      if (Array.isArray(items)) {
        return items.map((item, i) => {
          // Simple static unrolling — inject values
          return this.emitForBody(node.body, item, i)
        }).join('\n')
      }
      return ''
    }

    // Reactive for — emit a container, JS will manage children
    const listId = this.getReactiveId(`list_${collStr}`)
    this.stateBindings.push({
      id: listId,
      expr: collStr,
      kind: 'list',
      itemName: node.itemName,
      indexName: node.indexName,
      bodyTemplate: this.emitChildren(node.body), // template for one item
      line: node.line
    })

    return `<div id="${listId}"></div>`
  }

  emitForBody(bodyNodes, item, index) {
    // Static unrolling: substitute item references with actual values
    // For now, emit with data attributes — full static eval is in optimizer
    return this.emitChildren(bodyNodes)
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
    // Reactive match — emit all branches with reactive show/hide
    return node.arms.map((arm, i) => {
      const armId = this.getReactiveId(`match_${i}_${this.exprToString(node.subject)}`)
      const body = arm.body ? this.emitNode(arm.body) : ''
      return `<div id="${armId}" hidden>${body}</div>`
    }).join('\n')
  }

  // ── Native patterns (zero JS) ──────────────────────────────────────────────

  emitModal(node) {
    // Uses Popover API — zero JS, opened via popovertarget on buttons
    const rawId = node.id ?? node.attrs?.id
    const id = rawId
      ? (rawId.type ? this.evalStaticExpr(rawId) : rawId)
      : 'modal'
    const children = this.emitChildren(node.children)
    const rawLabel = node.attrs?.label
    const label = rawLabel ? (rawLabel.type ? this.evalStaticExpr(rawLabel) : rawLabel) : null
    const ariaLabel = label ? ` aria-label="${this.escape(String(label))}"` : ` aria-label="${this.escape(String(id))}"`
    return `<dialog id="${this.escape(String(id))}" popover aria-modal="true"${ariaLabel}>${children}</dialog>`
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
      `  <span role="tooltip" id="${id}" popover="hint">${this.escape(text)}</span>`,
      `</span>`,
    ].join('\n')
  }

  emitAccordion(node) {
    return `<details class="arc-accordion_${this.componentHash}">\n${this.emitChildren(node.children)}\n</details>`
  }

  // Wrap an element that has a tooltip="" attr as a tooltip-anchor
  emitTooltipAttr(node, tooltipText) {
    const id = `tip_${this.componentHash}_${this.reactiveCounter++}`
    const { tooltip: _t, ...attrsWithout } = node.attrs
    const inner = this.emitElement({ ...node, attrs: attrsWithout })
    return [
      `<span class="arc-tooltip-anchor_${this.componentHash}">`,
      `  ${inner}`,
      `  <span role="tooltip" id="${id}" popover="hint">${this.escape(tooltipText)}</span>`,
      `</span>`,
    ].join('\n')
  }

  emitRaw(node) {
    if (this.options.allowRaw === false) {
      throw new Error('Arc: RawNode encountered but allowRaw is disabled')
    }
    return node.html
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  escape(str) {
    if (typeof str !== 'string') return String(str ?? '')
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
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
    if (expr.type === 'AtProperty') return expr.name in this.currentAttrs  // static if attr is bound
    if (expr.type === 'Identifier') {
      // Known @build variable → static
      return expr.name in this.buildContext
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
    return false
  }

  evalStaticExpr(expr) {
    if (!expr) return undefined
    if (expr.type === 'Literal') return expr.value
    // @attr reference inside a widget invocation
    if (expr.type === 'AtProperty' && expr.name in this.currentAttrs) {
      return this.currentAttrs[expr.name]
    }
    if (expr.type === 'Identifier' && expr.name in this.buildContext) {
      return this.buildContext[expr.name]
    }
    if (expr.type === 'MemberExpr' && !expr.computed) {
      const obj = this.evalStaticExpr(expr.object)
      if (obj !== undefined && obj !== null) {
        const key = expr.property.name ?? expr.property.value
        return obj[key]
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
    return undefined
  }

  applyOp(op, l, r) {
    switch (op) {
      case '+': return l + r
      case '-': return l - r
      case '*': return l * r
      case '/': return l / r
      case '%': return l % r
      default:  return undefined
    }
  }

  exprToString(expr) {
    if (!expr) return 'undefined'
    if (expr.type === 'Literal') return JSON.stringify(expr.value)
    if (expr.type === 'Identifier') return expr.name
    if (expr.type === 'AtProperty') return `@${expr.name}`
    if (expr.type === 'MemberExpr') return `${this.exprToString(expr.object)}.${this.exprToString(expr.property)}`
    if (expr.type === 'BinaryExpr') return `${this.exprToString(expr.left)}${expr.op}${this.exprToString(expr.right)}`
    if (expr.type === 'CallExpr') return `${this.exprToString(expr.callee)}()`
    if (expr.type === 'UnaryExpr') return `${expr.op}${this.exprToString(expr.operand)}`
    return 'expr'
  }
}

module.exports = { HtmlEmitter }
