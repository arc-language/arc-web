'use strict'

const _SAFE_BINARY_OPS = new Set(['+','-','*','/','%','**','==','!=','<','>','<=','>=','===','!==','instanceof','in','&','|','^','<<','>>'])
const _SAFE_UNARY_OPS = new Set(['!','-','+','~','typeof','void'])
const _SAFE_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
function _assertSafeIdent(val, context) {
  if (typeof val !== 'string' || !_SAFE_IDENT.test(val)) {
    throw new Error(`Arc codegen: unsafe identifier in ${context}: ${JSON.stringify(val)}`)
  }
}

const _SAFE_ATTR = /^[a-zA-Z0-9_:.-]+$/
function _assertSafeAttr(val, context) {
  if (typeof val !== 'string' || !_SAFE_ATTR.test(val)) {
    throw new Error(`Arc codegen: unsafe attribute/class in ${context}: ${JSON.stringify(val)}`)
  }
}

function _countNL(s) {
  let c = 0
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) c++
  return c
}

const _SAFE_DOM_EVENTS = new Set([
  'click','dblclick','mousedown','mouseup','mousemove','mouseenter','mouseleave','mouseover','mouseout',
  'keydown','keyup','keypress','focus','blur','focusin','focusout',
  'input','change','submit','reset','select',
  'scroll','wheel','resize','load','unload','error',
  'touchstart','touchend','touchmove','touchcancel',
  'dragstart','drag','dragend','dragenter','dragleave','dragover','drop',
  'contextmenu','pointerdown','pointerup','pointermove','pointerenter','pointerleave',
])

