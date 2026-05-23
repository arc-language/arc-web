'use strict'

// Arc design shorthand → CSS property expansion
const SHORTHANDS = {
  // Spacing
  'bg':        v => `background-color: ${expandToken(v, 'color')}`,
  'fg':        v => `color: ${expandToken(v, 'color')}`,
  'p':         v => `padding: ${v}`,
  'p-x':       v => `padding-left: ${v}; padding-right: ${v}`,
  'p-y':       v => `padding-top: ${v}; padding-bottom: ${v}`,
  'p-t':       v => `padding-top: ${v}`,
  'p-r':       v => `padding-right: ${v}`,
  'p-b':       v => `padding-bottom: ${v}`,
  'p-l':       v => `padding-left: ${v}`,
  'm':         v => `margin: ${v}`,
  'm-x':       v => `margin-left: ${v}; margin-right: ${v}`,
  'm-y':       v => `margin-top: ${v}; margin-bottom: ${v}`,
  'm-t':       v => `margin-top: ${v}`,
  'm-r':       v => `margin-right: ${v}`,
  'm-b':       v => `margin-bottom: ${v}`,
  'm-l':       v => `margin-left: ${v}`,
  'gap':       v => `gap: ${v}`,
  'gap-x':     v => `column-gap: ${v}`,
  'gap-y':     v => `row-gap: ${v}`,

  // Sizing
  'w':         v => `width: ${expandCalc(v)}`,
  'h':         v => `height: ${expandCalc(v)}`,
  'min-w':     v => `min-width: ${v}`,
  'max-w':     v => `max-width: ${v}`,
  'min-h':     v => `min-height: ${v}`,
  'max-h':     v => `max-height: ${v}`,

  // Shape
  'radius':    v => `border-radius: ${expandToken(v, 'radius')}`,
  'shadow':    v => `box-shadow: ${expandToken(v, 'shadow')}`,
  'border':    v => `border: ${expandBorder(v)}`,
  'outline':   v => `outline: ${v}`,

  // Typography
  'size':      v => `font-size: ${expandToken(v, 'size')}`,
  'weight':    v => `font-weight: ${expandWeight(v)}`,
  'font':      v => `font-family: ${expandToken(v, 'font')}`,
  'line':      v => `line-height: ${expandLineHeight(v)}`,
  'tracking':  v => `letter-spacing: ${expandTracking(v)}`,
  'align':     v => `text-align: ${v}`,

  // Layout: flex shorthand
  'flex':      v => expandFlex(v),
  'grid':      v => expandGrid(v),
  'row':       v => `display: flex; flex-direction: row${v ? `; gap: ${v}` : ''}`,
  'col':       v => `display: flex; flex-direction: column${v ? `; gap: ${v}` : ''}`,

  // Visual
  'z':         v => `z-index: ${v}`,
  'pos':       v => `position: ${v}`,
  'opacity':   v => `opacity: ${v}`,
  'overflow':  v => `overflow: ${v}`,
  'cursor':    v => `cursor: ${v}`,
  'pointer':   v => `pointer-events: ${v}`,
  'select':    v => `user-select: ${v}`,
  'transform': v => `transform: ${v}`,
  'transition':v => `transition: ${expandTransition(v)}`,
  'animate':   v => expandAnimation(v),

  // Visibility
  'hidden':    () => `display: none`,
  'visible':   () => `visibility: visible`,
  'invisible': () => `visibility: hidden`,
}

// Token expansion: map token names to CSS custom properties
function expandToken(value, category) {
  if (!value) return value

  // Check if it's a token reference (no spaces, no colons, no parens)
  if (/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/.test(value)) {
    // Map to CSS variable
    const varName = `--arc-${category}-${value.replace('.', '-')}`
    return `var(${varName}, ${value})`
  }

  return value
}

function expandCalc(value) {
  // Turn "100% - 32px" into "calc(100% - 32px)"
  // Require spaces around + and - to avoid wrapping hyphenated keywords (fit-content, max-content)
  if ((/ [-+] /.test(value) || /[*/]/.test(value)) && !value.includes('calc(')) {
    return `calc(${value})`
  }
  return value
}

function expandBorder(value) {
  // "1px #e5e7eb" → "1px solid #e5e7eb"
  // "1px border.default" → "1px solid var(--arc-color-border-default)"
  const parts = value.split(' ')
  if (parts.length === 2) {
    return `${parts[0]} solid ${expandToken(parts[1], 'color')}`
  }
  return value
}

