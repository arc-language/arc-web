'use strict'

// Hoisted regex constants for expandFlex / expandGrid hot paths
const _FLEX_NUMERIC_RE = /^\d+(\.\d+)?(\s+\d+(\.\d+)?(\s+\d+(\.\d+)?)?)?$/
const _GRID_COL_RE = /^\d+col$/
const _GRID_FR_RE = /^[\d.]+fr/

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
  'animate':      v => expandAnimation(v),
  'gradient-text': v => expandGradientText(v),

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

// Known valid values for align= and justify= shorthands (Arc aliases + direct CSS)
const _KNOWN_ALIGN_VALUES = new Set(['center','start','end','flex-start','flex-end','stretch','baseline','normal','auto','space-between','space-around','space-evenly'])
const _KNOWN_JUSTIFY_VALUES = new Set(['center','start','end','flex-start','flex-end','between','around','space-between','space-around','space-evenly','normal','auto'])

function expandFlex(value) {
  // Numeric value → flex-item shorthand: matches 1–3 space-separated decimal numbers
  if (value && _FLEX_NUMERIC_RE.test(value.trim())) return `flex: ${value}`
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
      if (!_KNOWN_ALIGN_VALUES.has(v)) process.stderr.write(`[arc] Warning: unknown align= value '${v}' — expected center, start, end, or stretch\n`)
      props.push(`align-items: ${aliased[v] ?? v}`)
    }
    else if (part.startsWith('justify=')) {
      const v = part.slice(8)
      const aliased = { center: 'center', start: 'flex-start', end: 'flex-end', between: 'space-between', around: 'space-around' }
      if (!_KNOWN_JUSTIFY_VALUES.has(v)) process.stderr.write(`[arc] Warning: unknown justify= value '${v}' — expected center, start, end, between, or around\n`)
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
    if (_GRID_COL_RE.test(part)) {
      const n = parseInt(part, 10)
      props.push(`grid-template-columns: repeat(${n}, 1fr)`)
    } else if (part.startsWith('"') || _GRID_FR_RE.test(part)) {
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
  if (!name) {
    process.stderr.write('[arc] Warning: animate requires a keyframe name (e.g. animate: fade-in 0.3s ease)\n')
    return 'animation: none'
  }
  const duration = parts[1] ?? '0.3s'
  const easing = parts[2] ?? 'ease'

  const extra = parts.slice(3).join(' ')
  return `animation: ${name} ${duration} ${easing}${extra ? ' ' + extra : ''}`
}

// NOTE: These presets are duplicated in stdlib/gradient.arc (PRESETS const).
// The two copies cannot be consolidated because css.js runs at compile time
// and gradient.arc runs at Arc runtime. Keep both in sync when adding presets.
const GRADIENT_PRESETS = {
  rainbow: '#ff0000,#ff7700,#ffff00,#00ff00,#0077ff,#8b00ff',
  // sunrise and gold contain #fde68a (~1.5:1 contrast on white) - only use on dark backgrounds
  sunrise: '#f97316,#f59e0b,#fbbf24,#fde68a',
  ocean:   '#0ea5e9,#06b6d4,#10b981',
  fire:    '#ef4444,#f97316,#eab308',
  neon:    '#00f2fe,#4facfe,#a78bfa',
  aurora:  '#00c6ff,#0072ff,#a855f7',
  candy:   '#ff6b9d,#c44dff,#4facfe',
  // gold contains #fde68a - low contrast on white; also contains #ffff00 (rainbow) - use on dark bg
  gold:    '#f59e0b,#fbbf24,#fde68a,#f59e0b',
}

function expandGradientText(value) {
  if (!value) {
    process.stderr.write('[arc] Warning: gradient-text requires a preset name or color list (e.g. gradient-text: rainbow)\n')
    return ''
  }
  let direction = 'to right'
  // Match CSS gradient directions: "to right", "to bottom right", "135deg", etc.
  // Two-word "to" directions (e.g. "to bottom right") require the extended pattern.
  let colorPart = value.trim()
  const dirMatch = colorPart.match(/^(to\s+(?:top|bottom|left|right)(?:\s+(?:left|right|top|bottom))?|\d+(?:\.\d+)?(?:deg|turn|rad|grad))\s*,\s*/)
  if (dirMatch) {
    direction = dirMatch[1].trim()
    colorPart = colorPart.slice(dirMatch[0].length).trim()
  } else if (/^to\s+/i.test(colorPart)) {
    process.stderr.write(`[arc] Warning: gradient-text direction not recognized: "${colorPart.split(',')[0].trim()}" — use "to right", "to bottom right", or "135deg"\n`)
  }
  const colors = GRADIENT_PRESETS[colorPart] ?? colorPart
  if (!colors || colors === colorPart && !colorPart.includes('#') && !colorPart.match(/^(?:rgb|hsl|oklch|color)/i)) {
    process.stderr.write(`[arc] Warning: gradient-text value "${colorPart}" is not a known preset and doesn't look like CSS colors\n`)
  }
  // Both background-clip variants are required: standard for Chrome/FF, -webkit- for Safari.
  // color:transparent makes the gradient show through the text mask (background-clip: text technique).
  // Do NOT rely on NEEDS_PREFIX here - shorthand expansions bypass that path in emitProps.
  // Note: elements using gradient-text will have invisible text in forced-colors/high-contrast mode.
  // Add a companion @media (forced-colors: active) { color: CanvasText; background: none } rule
  // in your design block to restore visibility for users with Windows High Contrast enabled.
  return [
    `background: linear-gradient(${direction}, ${colors})`,
    `background-clip: text`,
    `-webkit-background-clip: text`,
    `color: transparent`,
  ].join('; ')
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
  'pulse':          '@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.5 } }',
  'gradient-shift': '@keyframes gradient-shift { 0% { background-position: 0% center } to { background-position: 200% center } }',
  'gradient-x':     '@keyframes gradient-x { 0%,100% { background-position: 0% 50% } 50% { background-position: 100% 50% } }',
  'shimmer':        '@keyframes shimmer { 0% { background-position: -200% center } to { background-position: 200% center } }',
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

const _SCOPE_CLASS_RE = /\.([\w-]+)/g

class CssEmitter {
  constructor(options = {}) {
    this.hash = options.hash ?? 'arc'
    this.usedKeyframes = new Set()
    this.gradientTextSelectors = []
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

    let baseCSS = this.baseStyles ? this.emitBase() : ''

    // When there are no component rules, the @layer base { } wrapper adds no cascade benefit
    // - unwrap it to save ~20 bytes.
    if (baseCSS && rules.length === 0) {
      const m = baseCSS.match(/^@layer base \{([\s\S]*)\}\s*$/)
      if (m) baseCSS = m[1].trim()
    }

    // Emit forced-colors fix for any selectors that used gradient-text (WCAG 1.4.3 - high contrast)
    const forcedColorsCSS = this.gradientTextSelectors.length > 0
      ? `@media (forced-colors: active) {\n${this.gradientTextSelectors.map(s =>
          `  ${s} { color: CanvasText; background-image: none; -webkit-background-clip: unset; background-clip: unset; }`
        ).join('\n')}\n}`
      : ''

    return [
      baseCSS,
      keyframeCSS,
      rules.length > 0 ? `@layer component {\n${rules.join('\n')}\n}` : '',
      forcedColorsCSS,
    ].filter(Boolean).join('\n\n')
  }

  emitBase() {
    return `@layer base {
  *, *::before, *::after { box-sizing: border-box }
  :root {
    --arc-font-sans: 'Satoshi', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
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
  .arc-skip-link { position: absolute; top: -100px; left: 0; background: Canvas; color: CanvasText; padding: 8px 16px; z-index: 9999; text-decoration: none; border: 2px solid CanvasText; line-height: 1 }
  .arc-skip-link:focus { top: 0 }
  [class*="arc-slider"] { position: relative }
  [class*="arc-slider-track"] { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scroll-behavior: smooth; scrollbar-width: none; -ms-overflow-style: none; cursor: grab }
  [class*="arc-slider-track"]:active { cursor: grabbing }
  [class*="arc-slider-track"]::-webkit-scrollbar { display: none }
  [class*="arc-slide_"] { scroll-snap-align: var(--arc-ss,start); flex-shrink: 0; width: calc((100% - var(--arc-sp,0px)) / var(--arc-si,1)); padding: 0 calc(var(--arc-sg,0px) / 2) }
  [class*="arc-slider-prev"], [class*="arc-slider-next"] { position: absolute; top: 50%; transform: translateY(-50%); z-index: 1; background: var(--arc-slider-nav-bg,oklch(100% 0 0 / .8)); border: none; border-radius: var(--arc-radius-full,9999px); width: var(--arc-slider-nav-size,2rem); height: var(--arc-slider-nav-size,2rem); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: var(--arc-slider-nav-icon-size,1rem) }
  [class*="arc-slider-prev"] { left: .5rem }
  [class*="arc-slider-next"] { right: .5rem }
  [class*="arc-slider-dots"] { display: flex; justify-content: center; gap: .5rem; padding: .5rem 0 }
  [class*="arc-slider-dot_"] { width: var(--arc-slider-dot-size,.5rem); height: var(--arc-slider-dot-size,.5rem); border-radius: var(--arc-radius-full,9999px); border: none; background: currentColor; opacity: .3; cursor: pointer; padding: 0; transition: opacity .2s }
  [class*="arc-slider-dot_"][aria-current="true"] { opacity: 1 }
  [class*="arc-tooltip-anchor"] { position: relative; display: inline-flex; cursor: default }
  [class*="arc-tooltip-tip"] { position: absolute; bottom: 100%; margin-bottom: 4px; left: 50%; transform: translateX(-50%); background: oklch(15% 0 0); color: oklch(100% 0 0); padding: 4px 8px; border-radius: var(--arc-radius-sm,4px); font-size: .875em; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity .15s; z-index: 9999 }
  [class*="arc-tooltip-anchor"]:hover [class*="arc-tooltip-tip"],
  [class*="arc-tooltip-anchor"]:focus-within [class*="arc-tooltip-tip"] { opacity: 1 }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
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

    // Track selectors that use gradient-text so we can emit a forced-colors fix
    if (declarations.some(d => d.startsWith('color: transparent') || d === 'color: transparent')) {
      this.gradientTextSelectors.push(scopedSelector)
    }

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
    _SCOPE_CLASS_RE.lastIndex = 0
    return selector.replace(_SCOPE_CLASS_RE, (_, cls) => `.${cls}_${this.hash}`)
  }
}

module.exports = { CssEmitter, KEYFRAMES, SHORTHANDS, GRADIENT_PRESETS }
