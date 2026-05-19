'use strict'

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

    // If nothing reactive, emit nothing
    if (stateDecls.length === 0 && eventBindings.length === 0) return ''

    // Set of all reactive variable names — used by emitRuntimeExpr to prefix identifiers
    this.stateVarNames = new Set([
      ...stateDecls.map(s => s.name),
      ...computedDecls.map(c => c.name),
    ])

    const parts = []

    // Build dependency graph: stateVar → [binding]
    const deps = this.buildDeps(stateDecls, computedDecls, stateBindings)

    parts.push('(function(){')
    let genLine = 1  // incremental line counter avoids O(n²) join+scan

    // State variable declarations
    for (const s of stateDecls) {
      if (this.sourceMap && s.line != null) {
        this.sourceMap.addMapping(genLine, 0, s.line - 1, 0)
      }
      const code = `let _${s.name}=${this.emitExpr(s.init)};`
      genLine += (code.match(/\n/g) ?? []).length + 1
      parts.push(code)
    }

    // Computed variable declarations
    for (const c of computedDecls) {
      if (this.sourceMap && c.line != null) {
        this.sourceMap.addMapping(genLine, 0, c.line - 1, 0)
      }
      const code = `let _${c.name}=${this.emitExpr(c.init)};`
      genLine += (code.match(/\n/g) ?? []).length + 1
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
      genLine += (code.match(/\n/g) ?? []).length + 1
      parts.push(code)
    }

    // Computed recompute functions
    for (const c of computedDecls) {
      const dependents = this.findComputedDependents(c.name, computedDecls, stateBindings)
      if (dependents.length > 0) {
        parts.push(`function _recompute_${c.name}(){`)
        parts.push(`_${c.name}=${this.emitExpr(c.init)};`)
        for (const b of dependents) {
          parts.push(this.emitBindingUpdate(b))
        }
        parts.push('}')
      }
    }

    // Setter functions — one per @state variable
    for (const s of stateDecls) {
      const affected = deps.get(s.name) ?? []
      parts.push(`function _set_${s.name}(v){`)
      parts.push(`_${s.name}=v;`)

      // Recompute dependents
      const affectedComputed = computedDecls.filter(c =>
        this.exprReferences(c.init, s.name)
      )
      for (const c of affectedComputed) {
        parts.push(`_${c.name}=${this.emitExpr(c.init)};`)
        // Cascade: recompute computed that depend on this computed
        const cascade = computedDecls.filter(c2 =>
          c2.name !== c.name && this.exprReferences(c2.init, c.name)
        )
        for (const c2 of cascade) {
          parts.push(`_${c2.name}=${this.emitExpr(c2.init)};`)
        }
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
    for (const b of stateBindings.filter(b => b.kind === 'bind')) {
      if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(b.expr)) {
        throw new Error(`Arc codegen: bind:value only supports simple state variable names, got: ${JSON.stringify(b.expr)}`)
      }
      parts.push(
        `(function(){const _be=document.getElementById('${b.id}');if(!_be)return;` +
        `const _bevt=_be.tagName==='SELECT'||_be.type==='checkbox'||_be.type==='radio'?'change':'input';` +
        `_be.addEventListener(_bevt,function(e){` +
        `const _bv=_be.type==='checkbox'||_be.type==='radio'?e.target.checked:_be.type==='number'?parseFloat(e.target.value):e.target.value;` +
        `if(_be.type!=='number'||!isNaN(_bv))_set_${b.expr}(_bv);` +
        `});})();`
      )
    }

    // Initial render — set all reactive nodes to their initial values
    for (const b of stateBindings) {
      parts.push(this.emitBindingUpdate(b))
    }

    parts.push('})();')

    return parts.join('\n')
  }

  // ── Dependency graph ───────────────────────────────────────────────────────

  buildDeps(stateDecls, computedDecls, stateBindings) {
    const deps = new Map()

    for (const s of stateDecls) {
      const affected = []
      for (const b of stateBindings) {
        if (this.bindingDependsOn(b, s.name, computedDecls)) {
          affected.push(b)
        }
      }
      deps.set(s.name, affected)
    }

    return deps
  }

  bindingDependsOn(binding, stateVar, computedDecls) {
    const expr = binding.expr ?? ''
    // Check if stateVar appears as a whole word in the expression
    const re = new RegExp(`(?:^|[^a-zA-Z0-9_@])@?${stateVar}(?:[^a-zA-Z0-9_]|$)`)
    if (re.test(expr)) return true

    // Check if any computed that binding uses depends on stateVar
    for (const c of computedDecls) {
      if (expr.includes(c.name) && this.exprReferences(c.init, stateVar)) return true
    }

    return false
  }

  findComputedDependents(computedName, computedDecls, stateBindings) {
    return stateBindings.filter(b => {
      const expr = b.expr ?? ''
      return expr.includes(computedName)
    })
  }

  exprReferences(expr, name) {
    if (!expr) return false
    // Save/restore _matchCounter so dependency analysis has no side effects on code gen
    const savedCounter = this._matchCounter
    const str = this.emitExpr(expr)
    this._matchCounter = savedCounter
    return new RegExp(`\\b_?${name}\\b`).test(str)
  }

  // ── DOM update snippets ────────────────────────────────────────────────────

  emitBindingUpdate(b) {
    _assertSafeAttr(b.id, 'binding id')
    const el = `_el_${b.id}`
    const val = this.emitRuntimeExpr(b.expr)

    switch (b.kind) {
      case 'if-show':
        return `if(${val}){${el}.removeAttribute('hidden');}else{${el}.setAttribute('hidden','');}`
      case 'if-hide':
        return `if(${val}){${el}.setAttribute('hidden','');}else{${el}.removeAttribute('hidden');}`
      case 'list':
        return this.emitListUpdate(b)
      case 'attr':
        _assertSafeAttr(b.attr, 'attr binding')
        return `${el}.setAttribute('${b.attr}',${val});`
      case 'class-toggle':
        _assertSafeAttr(b.cls, 'class-toggle binding')
        return `${el}.classList.toggle('${b.cls}_${this.componentHash}',!!${val});`
      case 'bind':
        return `if(document.activeElement!==${el})${el}.value=${val};`
      default:
        return `${el}.textContent=${val};`
    }
  }

  emitListUpdate(b) {
    const el = `_el_${b.id}`
    const items = this.emitRuntimeExpr(b.expr)
    const item = b.itemName ?? 'item'
    const idx = b.indexName ?? 'i'
    _assertSafeIdent(item, 'list item var')
    _assertSafeIdent(idx, 'list index var')
    const tpl = JSON.stringify(b.bodyTemplate ?? '')

    // Suffix reactive IDs with item index to ensure DOM uniqueness across list items
    const tplWithIdx = `${tpl}.replace(/\\bid="([^"]+)"/g,function(_,id){return 'id="'+id+'_'+${idx}+'"'})`

    return [
      `(function(){`,
      `const _items=${items};`,
      `if(!Array.isArray(_items)){${el}.innerHTML='';return;}`,
      // Small lists: individual nodes (minimal reflow)
      // Large lists: innerHTML batch (single reflow)
      `if(_items.length<=20){`,
      `  while(${el}.firstChild)${el}.removeChild(${el}.firstChild);`,
      `  _items.forEach(function(${item},${idx}){`,
      `    const _d=document.createElement('div');`,
      `    _d.innerHTML=${tplWithIdx};`,
      `    while(_d.firstChild)${el}.appendChild(_d.firstChild);`,
      `  });`,
      `}else{`,
      `  ${el}.innerHTML=_items.map(function(${item},${idx}){return ${tplWithIdx};}).join('');`,
      `}`,
      `})();`,
    ].join('\n')
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
    // Convert @name → _name, and known state/computed identifiers → _name
    let result = exprStr.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, '_$1')
    if (this.stateVarNames) {
      // Replace bare identifiers (not after a dot) that are state variables with their _prefixed form
      result = result.replace(/(?<![.])\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
        return this.stateVarNames.has(match) ? `_${match}` : match
      })
    }
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
          if (p.type === 'Literal') return p.value
          return `\${${this.emitExpr(p)}}`
        }).join('') + '`'

      case 'BinaryExpr':
        return `(${this.emitExpr(expr.left)}${expr.op}${this.emitExpr(expr.right)})`

      case 'UnaryExpr':
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
        return `${this.emitExpr(expr.object)}.${this.emitExpr(expr.property)}`

      case 'OptionalChain':
        return `${this.emitExpr(expr.object)}?.${this.emitExpr(expr.property)}`

      case 'NullCoalesce':
        return `(${this.emitExpr(expr.left)}??${this.emitExpr(expr.right)})`

      case 'CallExpr': {
        const callee = this.emitExpr(expr.callee)
        const args = (expr.args ?? []).map(a => this.emitExpr(a)).join(',')
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
        return 'undefined'
    }
  }

  emitMatchExpr(expr) {
    const id = (this._matchCounter = (this._matchCounter ?? 0) + 1)
    const subj = `_ms${id}`
    const tmp  = `_mr${id}`
    const arms = (expr.arms ?? []).map(arm => {
      const body = this.emitExpr(arm.body)
      if (!arm.pattern || arm.pattern.type === 'Wildcard') {
        return `(${body})`
      }
      const cond = this.emitPattern(arm.pattern, subj)
      return `(${cond}?(${body}):undefined)`
    })
    // Chain right-to-left; assign each arm to tmp so it's only evaluated once
    const chain = arms.reduceRight((acc, cur, i) => {
      if (i === arms.length - 1) return cur // wildcard — no undefined check needed
      return `((${tmp}=${cur})!==undefined?${tmp}:${acc})`
    })
    // Outer IIFE: subj holds evaluated subject, tmp is scratch for arm results
    return `((${subj},${tmp})=>${chain})(${this.emitExpr(expr.subject)},undefined)`
  }

  emitPattern(pattern, subj) {
    if (!pattern || pattern.type === 'Wildcard') return 'true'
    if (pattern.type === 'Literal') return `${subj}===${JSON.stringify(pattern.value)}`
    if (pattern.type === 'IsExpr') {
      return this.emitIsCheck(pattern.typeOrValue, subj)
    }
    if (pattern.type === 'Identifier') return `${subj}===${pattern.name}`
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
    return stmts.map(s => this.emitStmt(s)).join('\n')
  }

  emitStmt(stmt) {
    if (!stmt) return ''

    switch (stmt.type) {
      case 'VarDecl':
        return `${stmt.kind} _${stmt.name}=${this.emitExpr(stmt.init)};`

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
      const body = this.emitBody(arm.body?.body ?? arm.body)
      if (!arm.pattern || arm.pattern.type === 'Wildcard') {
        return `{${body}break;}`
      }
      const test = this.emitPattern(arm.pattern, subj)
      return `if(${test}){${body}break;}`
    })
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