function expandWeight(value) {
  const weights = {
    thin: 100, light: 300, normal: 400, medium: 500,
    semibold: 600, bold: 700, extrabold: 800, black: 900
  }
  return weights[value] ?? value
}

function expandLineHeight(value) {
  const named = { tight: 1.25, snug: 1.375, normal: 1.5, relaxed: 1.625, loose: 2 }
  return named[value] ?? value
}

function expandTracking(value) {
  const named = { tighter: '-0.05em', tight: '-0.025em', normal: '0', wide: '0.025em', wider: '0.05em', widest: '0.1em' }
  return named[value] ?? value
}

function expandFlex(value) {
  // "column gap=16 align=center"
  const props = ['display: flex', 'box-sizing: border-box']
  if (!value) return props.join('; ')

  const parts = value.split(/\s+/)
  for (const part of parts) {
    if (part === 'row') props.push('flex-direction: row')
    else if (part === 'column' || part === 'col') props.push('flex-direction: column')
    else if (part === 'wrap') props.push('flex-wrap: wrap')
    else if (part === 'nowrap') props.push('flex-wrap: nowrap')
    else if (part.startsWith('gap=')) props.push(`gap: ${part.slice(4)}`)
    else if (part.startsWith('align=')) {
      const v = part.slice(6)
      const aliased = { center: 'center', start: 'flex-start', end: 'flex-end', stretch: 'stretch' }
      props.push(`align-items: ${aliased[v] ?? v}`)
    }
    else if (part.startsWith('justify=')) {
      const v = part.slice(8)
      const aliased = { center: 'center', start: 'flex-start', end: 'flex-end', between: 'space-between', around: 'space-around' }
      props.push(`justify-content: ${aliased[v] ?? v}`)
    }
  }
  return props.join('; ')
}

function expandGrid(value) {
  if (!value) return 'display: grid; box-sizing: border-box'
  const props = ['display: grid', 'box-sizing: border-box']
  const parts = value.split(/\s+/)
  for (const part of parts) {
    if (/^\d+col$/.test(part)) {
      const n = parseInt(part)
      props.push(`grid-template-columns: repeat(${n}, 1fr)`)
    } else if (part.startsWith('"') || /^[\d.]+fr/.test(part)) {
      props.push(`grid-template-columns: ${part.replace(/"/g, '')}`)
    } else if (part.startsWith('gap=')) {
      props.push(`gap: ${part.slice(4)}`)
    }
  }
  return props.join('; ')
}

function expandTransition(value) {
  // "all 0.2s ease" → as-is
  // "opacity 150ms" → "opacity 150ms ease"
  const parts = value.split(/\s+/)
  if (parts.length === 2) return `${parts[0]} ${parts[1]} ease`
  return value
}

function expandAnimation(value) {
  // "slide-up 0.6s ease" → "@keyframes slide-up + animation: slide-up 0.6s ease"
  // Returns: { animation: '...', keyframes: '...' }
  const parts = value.split(/\s+/)
  const name = parts[0]
  const duration = parts[1] ?? '0.3s'
  const easing = parts[2] ?? 'ease'

  return `animation: ${name} ${duration} ${easing}`
}

// Built-in keyframe library
const KEYFRAMES = {
  'fade-in':   '@keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }',
  'fade-out':  '@keyframes fade-out { from { opacity: 1 } to { opacity: 0 } }',
  'slide-up':  '@keyframes slide-up { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: translateY(0) } }',
  'slide-down':'@keyframes slide-down { from { opacity: 0; transform: translateY(-16px) } to { opacity: 1; transform: translateY(0) } }',
  'slide-in':  '@keyframes slide-in { from { opacity: 0; transform: translateX(-16px) } to { opacity: 1; transform: translateX(0) } }',
  'scale-in':  '@keyframes scale-in { from { opacity: 0; transform: scale(0.95) } to { opacity: 1; transform: scale(1) } }',
  'bounce':    '@keyframes bounce { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }',
  'spin':      '@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }',
  'pulse':     '@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.5 } }',
}

// CSS properties that still need vendor prefixes
const NEEDS_PREFIX = new Map([
  ['user-select', ['-webkit-user-select']],
  ['appearance', ['-webkit-appearance', '-moz-appearance']],
  ['backdrop-filter', ['-webkit-backdrop-filter']],
  ['text-stroke', ['-webkit-text-stroke']],
  ['background-clip', ['-webkit-background-clip']],
])

