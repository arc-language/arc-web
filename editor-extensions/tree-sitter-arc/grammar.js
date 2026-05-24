// tree-sitter grammar for the Arc language.
//
// This is a SKELETON — enough to parse top-level structure and the most common
// patterns for syntax highlighting and structural navigation. It does NOT
// attempt to be a complete second parser (Arc's authoritative parser lives in
// src/parser.js).
//
// To build:
//   npm install tree-sitter-cli
//   npx tree-sitter generate
//   npx tree-sitter test
//
// To use in Neovim / Helix / Zed: publish this as `tree-sitter-arc` on npm
// and register it with the editor's tree-sitter loader.

module.exports = grammar({
  name: 'arc',

  extras: $ => [
    /\s/,
    $.line_comment,
  ],

  rules: {
    source_file: $ => repeat($._declaration),

    _declaration: $ => choice(
      $.page_decl,
      $.widget_decl,
      $.import_decl,
      $.var_decl,
      $.fn_decl,
      $.class_decl,
      $.design_block,
      $.reactive_decl,
    ),

    // ── Comments ──
    line_comment: $ => token(seq('//', /[^\n]*/)),

    // ── Top-level blocks ──
    page_decl: $ => seq(
      'page',
      optional(field('title', $.string)),
      repeat($.meta_pair),
      $._newline,
      optional($._block),
    ),

    widget_decl: $ => seq(
      'widget',
      field('name', $.identifier),
      optional($.params),
      $._newline,
      optional($._block),
    ),

    import_decl: $ => seq(
      'import',
      choice($.identifier, seq('{', commaSep($.identifier), '}')),
      'from',
      $.string,
      $._newline,
    ),

    design_block: $ => seq(
      'design',
      $._newline,
      optional($._block),
    ),

    meta_pair: $ => seq(
      field('key', $.identifier),
      '=',
      field('value', $._expression),
    ),

    // ── Reactive declarations ──
    reactive_decl: $ => seq(
      $.reactive_kind,
      choice('let', 'const'),
      field('name', $.identifier),
      optional(seq(':', $.type_annot)),
      optional(seq('=', $._expression)),
      $._newline,
    ),

    reactive_kind: $ => choice(
      '@build', '@state', '@computed', '@live', '@realtime',
      '@server', '@worker', '@session',
    ),

    // ── Functions + classes ──
    fn_decl: $ => seq(
      optional($.reactive_kind),
      'fn',
      field('name', $.identifier),
      $.params,
      optional(seq('->', $.type_annot)),
      $._newline,
      optional($._block),
    ),

    class_decl: $ => seq(
      'class',
      field('name', $.identifier),
      optional(seq('extends', $.identifier)),
      $._newline,
      optional($._block),
    ),

    var_decl: $ => seq(
      choice('let', 'const'),
      field('name', $.identifier),
      optional(seq(':', $.type_annot)),
      optional(seq('=', $._expression)),
      $._newline,
    ),

    params: $ => seq('(', commaSep(seq($.identifier, optional(seq(':', $.type_annot)))), ')'),

    type_annot: $ => $.identifier,   // simplified — Arc's type grammar is richer

    // ── Block (a sequence of declarations/elements; indentation tracked by tree-sitter's
    //     externals would be ideal, but kept simple here as an opaque _block placeholder)
    _block: $ => repeat1($._block_member),
    _block_member: $ => choice(
      $._declaration,
      $.element,
      $.text_node,
      $.if_node,
      $.for_node,
    ),

    // ── Template nodes ──
    element: $ => seq(
      field('tag', $.identifier),
      repeat($.attr),
      optional(field('inline', $.string)),
      $._newline,
    ),

    attr: $ => seq(
      choice(
        $.identifier,
        seq('bind:', $.identifier),
        seq('on:', $.identifier),
      ),
      '=',
      choice($.string, $.number, seq('{', $._expression, '}')),
    ),

    text_node: $ => seq('text', $.string, $._newline),

    if_node: $ => seq(
      'if',
      $._expression,
      $._newline,
      optional($._block),
      optional(seq('else', $._newline, optional($._block))),
    ),

    for_node: $ => seq(
      'for',
      $.identifier,
      optional(seq(',', $.identifier)),
      'in',
      $._expression,
      $._newline,
      optional($._block),
    ),

    // ── Expressions ──
    _expression: $ => choice(
      $.identifier,
      $.string,
      $.number,
      $.bool,
      $.none_literal,
      $.array_literal,
      $.object_literal,
      $.call_expr,
      $.member_expr,
      $.binary_expr,
      $.paren_expr,
      $.at_property,
    ),

    array_literal: $ => seq('[', commaSep($._expression), ']'),
    object_literal: $ => seq('{', commaSep(seq(
      choice($.identifier, $.string),
      ':',
      $._expression,
    )), '}'),

    call_expr: $ => prec(2, seq($._expression, '(', commaSep($._expression), ')')),
    member_expr: $ => prec.left(1, seq($._expression, '.', $.identifier)),
    binary_expr: $ => prec.left(0, seq(
      $._expression,
      choice('+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=', '|>', '??', '&&', '||'),
      $._expression,
    )),
    paren_expr: $ => seq('(', $._expression, ')'),
    at_property: $ => seq('@', $.identifier),

    // ── Atoms ──
    identifier: $ => /[a-zA-Z_][a-zA-Z0-9_\-]*/,
    string: $ => choice(
      seq('"', repeat(choice(
        /[^"\\{]+/,
        seq('\\', /./),
        seq('{', $._expression, '}'),
      )), '"'),
    ),
    number: $ => /\d+(\.\d+)?/,
    bool: $ => choice('true', 'false'),
    none_literal: $ => 'none',
    _newline: $ => /\n/,
  },
})

function commaSep(rule) {
  return optional(seq(rule, repeat(seq(',', rule))))
}
