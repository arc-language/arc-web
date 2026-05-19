'use strict'

// Token types for the Arc lexer
const T = {
  // Literals
  STRING: 'STRING',       // "hello" or 'hello'
  NUMBER: 'NUMBER',       // 42, 3.14
  BOOL: 'BOOL',           // true, false
  NONE: 'NONE',           // none

  // Identifiers and keywords
  IDENT: 'IDENT',         // foo, myVar
  AT_IDENT: 'AT_IDENT',   // @count, @state, @build, @computed, @server, @worker

  // Structure keywords
  PAGE: 'PAGE',
  WIDGET: 'WIDGET',
  DESIGN: 'DESIGN',
  IMPORT: 'IMPORT',
  EXPORT: 'EXPORT',
  FROM: 'FROM',

  // Logic keywords
  CONST: 'CONST',
  LET: 'LET',
  FN: 'FN',
  CLASS: 'CLASS',
  RETURN: 'RETURN',
  IF: 'IF',
  ELSE: 'ELSE',
  UNLESS: 'UNLESS',
  MATCH: 'MATCH',
  FOR: 'FOR',
  IN: 'IN',
  WHILE: 'WHILE',
  UNTIL: 'UNTIL',
  LOOP: 'LOOP',
  BREAK: 'BREAK',
  CONTINUE: 'CONTINUE',
  AWAIT: 'AWAIT',
  ASYNC: 'ASYNC',
  GEN: 'GEN',
  YIELD: 'YIELD',
  TRY: 'TRY',
  CATCH: 'CATCH',
  THROW: 'THROW',
  NEW: 'NEW',
  STATIC: 'STATIC',
  GET: 'GET',
  IS: 'IS',
  RAW: 'RAW',

  // Result type
  OK: 'OK',
  ERR: 'ERR',

  // Symbols
  LPAREN: 'LPAREN',       // (
  RPAREN: 'RPAREN',       // )
  LBRACE: 'LBRACE',       // {
  RBRACE: 'RBRACE',       // }
  LBRACKET: 'LBRACKET',   // [
  RBRACKET: 'RBRACKET',   // ]
  DOT: 'DOT',             // .
  DOTDOT: 'DOTDOT',       // ..
  DOTDOTEQ: 'DOTDOTEQ',   // ..=
  COMMA: 'COMMA',         // ,
  COLON: 'COLON',         // :
  SEMI: 'SEMI',           // ;
  ARROW: 'ARROW',         // =>
  THIN_ARROW: 'THIN_ARROW', // ->
  PIPE: 'PIPE',           // |>
  QUESTION: 'QUESTION',   // ?
  QQDOT: 'QQDOT',         // ?.
  QQ: 'QQ',               // ??
  HASH: 'HASH',           // #
  AT: 'AT',               // @ (standalone)
  SPREAD: 'SPREAD',       // ...

  // Operators
  PLUS: 'PLUS',
  MINUS: 'MINUS',
  STAR: 'STAR',
  SLASH: 'SLASH',
  PERCENT: 'PERCENT',
  STARSTAR: 'STARSTAR',   // **
  EQ: 'EQ',               // =
  EQEQ: 'EQEQ',           // == (strict in Arc)
  BANGEQ: 'BANGEQ',       // !=
  LT: 'LT',               // <
  GT: 'GT',               // >
  LTEQ: 'LTEQ',           // <=
  GTEQ: 'GTEQ',           // >=
  BANG: 'BANG',           // !
  AMP: 'AMP',             // &
  AMPAMP: 'AMPAMP',       // &&
  BAR: 'BAR',             // |
  BARBAR: 'BARBAR',       // ||
  CARET: 'CARET',         // ^
  LSHIFT: 'LSHIFT',       // <<
  RSHIFT: 'RSHIFT',       // >>
  PLUS_EQ: 'PLUS_EQ',     // +=
  MINUS_EQ: 'MINUS_EQ',   // -=
  STAR_EQ: 'STAR_EQ',     // *=
  SLASH_EQ: 'SLASH_EQ',   // /=

  // Template-specific
  INDENT: 'INDENT',       // increase in indentation
  DEDENT: 'DEDENT',       // decrease in indentation
  NEWLINE: 'NEWLINE',     // significant newline

  // Section markers
  DESIGN_SECTION: 'DESIGN_SECTION',   // 'design' block start
  SCRIPT_SECTION: 'SCRIPT_SECTION',   // top-level logic

  // Interpolation
  INTERP_START: 'INTERP_START',  // { inside a string
  INTERP_END: 'INTERP_END',      // } closing interpolation

  // Template attribute operators
  BIND_VALUE: 'BIND_VALUE',    // bind:value
  ON_EVENT: 'ON_EVENT',        // on:click, on:input etc.
  DIALOG_OPEN: 'DIALOG_OPEN',  // dialog:open
  DIALOG_CLOSE: 'DIALOG_CLOSE',// dialog:close

  EOF: 'EOF',
}