// Responsive breakpoint definitions
const BREAKPOINTS = {
  mobile:  '(max-width: 640px)',
  tablet:  '(min-width: 641px) and (max-width: 1024px)',
  desktop: '(min-width: 1025px)',
  wide:    '(min-width: 1280px)',
}

class CssEmitter {
  constructor(options = {}) {
    this.hash = options.hash ?? 'arc'
    this.usedKeyframes = new Set()
    this.output = []
    this.baseStyles = options.includeBase !== false
  }

  emitProgram(program) {
    const rules = []

    // Find design blocks
    for (const decl of program.declarations) {
      if (decl.type === 'WidgetDecl' || decl.type === 'PageDecl') {
        if (decl.design) {
          rules.push(...this.emitDesignBlock(decl.design))
        }
      }
      if (decl.type === 'DesignBlock') {
        rules.push(...this.emitDesignBlock(decl))
      }
    }

    const keyframeCSS = [...this.usedKeyframes]
      .map(name => KEYFRAMES[name])
      .filter(Boolean)
      .join('\n')

    const baseCSS = this.baseStyles ? this.emitBase() : ''

    return [
      baseCSS,
      keyframeCSS,
      rules.length > 0 ? `@layer component {\n${rules.join('\n')}\n}` : '',
    ].filter(Boolean).join('\n\n')
  }

  emitBase() {
    return `@layer base {
  *, *::before, *::after { box-sizing: border-box }
  :root {
    --arc-font-sans: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
    --arc-font-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
    --arc-font-serif: Lora, Georgia, serif;
    --arc-radius-sm: 4px;
    --arc-radius-md: 8px;
    --arc-radius-lg: 12px;
    --arc-radius-xl: 16px;
    --arc-radius-2xl: 24px;
    --arc-radius-full: 9999px;
    --arc-shadow-sm: 0 1px 2px oklch(0% 0 0 / 0.05);
    --arc-shadow-md: 0 4px 6px oklch(0% 0 0 / 0.07), 0 1px 3px oklch(0% 0 0 / 0.06);
    --arc-shadow-lg: 0 10px 15px oklch(0% 0 0 / 0.08), 0 4px 6px oklch(0% 0 0 / 0.05);
    --arc-shadow-xl: 0 20px 25px oklch(0% 0 0 / 0.10), 0 8px 10px oklch(0% 0 0 / 0.04);
  }
  .arc-row { display: flex; flex-direction: row }
  .arc-col { display: flex; flex-direction: column }
  .arc-center { display: flex; align-items: center; justify-content: center }
  .arc-spacer { flex: 1 0 auto }
  .arc-wrap { display: flex; flex-wrap: wrap }
  :focus-visible { outline: 2px solid oklch(60% 0.15 250); outline-offset: 2px }
  .arc-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0 }
  .arc-skip-link { position: absolute; top: -40px; left: 0; background: #fff; color: #000; padding: 8px 16px; z-index: 9999; text-decoration: none; border: 2px solid #000 }
  .arc-skip-link:focus { top: 0 }
}`
  }

  emitDesignBlock(block) {
    return (block.rules ?? []).map(rule => this.emitRule(rule)).filter(Boolean)
  }

  emitRule(rule) {
    if (rule.type === 'StyleCondition') return this.emitCondition(rule)
    if (rule.type === 'StyleRule') return this.emitStyleRule(rule)
    return ''
  }

  emitStyleRule(rule) {
    const { selector, props, children = [] } = rule

    // Scope the selector
    const scopedSelector = this.scopeSelector(selector)

    const declarations = this.emitProps(props)
    const nestedRules = children.map(c => {
      if (c.type === 'StyleCondition') return this.emitConditionNested(c, scopedSelector)
      if (c.type === 'StyleRule') {
        // Nested rule: &:hover → parent:hover, .child → parent .child
        const nestedSel = c.selector.startsWith('&')
          ? scopedSelector + c.selector.slice(1)
          : c.selector.startsWith(':') || c.selector.startsWith('::')
          ? scopedSelector + c.selector
          : `${scopedSelector} ${this.scopeSelector(c.selector)}`
        const nestedDecls = this.emitProps(c.props)
        const nestedChildren = (c.children ?? []).map(cc => this.emitRule(cc)).filter(Boolean)
        const block = `${nestedSel} {\n  ${nestedDecls.join(';\n  ')}\n}${nestedChildren.length ? '\n' + nestedChildren.join('\n') : ''}`
        return block
      }
      return ''
    }).filter(Boolean)

    if (declarations.length === 0 && nestedRules.length === 0) return ''

    const declBlock = declarations.length > 0
      ? `${scopedSelector} {\n  ${declarations.join(';\n  ')};\n}`
      : ''

    return [declBlock, ...nestedRules].filter(Boolean).join('\n')
  }