class JsEmitter {
  constructor(options = {}) {
    this.options = options
    this.componentHash = options.hash ?? 'arc'
    this.sourceMap = options.sourceMap ?? null
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  emitProgram(program, stateBindings = [], eventBindings = []) {
    const stateDecls = []
    const computedDecls = []
    const fnDecls = []

    for (const decl of program.declarations) {
      if (decl.type === 'StateDecl') stateDecls.push(decl)
      else if (decl.type === 'ComputedDecl') computedDecls.push(decl)
      else if (decl.type === 'FnDecl') fnDecls.push(decl)
    }

    if (stateDecls.length === 0 && eventBindings.length === 0) {
      this._reCache?.clear()
      this._emitCache = undefined
      return ''
    }

    // Set of all reactive variable names: used by emitRuntimeExpr to prefix identifiers
    this.stateVarNames = new Set([
      ...stateDecls.map(s => s.name),
      ...computedDecls.map(c => c.name),
    ])

    const parts = []

    // Build dependency graph: stateVar → [binding]
    const deps = this.buildDeps(stateDecls, computedDecls, stateBindings)

    // Hoist _esc helper to module scope when any list binding uses it
    const hasListBindings = stateBindings.some(b => b.kind === 'list')
    if (hasListBindings) {
      parts.push(`function _esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}`)
    }

    parts.push('(function(){')
    let genLine = 1  // incremental line counter avoids O(n²) join+scan

    // State variable declarations
    for (const s of stateDecls) {
      if (this.sourceMap && s.line != null) {
        this.sourceMap.addMapping(genLine, 0, s.line - 1, 0)
      }
      const code = `let _${s.name}=${this.emitExpr(s.init)};`
      genLine += _countNL(code) + 1
      parts.push(code)
    }

    // Computed variable declarations
    for (const c of computedDecls) {
      if (this.sourceMap && c.line != null) {
        this.sourceMap.addMapping(genLine, 0, c.line - 1, 0)
      }
      const code = `let _${c.name}=${this.emitExpr(c.init)};`
      genLine += _countNL(code) + 1
      parts.push(code)
    }

    // DOM node captures (getElementById for each reactive binding)
    const capturedIds = new Set()
    for (const b of stateBindings) {
      if (!capturedIds.has(b.id)) {
        _assertSafeAttr(b.id, 'state binding id')
        parts.push(`const _el_${b.id}=document.getElementById('${b.id}');`)
        capturedIds.add(b.id)
      }
    }

    // Function declarations
    for (const fn of fnDecls) {
      if (this.sourceMap && fn.line != null) {
        this.sourceMap.addMapping(genLine, 0, fn.line - 1, 0)
      }
      const code = this.emitFnDecl(fn)
      genLine += _countNL(code) + 1
      parts.push(code)
    }

    const computedAdj = this._buildComputedAdj(computedDecls)

    // Setter functions: one per @state variable
    for (const s of stateDecls) {
      const affected = deps.get(s.name) ?? []
      parts.push(`function _set_${s.name}(v){`)
      parts.push(`_${s.name}=v;`)

      // Recompute all transitively affected computeds in topological order (BFS)
      const toRecompute = []
      const visited = new Set()
      const queue = computedDecls.filter(c => this.exprReferences(c.init, s.name))
      for (const c of queue) { if (!visited.has(c.name)) { visited.add(c.name); toRecompute.push(c) } }
      for (let i = 0; i < toRecompute.length; i++) {
        for (const dep of (computedAdj.get(toRecompute[i].name) ?? [])) {
          if (!visited.has(dep.name)) { visited.add(dep.name); toRecompute.push(dep) }
        }
      }
      for (const c of toRecompute) {
        parts.push(`_${c.name}=${this.emitExpr(c.init)};`)
      }

      // Update DOM nodes
      for (const b of affected) {
        parts.push(this.emitBindingUpdate(b))
      }
      parts.push('}')
    }

    // Event listeners
    for (const ev of eventBindings) {
      parts.push(this.emitEventListener(ev))
    }

    // bind:value two-way bindings
    const bindBindings = stateBindings.filter(b => b.kind === 'bind')
    if (bindBindings.length > 0) {
      // Cuts ~250 bytes per binding by emitting this helper once
      parts.push(
        `function _arcBind(el,setter){if(!el)return;` +
        `const t=el.tagName==='SELECT'||el.type==='checkbox'||el.type==='radio'?'change':'input';` +
        `el.addEventListener(t,function(e){` +
        `const v=el.type==='checkbox'||el.type==='radio'?e.target.checked:el.type==='number'?parseFloat(e.target.value):e.target.value;` +
        `if(el.type!=='number'||!isNaN(v))setter(v);` +
        `});}`
      )
      for (const b of bindBindings) {
        const setterCall = b.bindRoot
          ? this._buildDeepSetter(b.bindRoot, b.expr)
          : `_set_${b.expr}(_bv)`
        if (!b.bindRoot && !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(b.expr)) {
          throw new Error(`Arc codegen: bind:value only supports simple variable names or dotted paths, got: ${JSON.stringify(b.expr)}`)
        }
        parts.push(`_arcBind(_el_${b.id},function(_bv){${setterCall}});`)
      }
    }

    // Initial render: set all reactive nodes to their initial values
    for (const b of stateBindings) {
      parts.push(this.emitBindingUpdate(b))
    }

    parts.push('})();')

    this._reCache?.clear()
    this._emitCache = undefined
    this._runtimeExprCache?.clear()
    return parts.join('\n')
  }

  // ── Dependency graph ───────────────────────────────────────────────────────

  // Build computed → [computeds that depend on it] adjacency map for BFS recomputation.
  // Forward pass: build dep → Set<c.name it references> once, then invert.
  _buildComputedAdj(computedDecls) {
    const adj = new Map()
    for (const c of computedDecls) adj.set(c.name, [])
    for (const dep of computedDecls) {
      const directDeps = new Set(
        computedDecls.filter(c => c.name !== dep.name && this.exprReferences(dep.init, c.name)).map(c => c.name)
      )
      for (const cName of directDeps) adj.get(cName)?.push(dep)
    }
    return adj
  }

  buildDeps(stateDecls, computedDecls, stateBindings) {
    const deps = new Map()
    // Pre-build per-computed-name regexes once to avoid O(S×B×C) reconstructions
    const computedReMap = new Map(computedDecls.map(c => [
      c.name,
      new RegExp('(?:^|[^a-zA-Z0-9_])' + c.name + '(?:[^a-zA-Z0-9_]|$)'),
    ]))

    for (const s of stateDecls) {
      // Pre-compile once per state var, reused for all bindings
      const re = new RegExp(`(?:^|[^a-zA-Z0-9_@])@?${s.name}(?:[^a-zA-Z0-9_]|$)`)
      const affected = []
      for (const b of stateBindings) {
        if (this.bindingDependsOn(b, s.name, computedDecls, re, computedReMap)) {
          affected.push(b)
        }
      }
      deps.set(s.name, affected)
    }

    return deps
  }

  bindingDependsOn(binding, stateVar, computedDecls, re, computedReMap) {
    const expr = binding.expr ?? ''
    // Check if stateVar appears as a whole word in the expression
    const stateRe = re ?? new RegExp(`(?:^|[^a-zA-Z0-9_@])@?${stateVar}(?:[^a-zA-Z0-9_]|$)`)
    if (stateRe.test(expr)) return true

    // Check if any computed that binding uses depends on stateVar
    for (const c of computedDecls) {
      // Use pre-built regex from caller map to avoid per-call RegExp construction
      const nameRe = computedReMap?.get(c.name)
        ?? new RegExp('(?:^|[^a-zA-Z0-9_])' + c.name + '(?:[^a-zA-Z0-9_]|$)')
      if (nameRe.test(expr) && this.exprReferences(c.init, stateVar)) return true
    }

    return false
  }

  exprReferences(expr, name) {
    if (!expr) return false
    this._emitCache ??= new WeakMap()
    if (!this._emitCache.has(expr)) {
      const savedCounter = this._matchCounter
      this._emitCache.set(expr, this.emitExpr(expr))
      this._matchCounter = savedCounter
    }
    this._reCache ??= new Map()
    if (!this._reCache.has(name)) this._reCache.set(name, new RegExp(`\\b_?${name}\\b`))
    return this._reCache.get(name).test(this._emitCache.get(expr))
  }

  // ── DOM update snippets ────────────────────────────────────────────────────

  emitBindingUpdate(b) {
    _assertSafeAttr(b.id, 'binding id')
    const el = `_el_${b.id}`
    const exprStr = this.emitRuntimeExpr(b.expr)

    switch (b.kind) {
      case 'if-show':
        return `if(${exprStr}){${el}.removeAttribute('hidden');}else{${el}.setAttribute('hidden','');}`
      case 'if-hide':
        return `if(${exprStr}){${el}.setAttribute('hidden','');}else{${el}.removeAttribute('hidden');}`
      case 'list':
        return this.emitListUpdate(b)
      case 'attr':
        _assertSafeAttr(b.attr, 'attr binding')
        return `${el}.setAttribute('${b.attr}',${exprStr});`
      case 'class-toggle':
        _assertSafeAttr(b.cls, 'class-toggle binding')
        return `${el}.classList.toggle('${b.cls}_${this.componentHash}',!!${exprStr});`
      case 'bind':
        return `if(document.activeElement!==${el})${el}.value=${exprStr};`
      default:
        return `${el}.textContent=${exprStr};`
    }
  }

  emitListUpdate(b) {
    const el = `_el_${b.id}`
    const items = this.emitRuntimeExpr(b.expr)
    const item = b.itemName ?? 'item'
    const idx = b.indexName ?? 'i'
    _assertSafeIdent(item, 'list item var')
    _assertSafeIdent(idx, 'list index var')

    // Template that renders one item: JS template literal or plain HTML
    const tplFnBody = b.bodyIsTemplate
      ? `return \`${b.bodyTemplate ?? ''}\``
      : `return ${JSON.stringify(b.bodyTemplate ?? '')}.replace(/\\bid="([^"]+)"/g,function(_,id){return 'id="'+id+'_'+${idx}+'"'})`

    const renderFn = `function _renderItem(${item},${idx}){${tplFnBody}}`

    if (b.keyExpr) {
      return this._emitKeyedListUpdate(b, el, items, item, idx, renderFn)
    }

    return this._emitSimpleListUpdate(b, el, items, item, idx, renderFn)
  }

  _emitKeyedListUpdate(b, el, items, item, idx, renderFn) {
    // Keyed reconciliation: preserves focus, scroll, and input state for unchanged items
    return [
      `(function(){`,
      renderFn,
      `const _items=${items};`,
      `if(!Array.isArray(_items)){${el}.innerHTML='';return;}`,
      // Save focused element id before mutation
      `const _fa=document.activeElement;const _fid=_fa&&${el}.contains(_fa)?_fa.id:null;`,
      // Build key→node map from current DOM
      `const _km=new Map();`,
      `for(let _c=${el}.firstElementChild;_c;_c=_c.nextElementSibling){`,
      `  const _k=_c.dataset&&_c.dataset.arcKey;if(_k!==undefined)_km.set(_k,_c);`,
      `}`,
      // Render and reconcile
      `const _kept=new Set();`,
      `const _newNodes=_items.map(function(${item},${idx}){`,
      `  const _kv=(${b.keyExpr});const _k=String(_kv!=null?_kv:${idx});`,
      `  const _html=_renderItem(${item},${idx});`,
      `  if(_km.has(_k)){`,
      `    const _ex=_km.get(_k);_kept.add(_k);`,
      `    const _tmp=document.createElement('div');_tmp.innerHTML=_html;`,
      `    const _nn=_tmp.firstChild;`,
      `    if(_nn&&_ex.outerHTML!==_nn.outerHTML){_ex.replaceWith(_nn);return _nn;}`,
      `    return _ex;`,
      `  }`,
      `  const _tmp=document.createElement('div');_tmp.innerHTML=_html;`,
      `  return _tmp.firstChild;`,
      `});`,
      // Remove old nodes not in new set
      `for(const[_k,_n]of _km){if(!_kept.has(_k)&&_n.parentNode)_n.parentNode.removeChild(_n);}`,
      // Append/reorder to match new order
      `_newNodes.forEach(function(_n,_i){`,
      `  const _cur=${el}.children[_i];if(_cur!==_n)${el}.insertBefore(_n,_cur||null);`,
      `});`,
      // Restore focus
      `if(_fid){const _fe=document.getElementById(_fid);if(_fe)_fe.focus({preventScroll:true});}`,
      `})();`,
    ].join('\n')
  }

  _emitSimpleListUpdate(b, el, items, item, idx, renderFn) {
    // Non-keyed update: small lists use individual node replacement, large use innerHTML batch
    // Focus within the list is restored after update
    return [
      `(function(){`,
      renderFn,
      `const _items=${items};`,
      `if(!Array.isArray(_items)){${el}.innerHTML='';return;}`,
      `const _fa=document.activeElement;const _fid=_fa&&${el}.contains(_fa)?_fa.id:null;`,
      `if(_items.length<=20){`,
      `  while(${el}.firstChild)${el}.removeChild(${el}.firstChild);`,
      `  _items.forEach(function(${item},${idx}){`,
      `    const _d=document.createElement('div');`,
      `    _d.innerHTML=_renderItem(${item},${idx});`,
      `    while(_d.firstChild)${el}.appendChild(_d.firstChild);`,
      `  });`,
      `}else{`,
      `  ${el}.innerHTML=_items.map(function(${item},${idx}){return _renderItem(${item},${idx});}).join('');`,
      `}`,
      `if(_fid){const _fe=document.getElementById(_fid);if(_fe)_fe.focus({preventScroll:true});}`,
      `})();`,
    ].join('\n')
  }

  _buildDeepSetter(bindRoot, pathExpr) {
    // Dotted path: generate a deep immutable update
    // e.g. user.name → _set_user({..._user, name: _bv})
    // e.g. user.profile.email → _set_user({..._user, profile:{..._user.profile, email:_bv}})
    _assertSafeIdent(bindRoot, 'bind root')
    const parts2 = pathExpr.split('.')
    const root = parts2[0]
    const keys = parts2.slice(1)
    let setter = `_bv`
    for (let i = keys.length - 1; i >= 0; i--) {
      // Use _ prefix for root so the runtime reads the state variable, not a bare name
      const path = ['_' + root, ...keys.slice(0, i)].join('.')
      setter = `{...((${path})??{}),${JSON.stringify(keys[i])}:${setter}}`
    }
    return `_set_${root}(${setter})`
  }

  // ── Event listeners ────────────────────────────────────────────────────────

  emitEventListener(ev) {
    if (ev.elementId) _assertSafeAttr(ev.elementId, 'event listener elementId')
    const el = ev.elementId
      ? `document.getElementById('${ev.elementId}')`
      : `document.querySelector('[data-arc-ev="${ev.handlerId}"]')`

    // handler may be an AST expression or statement body
    const body = ev.handler
      ? (ev.handler.type === 'BlockStatement'
          ? this.emitBody(ev.handler.body)
          : `${this.emitExpr(ev.handler)};`)
      : ''

    const evtName = ev.event ?? ''
    if (!_SAFE_DOM_EVENTS.has(evtName)) throw new Error(`Arc codegen: unknown/unsafe event type: ${JSON.stringify(evtName)}`)
    return `(function(){const _ee=${el};if(_ee)_ee.addEventListener('${evtName}',function(event){${body}});})();`
  }

  // ── Expression emission ────────────────────────────────────────────────────

  emitRuntimeExpr(exprStr) {
    // Memoize: same expression string produces same output - avoids double-regex per DOM update
    this._runtimeExprCache ??= new Map()
    if (this._runtimeExprCache.has(exprStr)) return this._runtimeExprCache.get(exprStr)
    // Convert @name → _name, and known state/computed identifiers → _name
    let result = exprStr.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, '_$1')
    if (this.stateVarNames) {
      // Replace bare identifiers (not after a dot or ?.) that are state variables with their _prefixed form
      result = result.replace(/(?<![.?])\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
        return this.stateVarNames.has(match) ? `_${match}` : match
      })
    }
    this._runtimeExprCache.set(exprStr, result)
    return result
  }

  emitExpr(expr) {
    if (!expr) return 'undefined'

    switch (expr.type) {
      case 'Literal':
        return JSON.stringify(expr.value)

      case 'Identifier':
        // Prefix known @state/@computed variables with _ to match their JS name
        return (this.stateVarNames?.has(expr.name)) ? `_${expr.name}` : expr.name

      case 'AtProperty':
        return `_${expr.name}`

      case 'TemplateLiteral':
        return '`' + expr.parts.map(p => {
          if (p.type === 'Literal') return String(p.value).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')
          return `\${${this.emitExpr(p)}}`
        }).join('') + '`'

      case 'BinaryExpr': {
        if (!_SAFE_BINARY_OPS.has(expr.op)) throw new Error(`Arc codegen: unsafe BinaryExpr operator: ${JSON.stringify(expr.op)}`)
        return `(${this.emitExpr(expr.left)}${expr.op}${this.emitExpr(expr.right)})`
      }

      case 'UnaryExpr':
        if (!_SAFE_UNARY_OPS.has(expr.op)) throw new Error(`Arc codegen: unsafe UnaryExpr operator: ${JSON.stringify(expr.op)}`)
        return `(${expr.op}${this.emitExpr(expr.operand)})`

      case 'LogicalExpr':
        return `(${this.emitExpr(expr.left)}${expr.op}${this.emitExpr(expr.right)})`

      case 'AssignExpr': {
        const lname = expr.left.type === 'AtProperty' ? expr.left.name
          : (expr.left.type === 'Identifier' && this.stateVarNames?.has(expr.left.name)) ? expr.left.name
          : null
        if (lname) {
          const setter = `_set_${lname}`
          if (expr.op === '=') return `${setter}(${this.emitExpr(expr.right)})`
          const op = expr.op.slice(0, -1)
          return `${setter}(_${lname}${op}(${this.emitExpr(expr.right)}))`
        }
        return `(${this.emitExpr(expr.left)}${expr.op}${this.emitExpr(expr.right)})`
      }

      case 'MemberExpr':
        if (expr.computed) {
          return `${this.emitExpr(expr.object)}[${this.emitExpr(expr.property)}]`
        }
        return `${this.emitExpr(expr.object)}.${expr.property.name ?? expr.property.value}`

      case 'OptionalChain':
        return `${this.emitExpr(expr.object)}?.${expr.property.name ?? expr.property.value}`

      case 'NullCoalesce':
        return `(${this.emitExpr(expr.left)}??${this.emitExpr(expr.right)})`

      case 'CallExpr': {
        const args = (expr.args ?? []).map(a => this.emitExpr(a)).join(',')
        // new ClassName(args) is encoded as CallExpr(MemberExpr(null, Identifier(name)), args)
        if (expr.callee?.type === 'MemberExpr' && expr.callee.object === null) {
          const className = expr.callee.property?.name ?? expr.callee.property?.value ?? ''
          _assertSafeIdent(className, 'new expr class name')
          return `new ${className}(${args})`
        }
        const calleeType = expr.callee?.type
        const callee = this.emitExpr(expr.callee)
        // Arrow/function expressions must be wrapped in parens before being called
        if (calleeType === 'ArrowFn' || calleeType === 'FnExpr') {
          return `(${callee})(${args})`
        }
        return `${callee}(${args})`
      }

      case 'ArrayLiteral': {
        const els = (expr.elements ?? []).map(e => this.emitExpr(e)).join(',')
        return `[${els}]`
      }

      case 'ObjectLiteral': {
        const props = (expr.properties ?? []).map(p => {
          if (p.shorthand) {
            _assertSafeIdent(p.key, 'object shorthand key')
            return p.key
          }
          if (p.computedKey) {
            return `[${this.emitExpr(p.computedKey)}]:${this.emitExpr(p.value)}`
          }
          return `${JSON.stringify(p.key)}:${this.emitExpr(p.value)}`
        }).join(',')
        return `{${props}}`
      }

      case 'ArrowFn': {
        const params = (expr.params ?? []).map(p => {
          const pname = p.name ?? p
          _assertSafeIdent(pname, 'arrow fn param')
          return pname
        }).join(',')
        const body = expr.body?.type === 'BlockStatement'
          ? `{${this.emitBody(expr.body.body)}}`
          : this.emitExpr(expr.body)
        const prefix = expr.isAsync ? 'async ' : ''
        return `${prefix}(${params})=>${body}`
      }

      case 'TernaryExpr':
        return `(${this.emitExpr(expr.condition)}?${this.emitExpr(expr.consequent)}:${this.emitExpr(expr.alternate)})`

      case 'MatchExpr':
        return this.emitMatchExpr(expr)

      case 'PipelineExpr':
        return this.emitPipeline(expr)

      case 'RangeExpr':
        return this.emitRange(expr)

      case 'IsExpr':
        return this.emitIsExpr(expr)

      case 'AwaitExpr':
        return `await ${this.emitExpr(expr.argument)}`

      case 'SpreadElement':
        return `...${this.emitExpr(expr.argument)}`

      case 'ResultOk':
        return `{ok:true,value:${this.emitExpr(expr.value)}}`

      case 'ResultErr':
        return `{ok:false,error:${this.emitExpr(expr.value)}}`

      case 'TryExpr':
        return `(()=>{try{const _r=${this.emitExpr(expr.expr)};return _r;}catch(_e){return {ok:false,error:_e.message}}})()`

      case 'ThrowExpr':
        return `(()=>{throw new Error(${this.emitExpr(expr.argument)})})()`

      default:
        throw new Error(`Arc JS emitter: unhandled expression type "${expr.type}": this is a compiler bug`)
    }
  }

  emitMatchExpr(expr) {
    if (!expr.arms || expr.arms.length === 0) return 'undefined'
    const id = (this._matchCounter = (this._matchCounter ?? 0) + 1)
    const subj = `_ms${id}`
    const matchRef = `_mr${id}`
    const sentinel = `_mn${id}` // unique no-match sentinel avoids collision with undefined arm results
    const arms = (expr.arms ?? []).map(arm => {
      const body = this.emitExpr(arm.body)
      if (!arm.pattern || arm.pattern.type === 'Wildcard') {
        return `(${body})`
      }
      // Identifier binding pattern: always matches, introduces bound variable
      if (arm.pattern.type === 'Identifier') {
        const bindName = arm.pattern.name
        _assertSafeIdent(bindName, 'match binding')
        return `((${bindName})=>(${body}))(${subj})`
      }
      const cond = this.emitPattern(arm.pattern, subj)
      return `(${cond}?(${body}):${sentinel})`
    })
    // Chain right-to-left; assign each arm to matchRef so it's only evaluated once
    const chain = arms.reduceRight((acc, cur, i) => {
      if (i === arms.length - 1) return cur // wildcard/binding: no sentinel check needed
      return `((${matchRef}=${cur})!==${sentinel}?${matchRef}:${acc})`
    })
    // Outer IIFE: subj=subject, matchRef=arm scratch, sentinel=Symbol() for no-match
    return `((${subj},${matchRef},${sentinel})=>${chain})(${this.emitExpr(expr.subject)},undefined,Symbol())`
  }

  emitPattern(pattern, subj) {
    if (!pattern || pattern.type === 'Wildcard') return 'true'
    if (pattern.type === 'Literal') return `${subj}===${JSON.stringify(pattern.value)}`
    if (pattern.type === 'IsExpr') {
      return this.emitIsCheck(pattern.typeOrValue, subj)
    }
    if (pattern.type === 'VariantPattern') {
      const v = pattern.variant
      if (v === 'None') return `(${subj}===null||${subj}===undefined)`
      if (v === 'Some') return `(${subj}!==null&&${subj}!==undefined)`
      if (v === 'Ok')   return `(${subj}?.ok===true)`
      if (v === 'Err')  return `(${subj}?.ok===false)`
      return 'true'
    }
    // Identifier binding: handled in emitMatchExpr/emitMatchStmt directly
    return 'true'
  }

  emitPipeline(expr) {
    // left |> right  →  right(left)
    const left = this.emitExpr(expr.left)
    const right = expr.right
    if (right.type === 'CallExpr') {
      const args = (right.args ?? []).map(a => this.emitExpr(a)).join(',')
      const sep = args ? ',' : ''
      return `${this.emitExpr(right.callee)}(${left}${sep}${args})`
    }
    return `(${this.emitExpr(right)})(${left})`
  }

  emitRange(expr) {
    const start = this.emitExpr(expr.start)
    const end = this.emitExpr(expr.end)
    const inc = expr.inclusive ? '+1' : ''
    return `Array.from({length:(${end}${inc})-(${start})},(_,i)=>i+(${start}))`
  }

  emitIsExpr(expr) {
    return this.emitIsCheck(expr.typeOrValue, this.emitExpr(expr.subject))
  }

  emitIsCheck(typeOrValue, subj) {
    if (!typeOrValue) return 'true'
    const name = typeOrValue.type === 'Identifier' ? typeOrValue.name : null
    if (!name) return `${subj}===${this.emitExpr(typeOrValue)}`

    switch (name) {
      case 'String':  return `typeof ${subj}==='string'`
      case 'Number':  return `typeof ${subj}==='number'`
      case 'Boolean': return `typeof ${subj}==='boolean'`
      case 'Array':   return `Array.isArray(${subj})`
      case 'none':    return `(${subj}===null||${subj}===undefined)`
      default:        return `${subj} instanceof ${name}`
    }
  }

  // ── Statement emission ─────────────────────────────────────────────────────

  emitBody(stmts) {
    if (!stmts) return ''
    if (!Array.isArray(stmts)) return this.emitStmt(stmts)
    const parts = []
    for (const s of stmts) {
      const r = this.emitStmt(s)
      if (r) parts.push(r)
    }
    return parts.join('\n')
  }

  emitStmt(stmt) {
    if (!stmt) return ''

    switch (stmt.type) {
      case 'VarDecl': {
        _assertSafeIdent(stmt.name, 'var decl name')
        const kind = stmt.kind === 'let' ? 'let' : 'const'
        return `${kind} ${stmt.name}=${this.emitExpr(stmt.init)};`
      }

      case 'ExprStatement':
        return `${this.emitExpr(stmt.expr)};`

      case 'ReturnStatement':
        return `return ${this.emitExpr(stmt.value)};`

      case 'IfStatement': {
        const cond = this.emitExpr(stmt.condition)
        const cons = this.emitBody(stmt.consequent?.body ?? stmt.consequent)
        const alt = stmt.alternate ? `else{${this.emitBody(stmt.alternate?.body ?? stmt.alternate)}}` : ''
        return `if(${cond}){${cons}}${alt}`
      }

      case 'UnlessStatement': {
        const cond = this.emitExpr(stmt.condition)
        const body = this.emitBody(stmt.body?.body ?? stmt.body)
        return `if(!(${cond})){${body}}`
      }

      case 'WhileStatement': {
        const cond = this.emitExpr(stmt.condition)
        const body = this.emitBody(stmt.body?.body ?? stmt.body)
        return `while(${cond}){${body}}`
      }

      case 'UntilStatement': {
        const cond = this.emitExpr(stmt.condition)
        const body = this.emitBody(stmt.body?.body ?? stmt.body)
        return `while(!(${cond})){${body}}`
      }

      case 'LoopStatement': {
        const body = this.emitBody(stmt.body?.body ?? stmt.body)
        return `while(true){${body}}`
      }

      case 'ForStatement': {
        const coll = this.emitExpr(stmt.collection)
        const item = stmt.itemName ?? 'item'
        const idx = stmt.indexName
        _assertSafeIdent(item, 'for item var')
        if (idx) _assertSafeIdent(idx, 'for index var')
        const body = this.emitBody(stmt.body?.body ?? stmt.body)
        if (idx) {
          return `${coll}.forEach(function(${item},${idx}){${body}});`
        }
        return `for(const ${item} of ${coll}){${body}}`
      }

      case 'BreakStatement':    return 'break;'
      case 'ContinueStatement': return 'continue;'

      case 'TryCatch': {
        const tryBody = this.emitBody(stmt.tryBody?.body ?? stmt.tryBody)
        const catchParam = stmt.catchParam ?? 'e'
        _assertSafeIdent(catchParam, 'catch param')
        const catchBody = this.emitBody(stmt.catchBody?.body ?? stmt.catchBody)
        return `try{${tryBody}}catch(${catchParam}){${catchBody}}`
      }

      case 'MatchStatement':
        return this.emitMatchStmt(stmt)

      case 'BlockStatement':
        return `{${this.emitBody(stmt.body)}}`

      case 'FnDecl':
        return this.emitFnDecl(stmt)

      case 'ClassDecl':
        return this.emitClassDecl(stmt)

      default:
        return ''
    }
  }

  emitMatchStmt(stmt) {
    const id = (this._matchCounter = (this._matchCounter ?? 0) + 1)
    const subj = `_ms${id}`
    const cond = this.emitExpr(stmt.subject)
    const arms = (stmt.arms ?? []).map(arm => {
      // arm.body can be BlockStatement, array of stmts, or a single expression
      const body = arm.body?.type === 'BlockStatement' ? this.emitBody(arm.body.body)
                 : Array.isArray(arm.body)              ? this.emitBody(arm.body)
                 : arm.body                             ? `${this.emitExpr(arm.body)};`
                 : ''
      if (!arm.pattern || arm.pattern.type === 'Wildcard') {
        return `{${body}}`
      }
      // Identifier binding pattern: always matches, introduces bound variable
      if (arm.pattern.type === 'Identifier') {
        const bindName = arm.pattern.name
        _assertSafeIdent(bindName, 'match binding')
        return `{const ${bindName}=${subj};${body}}`
      }
      // VariantPattern (Some/None/Ok/Err): may also introduce a binding name
      if (arm.pattern.type === 'VariantPattern' && arm.pattern.name) {
        const test = this.emitPattern(arm.pattern, subj)
        const bindName = arm.pattern.name
        _assertSafeIdent(bindName, 'match binding')
        return `if(${test}){const ${bindName}=${subj};${body}}`
      }
      const test = this.emitPattern(arm.pattern, subj)
      return `if(${test}){${body}}`
    })
    // Last arm without condition becomes else{body}; conditional arms chain with else if
    return `{const ${subj}=${cond};${arms.join('else ')}}`
  }

  emitFnDecl(fn) {
    _assertSafeIdent(fn.name, 'fn decl name')
    const params = (fn.params ?? []).map(p => {
      if (p.type === 'Param') {
        const pname = p.name ?? '_'
        _assertSafeIdent(pname, 'fn param')
        const def = p.defaultValue ? `=${this.emitExpr(p.defaultValue)}` : ''
        const rest = p.rest ? '...' : ''
        return `${rest}${pname}${def}`
      }
      const pname = p.name ?? '_'
      _assertSafeIdent(pname, 'fn param')
      return pname
    }).join(',')

    const async_ = fn.isAsync ? 'async ' : ''

    if (fn.body?.type === 'BlockStatement') {
      const body = this.emitBody(fn.body.body)
      return `${async_}function ${fn.name}(${params}){${body}}`
    }
    // Expression body
    return `${async_}function ${fn.name}(${params}){return ${this.emitExpr(fn.body)};}`
  }

  emitClassDecl(cls) {
    _assertSafeIdent(cls.name, 'class name')
    const methods = (cls.methods ?? []).map(m => {
      _assertSafeIdent(m.name, 'class method name')
      const params = (m.params ?? []).map(p => {
        const pname = p.name ?? p
        _assertSafeIdent(pname, 'class method param')
        return pname
      }).join(',')
      const body = this.emitBody(m.body?.body ?? m.body)
      const static_ = m.isStatic ? 'static ' : ''
      const getter = m.isGetter ? 'get ' : ''
      return `${static_}${getter}${m.name}(${params}){${body}}`
    })
    const fields = (cls.fields ?? []).map(f => {
      _assertSafeIdent(f.name, 'class field name')
      const static_ = f.isStatic ? 'static ' : ''
      return `${static_}${f.name}${f.init ? `=${this.emitExpr(f.init)}` : ''};`
    })
    return `class ${cls.name}{${fields.join('')}${methods.join('')}}`
  }
}

module.exports = { JsEmitter }