const KEYWORDS = new Map([
  ['page', T.PAGE],
  ['widget', T.WIDGET],
  ['design', T.DESIGN],
  ['import', T.IMPORT],
  ['export', T.EXPORT],
  ['from', T.FROM],
  ['const', T.CONST],
  ['let', T.LET],
  ['fn', T.FN],
  ['class', T.CLASS],
  ['return', T.RETURN],
  ['if', T.IF],
  ['else', T.ELSE],
  ['unless', T.UNLESS],
  ['match', T.MATCH],
  ['for', T.FOR],
  ['in', T.IN],
  ['while', T.WHILE],
  ['until', T.UNTIL],
  ['loop', T.LOOP],
  ['break', T.BREAK],
  ['continue', T.CONTINUE],
  ['await', T.AWAIT],
  ['async', T.ASYNC],
  ['gen', T.GEN],
  ['yield', T.YIELD],
  ['try', T.TRY],
  ['catch', T.CATCH],
  ['throw', T.THROW],
  ['new', T.NEW],
  ['static', T.STATIC],
  ['get', T.GET],
  ['is', T.IS],
  ['true', T.BOOL],
  ['false', T.BOOL],
  ['none', T.NONE],
  ['raw', T.RAW],
  ['Ok', T.OK],
  ['Err', T.ERR],
])

// HTML element names that Arc recognizes as structure nodes
const STRUCTURE_ELEMENTS = new Set([
  // Arc layout primitives
  'page', 'widget', 'card', 'row', 'col', 'stack', 'grid', 'center', 'spacer', 'divider',
  // Semantic HTML
  'nav', 'main', 'header', 'footer', 'aside', 'article', 'section',
  'figure', 'figcaption', 'blockquote', 'cite',
  // Content
  'heading', 'text', 'paragraph', 'span', 'link', 'img', 'code', 'pre', 'kbd',
  // Interactive
  'button', 'input', 'select', 'textarea', 'form', 'label', 'fieldset',
  'checkbox', 'radio', 'range', 'file',
  // Lists
  'ul', 'ol', 'li',
  // Table (simplified)
  'table', 'row', 'cell', 'thead', 'tbody', 'tfoot',
  // Media
  'video', 'audio', 'track', 'canvas', 'svg',
  // Native patterns
  'modal', 'tooltip', 'accordion', 'summary', 'details',
  // Typography
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'em', 'strong',
  // Icon/badge
  'icon', 'badge', 'avatar', 'tag',
  // Meta (in page context)
  'rawscript', 'rawstyle',
])

class Token {
  constructor(type, value, line, col) {
    this.type = type
    this.value = value
    this.line = line
    this.col = col
  }

  toString() {
    return `Token(${this.type}, ${JSON.stringify(this.value)}, ${this.line}:${this.col})`
  }
}

module.exports = { T, KEYWORDS, STRUCTURE_ELEMENTS, Token }