  emitProps(props) {
    const declarations = []

    for (const prop of props) {
      const { name, value } = prop

      // Check if it's an Arc shorthand
      if (SHORTHANDS[name]) {
        const expanded = SHORTHANDS[name](value)
        if (!expanded) continue

        const _trackAnim = (line) => {
          if (!line.startsWith('animation:')) return
          const animName = line.slice(line.indexOf(':') + 1).trimStart().split(/\s+/)[0]
          if (KEYFRAMES[animName]) this.usedKeyframes.add(animName)
        }

        // Handle animation shorthand: might produce multiple properties
        if (!expanded.includes(';')) {
          // Single declaration: avoid split/map/filter allocation
          const line = expanded.trim()
          if (line) { declarations.push(line); _trackAnim(line) }
        } else {
          const lines = expanded.split(';').map(l => l.trim()).filter(Boolean)
          for (const line of lines) { declarations.push(line); _trackAnim(line) }
        }
        continue
      }

      // Try calc expansion for width/height
      if (name === 'width' || name === 'height') {
        declarations.push(`${name}: ${expandCalc(value)}`)
        continue
      }

      // Full CSS passthrough (Arc doesn't have a shorthand)
      declarations.push(`${name}: ${value}`)

      // Add vendor prefixes if needed
      const prefixes = NEEDS_PREFIX.get(name)
      if (prefixes) {
        for (const prefix of prefixes) {
          declarations.push(`${prefix}: ${value}`)
        }
      }
    }

    return declarations
  }

  emitCondition(condition) {
    const { kind, query, rules } = condition
    const mediaQuery = this.resolveCondition(kind, query)
    if (!mediaQuery) return ''

    const innerRules = rules.map(r => {
      if (r.type === 'StyleRule') return this.emitStyleRule(r)
      return ''
    }).filter(Boolean)

    if (innerRules.length === 0) return ''

    return `${mediaQuery} {\n${innerRules.join('\n')}\n}`
  }

  emitConditionNested(condition, parentSelector) {
    const mediaQuery = this.resolveCondition(condition.kind, condition.query)
    if (!mediaQuery) return ''

    const inlineProps = condition.rules.filter(r => r.type === 'StyleProp')
    const decls = this.emitProps(inlineProps)

    const nestedRules = condition.rules
      .filter(r => r.type === 'StyleRule')
      .map(r => {
        const nestedSel = r.selector.startsWith('&')
          ? parentSelector + r.selector.slice(1)
          : r.selector.startsWith(':') || r.selector.startsWith('::')
          ? parentSelector + r.selector
          : `${parentSelector} ${this.scopeSelector(r.selector)}`
        const nestedDecls = this.emitProps(r.props)
        if (nestedDecls.length === 0) return ''
        return `  ${nestedSel} {\n    ${nestedDecls.join(';\n    ')};\n  }`
      })
      .filter(Boolean)

    if (decls.length === 0 && nestedRules.length === 0) return ''

    const innerBlocks = []
    if (decls.length > 0) innerBlocks.push(`  ${parentSelector} {\n    ${decls.join(';\n    ')};\n  }`)
    innerBlocks.push(...nestedRules)
    return `${mediaQuery} {\n${innerBlocks.join('\n')}\n}`
  }

  resolveCondition(kind, query) {
    if (BREAKPOINTS[kind]) return `@media ${BREAKPOINTS[kind]}`
    if (kind === 'dark') return '@media (prefers-color-scheme: dark)'
    if (kind === 'container') return `@container ${query ?? ''}`
    if (kind === 'starting-style') return '@starting-style'
    if (kind === 'media') return `@media ${query}`
    return null
  }

  scopeSelector(selector) {
    if (!selector) return selector
    // Add hash suffix to class selectors
    // .card → .card_a3f7
    // nav → nav  (element selectors don't get scoped)
    // &:hover → handled by caller
    return selector.replace(/\.([\w-]+)/g, (_, cls) => `.${cls}_${this.hash}`)
  }
}

module.exports = { CssEmitter, KEYFRAMES, SHORTHANDS }
