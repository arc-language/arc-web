// Arc Code — syntax highlighting widget, ~2KB runtime tokenizer.
// Tokenizer initializes once per page on DOMContentLoaded, not per component.
// Supports JS/TS, Python, HTML, CSS, JSON, Shell, SQL.
//
// Usage: import { Code } from "arc/highlight"
//
// Static content:
//   Code lang="javascript"
//     `const x = 1 + 2`
//
// Multi-line:
//   Code lang="python"
//     `def hello():
//       print("Hi")`
//
// Dynamic highlighting:
//   window.arcHL(el, 'typescript')

@state let _arcHL = (fn() {
  fn esc(t) {
    return t.replace(RegExp("&","g"),"&amp;").replace(RegExp("<","g"),"&lt;").replace(RegExp(">","g"),"&gt;")
  }
  fn mkre(parts, f) {
    return RegExp(parts.join("|"), f ?? "g")
  }
  fn kw(words) {
    return "(\\b(?:" + words + ")\\b)"
  }

  const ML   = "(\\/\\*[\\s\\S]*?\\*\\/)"
  const SLS  = "(\\/\\/[^\\n]*)"
  const SLH  = "(#[^\\n]*)"
  const STRS = "(`[^`]*`|\"[^\"]*\"|'[^']*')"
  const NUMS = "(\\b0x[0-9a-fA-F]+\\b|\\b\\d+\\.?\\d*\\b)"
  const FUNC = "(\\b[a-zA-Z_$][a-zA-Z0-9_$]*(?=\\s*\\())"

  const JS_KW  = "const|let|var|function|return|if|else|for|while|do|class|extends|import|export|from|new|typeof|instanceof|null|undefined|true|false|void|this|super|async|await|try|catch|finally|throw|switch|case|break|continue|default|in|of|delete|yield|static|get|set"
  const TS_KW  = JS_KW + "|type|interface|enum|implements|abstract|readonly|public|private|protected|override|namespace|declare|as|satisfies|keyof|infer"
  const PY_KW  = "def|class|if|elif|else|for|while|return|import|from|as|with|try|except|finally|raise|pass|break|continue|and|or|not|in|is|None|True|False|lambda|yield|global|nonlocal|async|await"
  const SH_KW  = "if|fi|else|elif|then|for|while|do|done|case|esac|function|in|echo|export|local|return|exit|source|alias|unset"
  const SQL_KW = "SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|ORDER|BY|HAVING|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|VIEW|PRIMARY|FOREIGN|KEY|NULL|NOT|AND|OR|LIMIT|OFFSET|AS|DISTINCT|COUNT|SUM|MAX|MIN|AVG|UNION|ALL|EXISTS|IN|LIKE|BETWEEN|CASE|WHEN|THEN|END|WITH|RETURNING"

  const ALIAS = {
    "javascript": "js",
    "typescript": "ts",
    "python": "py",
    "shell": "sh",
    "bash": "sh",
    "zsh": "sh",
    "xml": "html",
    "scss": "css"
  }

  const CONFIGS = {
    "js":   { re: mkre([ML,SLS,STRS,NUMS,kw(JS_KW),FUNC]),                           cls: ["tok-c","tok-c","tok-s","tok-n","tok-k","tok-f"] },
    "ts":   { re: mkre([ML,SLS,STRS,NUMS,kw(TS_KW),FUNC]),                           cls: ["tok-c","tok-c","tok-s","tok-n","tok-k","tok-f"] },
    "py":   { re: mkre([SLH,STRS,NUMS,kw(PY_KW),FUNC]),                              cls: ["tok-c","tok-s","tok-n","tok-k","tok-f"] },
    "sh":   { re: mkre([SLH,STRS,NUMS,kw(SH_KW)]),                                   cls: ["tok-c","tok-s","tok-n","tok-k"] },
    "sql":  { re: mkre([SLS,STRS,NUMS,kw(SQL_KW)],"gi"),                             cls: ["tok-c","tok-s","tok-n","tok-k"] },
    "json": { re: mkre([STRS,NUMS,kw("true|false|null")]),                            cls: ["tok-s","tok-n","tok-k"] },
    "css":  { re: mkre([ML,STRS,"(#[0-9a-fA-F]+\\b)","(@[a-zA-Z-]+)",NUMS]),        cls: ["tok-c","tok-s","tok-t","tok-k","tok-n"] },
    "html": { re: mkre(["(<!--[\\s\\S]*?-->)","(<[^>]*>)"]),                          cls: ["tok-c","tok-t"] }
  }

  fn findGroup(m, cls) {
    let i = 1
    while i < m.length {
      if m[i] != null && m[i] != undefined && m[i] != "" { return cls[i - 1] }
      i += 1
    }
    return ""
  }

  fn highlight(el, lang) {
    const source = el.textContent
    if !source { return }
    const key = ALIAS[lang?.toLowerCase()] ?? lang?.toLowerCase() ?? ""
    const config = CONFIGS[key]
    if !config { el.innerHTML = esc(source); return }

    const re = config.re
    re.lastIndex = 0
    const ranges = []
    let m = re.exec(source)
    while m {
      const c = findGroup(m, config.cls)
      if c { ranges.push([m.index, m.index + m[0].length, c]) }
      m = re.exec(source)
    }

    let result = ""
    let last = 0
    let ri = 0
    while ri < ranges.length {
      const r = ranges[ri]
      result += esc(source.slice(last, r[0]))
      result += "<span class=\"" + r[2] + "\">" + esc(source.slice(r[0], r[1])) + "</span>"
      last = r[1]
      ri += 1
    }
    result += esc(source.slice(last))
    el.innerHTML = result
  }

  document.addEventListener("DOMContentLoaded", fn() {
    document.querySelectorAll("pre.arc-code > code").forEach(fn(el) {
      const lang = el.closest("pre").dataset.lang
      if lang { highlight(el, lang) }
    })
  })

  window.arcHL = highlight
  return highlight
})()

widget Code(lang = "text", theme = "dark")
  pre class="arc-code" data-lang={@lang} data-theme={@theme} aria-label={"Code block" + (@lang != "text" ? " (" + @lang + ")" : "")}
    code
      slot

  design
    pre.arc-code
      font-family: "Fira Code", "Cascadia Code", Consolas, monospace
      font-size: 14px
      line-height: 1.6
      padding: 16px 20px
      border-radius: 8px
      overflow-x: auto
      tab-size: 2
      background: #1e1e2e
      color: #cdd6f4

    pre.arc-code code
      display: block
      white-space: pre

    pre.arc-code .tok-k
      color: #cba6f7
    pre.arc-code .tok-s
      color: #a6e3a1
    pre.arc-code .tok-c
      color: #6c7086
      font-style: italic
    pre.arc-code .tok-n
      color: #fab387
    pre.arc-code .tok-f
      color: #89b4fa
    pre.arc-code .tok-t
      color: #89dceb

    pre.arc-code[data-theme="light"]
      background: #f8f8f8
      color: #24292e
    pre.arc-code[data-theme="light"] .tok-k
      color: #d73a49
    pre.arc-code[data-theme="light"] .tok-s
      color: #032f62
    pre.arc-code[data-theme="light"] .tok-c
      color: #6a737d
      font-style: italic
    pre.arc-code[data-theme="light"] .tok-n
      color: #005cc5
    pre.arc-code[data-theme="light"] .tok-f
      color: #6f42c1
    pre.arc-code[data-theme="light"] .tok-t
      color: #22863a
