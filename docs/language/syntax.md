# Syntax + EBNF Grammar

Arc is indentation-based. Two spaces = one level. No braces around blocks. Strings use double quotes; `{...}` inside a string is interpolation.

## Quick visual

```arc
import Button from "./Button"        // import

@build const data = await load()     // top-level reactive declaration

widget MyCard(title, body)           // reusable component
  card
    heading "{title}"
    text "{body}"

page "Home"                          // route
  @state let count = 0               // page-level reactive

  main
    MyCard("Hi", "Body")             // invoke widget
    button on:click={ @count += 1 } "+ {count}"

  design                             // styles for THIS page
    card
      p: 24px
      radius: md
```

## EBNF grammar

This grammar matches what `/home/claude/arc/src/parser.js` accepts. Indentation tokens are written as `INDENT` / `DEDENT` / `NEWLINE` for clarity.

```ebnf
(* Top-level *)
Program        = { Declaration } ;
Declaration    = ImportDecl | PageDecl | WidgetDecl | ReactiveDecl
               | ServerFn | WorkerFn | LiveDecl | RealtimeDecl
               | DesignBlock | TypeDecl | ClassDecl | FnDecl ;

ImportDecl     = "import" ImportSpec "from" StringLit NEWLINE ;
ImportSpec     = Identifier | "{" Identifier { "," Identifier } "}" ;

PageDecl       = "page" [ StringLit ] { MetaPair } NEWLINE
                 INDENT BlockBody DEDENT ;
WidgetDecl     = "widget" Identifier [ "(" [ ParamList ] ")" ] NEWLINE
                 INDENT BlockBody DEDENT ;

(* Page/widget body content *)
BlockBody      = { TemplateNode | ReactiveDecl | DesignBlock | LocalFn } ;
TemplateNode   = Element | TextNode | IfNode | UnlessNode | ForNode
               | MatchNode | SlotNode | InterpolationNode ;

Element        = Identifier [ AttrList ] [ StringLit ] NEWLINE
                 [ INDENT BlockBody DEDENT ] ;
AttrList       = { Attr } ;
Attr           = Identifier "=" AttrValue
               | "bind:" Identifier "=" "{" Expr "}"
               | "on:" Identifier "=" "{" Expr "}" ;
AttrValue      = StringLit | NumberLit | "{" Expr "}" | TemplateLit ;

(* Reactive declarations *)
ReactiveDecl   = ( "@build" | "@state" | "@computed" )
                 ( "let" | "const" ) Identifier [ TypeAnnot ]
                 "=" Expr NEWLINE ;

LiveDecl       = "@live" ( "let" | "const" ) Identifier [ TypeAnnot ]
                 "=" Expr NEWLINE ;

RealtimeDecl   = "@realtime" ( "let" | "const" ) Identifier
                 "=" "channel" "(" StringLit ")" NEWLINE ;

ServerFn       = "@server" "fn" Identifier "(" [ ParamList ] ")"
                 [ "->" TypeAnnot ] NEWLINE
                 INDENT FnBody DEDENT ;

WorkerFn       = "@worker" "fn" Identifier "(" [ ParamList ] ")"
                 [ "->" TypeAnnot ] NEWLINE
                 INDENT FnBody DEDENT ;

(* Functions + classes *)
FnDecl         = "fn" Identifier "(" [ ParamList ] ")"
                 [ "->" TypeAnnot ] ( "=>" Expr | NEWLINE INDENT FnBody DEDENT ) ;
ParamList      = Param { "," Param } ;
Param          = Identifier [ ":" TypeAnnot ] [ "=" Expr ] ;

ClassDecl      = "class" Identifier [ "extends" Identifier ] NEWLINE
                 INDENT { ClassMember } DEDENT ;
ClassMember    = FieldDecl | MethodDecl | GetterDecl | StaticDecl ;
FieldDecl      = "@" Identifier [ "=" Expr ] NEWLINE ;
MethodDecl     = "fn" Identifier "(" [ ParamList ] ")" NEWLINE
                 INDENT FnBody DEDENT ;
GetterDecl     = "@get" Identifier "(" ")" "=>" Expr NEWLINE ;
StaticDecl     = "static" FnDecl ;

(* Control flow *)
IfNode         = "if" Expr NEWLINE INDENT BlockBody DEDENT
                 [ "else" "if" Expr NEWLINE INDENT BlockBody DEDENT ]
                 [ "else" NEWLINE INDENT BlockBody DEDENT ] ;
UnlessNode     = "unless" Expr NEWLINE INDENT BlockBody DEDENT ;
ForNode        = "for" Identifier [ "," Identifier ] "in" Expr NEWLINE
                 INDENT BlockBody DEDENT ;
MatchNode      = "match" Expr NEWLINE
                 INDENT { MatchArm } DEDENT ;
MatchArm       = Pattern "=>" ( Expr | NEWLINE INDENT BlockBody DEDENT ) NEWLINE ;
Pattern        = Literal | Identifier | TypeGuard | ObjectPattern | "_" ;
TypeGuard      = Identifier "is" TypeName ;

(* Expressions *)
Expr           = AssignExpr ;
AssignExpr     = TernaryExpr [ AssignOp Expr ] ;
TernaryExpr    = NullCoalesce ;
NullCoalesce   = LogicalOr { "??" LogicalOr } ;
LogicalOr      = LogicalAnd { "||" LogicalAnd } ;
LogicalAnd     = Equality   { "&&" Equality } ;
Equality       = Comparison { ( "==" | "!=" ) Comparison } ;
Comparison     = AdditiveExpr { ( "<" | ">" | "<=" | ">=" ) AdditiveExpr } ;
AdditiveExpr   = MultiplicativeExpr { ( "+" | "-" ) MultiplicativeExpr } ;
MultiplicativeExpr = PipelineExpr { ( "*" | "/" | "%" ) PipelineExpr } ;
PipelineExpr   = UnaryExpr { "|>" UnaryExpr } ;
UnaryExpr      = [ "!" | "-" | "await" ] PostfixExpr ;
PostfixExpr    = PrimaryExpr { "(" [ ArgList ] ")" | "." Identifier | "[" Expr "]" } ;
PrimaryExpr    = Literal | Identifier | AtProperty | TemplateLit
               | ArrayLit | ObjectLit | "(" Expr ")"
               | FnExpr | MatchExpr | RangeExpr | TryExpr ;
AtProperty     = "@" Identifier ;     (* @count, @session.userId, @field *)
RangeExpr      = Expr ".." Expr | Expr "..=" Expr ;

(* Type annotations — same surface as expressions, evaluated separately *)
TypeAnnot      = TypeName | UnionType | ObjectType | ArrayType ;
TypeName       = "String" | "Number" | "Boolean" | "Date" | "none"
               | Identifier ;
UnionType      = TypeAnnot "|" TypeAnnot ;
ObjectType     = "{" Identifier ":" TypeAnnot { "," Identifier ":" TypeAnnot } "}" ;
ArrayType      = TypeName "[" "]" ;

(* Design block *)
DesignBlock    = "design" NEWLINE
                 INDENT { StyleRule | StyleCondition } DEDENT ;
StyleRule      = Selector NEWLINE INDENT { StyleProp | NestedRule } DEDENT ;
StyleProp      = Identifier ":" Value NEWLINE ;
StyleCondition = "@" MediaName "{" { StyleRule } "}"
               | ( "hover" | "focus" | "active" ) ":" "{" { StyleProp } "}" ;
MediaName      = "mobile" | "tablet" | "desktop" | "dark" | "container" ;

(* Literals *)
StringLit      = '"' { Char | "{" Expr "}" | EscapeSeq } '"' ;
EscapeSeq      = "\\" ( "n" | "t" | "r" | "\\" | '"' | "'" | "{" ) ;
NumberLit      = Digit { Digit } [ "." Digit { Digit } ] ;
ArrayLit       = "[" [ Expr { "," Expr } ] "]" ;
ObjectLit      = "{" [ ObjectField { "," ObjectField } ] "}" ;
ObjectField    = Identifier ( ":" Expr | ":" )                      (* shorthand *)
               | "..." Expr ;                                        (* spread *)

(* Identifier *)
Identifier     = ( Letter | "_" ) { Letter | Digit | "_" | "-" } ;
```

## Tokens

| Token | Description |
| --- | --- |
| `STRING` | `"..."` with `{expr}` interpolation. Escapes: `\n \t \r \\ \" \' \{` |
| `NUMBER` | Integer or float. No `0x` / `0b` literals. |
| `IDENT` | `[a-zA-Z_][a-zA-Z0-9_-]*` — kebab-case allowed in element names |
| `AT_IDENT` | `@identifier` — reactive property or field reference |
| `INDENT` / `DEDENT` | 2-space indentation level changes |
| `NEWLINE` | Statement / declaration terminator |
| Operators | `+ - * / % ! ?? \|\| && == != < > <= >= = .. ..= \|>` |
| Punctuation | `( ) [ ] { } , : . => @` |
| Keywords | `import from page widget design class fn let const if else unless until while for in match is await async return import export new try Ok Err static @get @build @state @computed @live @realtime @server @worker @session @slot @field @attr` |

## Indentation rules

- Two spaces per level (configurable; tabs forbidden by default)
- Same level continues the current block
- More spaces opens a new child block
- Fewer spaces closes the current block (DEDENT)
- Blank lines are ignored for indentation

```arc
page "Example"        # level 0
  main                # level 1
    card              # level 2 (child of main)
      heading "Hi"    # level 3 (child of card)
                      # blank line OK
    card              # back to level 2 (sibling of first card)
```

## String interpolation

Inside `"..."`, `{expr}` evaluates `expr` and inserts the result:

```arc
text "Hello, {user.name}!"
text "{count * 2} items"
text "Cost: ${(price * qty).toFixed(2)}"
```

To emit a literal `{`, escape with `\{`:

```arc
text "JSON object: \{ key: value \}"
```

## Comments

```arc
// Single-line comment
text "Hello"   // trailing comment
```

Block comments are **not** supported. Use multiple single-line comments.

## Truthiness rules

Only **`false`** and **`none`** are falsy. Everything else — including `0`, `""`, `[]`, `{}` — is truthy.

```arc
if count                  // true even when count == 0
if items.length > 0       // explicit comparison if you want zero-check semantics
unless user               // runs only when user is none or false
```

This is a deliberate departure from JavaScript to make conditions predictable.

## Equality

`==` and `!=` are **always strict**. There's no `===`.

```arc
1 == "1"      // ERROR at compile time: type mismatch
1 == 1.0      // true
NaN == NaN    // true (fixed from JS)
none == none  // true
```

## Reserved / banned

These produce compile errors:

- `var` — use `let` or `const`
- `null` — use `none`
- `===`, `!==` — use `==`, `!=`
- `function` keyword — use `fn`
- `this` — use `@field` in classes
- `for ... in` (over object keys) — use `for k, v in obj`
- `switch` — use `match`
- `typeof`, `instanceof` — use `x is Type`
- `with`, `void`, `eval`, `delete` — banned
- `~`, `>>>` — banned (no bitwise tricks)
- Labeled statements, comma operator — banned

## Next

- [Data Contexts](data-contexts.md) — the `@build`/`@state`/`@live`/`@realtime` quartet
- [Structure](structure.md) — element vocabulary
- [Design Vocabulary](design-vocabulary.md) — CSS-equivalent reference
