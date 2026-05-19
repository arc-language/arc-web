'use strict'

// AST node constructors for Arc
// Every node has: type, line, col

// ── Program ───────────────────────────────────────────────────────────────────

const Program = (imports, declarations, line = 0) => ({
  type: 'Program', imports, declarations, line
})

// ── Imports / Exports ─────────────────────────────────────────────────────────

const ImportDecl = (names, defaultName, source, line) => ({
  type: 'ImportDecl', names, defaultName, source, line
  // names: [{ local, imported }] for named imports
  // defaultName: string for default import
})

const ExportDecl = (declaration, line) => ({
  type: 'ExportDecl', declaration, line
})

// ── Reactive Annotations ──────────────────────────────────────────────────────

const StateDecl = (name, typeAnnotation, init, line) => ({
  type: 'StateDecl', name, typeAnnotation, init, line,
  arcTag: 'reactive'   // classifier will use this
})

const ComputedDecl = (name, typeAnnotation, init, line) => ({
  type: 'ComputedDecl', name, typeAnnotation, init, line,
  arcTag: 'computed'
})

const BuildDecl = (name, typeAnnotation, init, line) => ({
  type: 'BuildDecl', name, typeAnnotation, init, line,
  arcTag: 'build'
})

const LiveDecl = (name, typeAnnotation, init, line) => ({
  type: 'LiveDecl', name, typeAnnotation, init, line,
  arcTag: 'live'
})

const RealtimeDecl = (name, typeAnnotation, channel, line) => ({
  type: 'RealtimeDecl', name, typeAnnotation, channel, line,
  arcTag: 'realtime'
})

const ServerFn = (name, params, returnType, body, line) => ({
  type: 'ServerFn', name, params, returnType, body, line,
  arcTag: 'server'
})

const WorkerFn = (name, params, returnType, body, line) => ({
  type: 'WorkerFn', name, params, returnType, body, line,
  arcTag: 'worker'
})

// ── Component Definitions ─────────────────────────────────────────────────────

const WidgetDecl = (name, params, body, design, line) => ({
  type: 'WidgetDecl', name, params, body, design, line
  // body: TemplateNode
  // design: DesignNode | null
})

const PageDecl = (title, meta, body, design, line) => ({
  type: 'PageDecl', title, meta, body, design, line
})

// ── Template Nodes ────────────────────────────────────────────────────────────

const Element = (tag, classes, id, attrs, children, line) => ({
  type: 'Element', tag, classes, id, attrs, children, line,
  arcTag: null  // set by classifier: static | reactive | native
})

const TextNode = (value, line) => ({
  type: 'TextNode', value, line,
  arcTag: null
})

const InterpolationNode = (expr, line) => ({
  type: 'InterpolationNode', expr, line,
  arcTag: null
})

const IfNode = (condition, consequent, alternate, line) => ({
  type: 'IfNode', condition, consequent, alternate, line,
  arcTag: null
})

const UnlessNode = (condition, consequent, line) => ({
  type: 'UnlessNode', condition, consequent, line,
  arcTag: null
})

const ForNode = (indexName, itemName, collection, body, line) => ({
  type: 'ForNode', indexName, itemName, collection, body, line,
  arcTag: null
  // indexName: null | string (e.g. "i" in "for i, item in items")
  // itemName: string
})

const MatchTemplateNode = (subject, arms, line) => ({
  type: 'MatchTemplateNode', subject, arms, line
  // arms: [{ pattern, body }]
})

const RawNode = (html, line) => ({
  type: 'RawNode', html, line,
  arcTag: 'raw'
})

// ── Design Nodes ──────────────────────────────────────────────────────────────

const DesignBlock = (rules, line) => ({
  type: 'DesignBlock', rules, line
})

const StyleRule = (selector, props, children, line) => ({
  type: 'StyleRule', selector, props, children, line
  // children: nested StyleRule[] (for nesting)
})

const StyleProp = (name, value, line) => ({
  type: 'StyleProp', name, value, line
})

const StyleCondition = (kind, query, rules, line) => ({
  type: 'StyleCondition', kind, query, rules, line
  // kind: 'mobile' | 'tablet' | 'desktop' | 'container' | 'dark' | 'media'
})

// ── Script / Expression Nodes ─────────────────────────────────────────────────

const VarDecl = (kind, name, typeAnnotation, init, line) => ({
  type: 'VarDecl', kind, name, typeAnnotation, init, line
  // kind: 'const' | 'let'
})

const FnDecl = (name, params, returnType, body, isAsync, line) => ({
  type: 'FnDecl', name, params, returnType, body, isAsync, line
  // body: Expr (expression body) | BlockStatement
})

const ClassDecl = (name, fields, methods, line) => ({
  type: 'ClassDecl', name, fields, methods, line
})

const ClassField = (name, typeAnnotation, init, isStatic, line) => ({
  type: 'ClassField', name, typeAnnotation, init, isStatic, line
})

const ClassMethod = (name, params, returnType, body, isStatic, isGetter, line) => ({
  type: 'ClassMethod', name, params, returnType, body, isStatic, isGetter, line
})

const BlockStatement = (body, line) => ({
  type: 'BlockStatement', body, line
})

const ReturnStatement = (value, line) => ({
  type: 'ReturnStatement', value, line
})

const IfStatement = (condition, consequent, alternate, line) => ({
  type: 'IfStatement', condition, consequent, alternate, line
})

const UnlessStatement = (condition, body, line) => ({
  type: 'UnlessStatement', condition, body, line
})

const WhileStatement = (condition, body, line) => ({
  type: 'WhileStatement', condition, body, line
})

const UntilStatement = (condition, body, line) => ({
  type: 'UntilStatement', condition, body, line
})

const LoopStatement = (body, line) => ({
  type: 'LoopStatement', body, line
})

const ForStatement = (indexName, itemName, collection, body, line) => ({
  type: 'ForStatement', indexName, itemName, collection, body, line
})

const BreakStatement = (line) => ({ type: 'BreakStatement', line })
const ContinueStatement = (line) => ({ type: 'ContinueStatement', line })

const TryCatch = (tryBody, catchParam, catchBody, line) => ({
  type: 'TryCatch', tryBody, catchParam, catchBody, line
})

const MatchStatement = (subject, arms, line) => ({
  type: 'MatchStatement', subject, arms, line
})

const ExprStatement = (expr, line) => ({
  type: 'ExprStatement', expr, line
})

// ── Expressions ───────────────────────────────────────────────────────────────

const Identifier = (name, line) => ({ type: 'Identifier', name, line })
const AtProperty = (name, line) => ({ type: 'AtProperty', name, line }) // @count
const Literal = (value, raw, line) => ({ type: 'Literal', value, raw, line })
const TemplateLiteral = (parts, line) => ({ type: 'TemplateLiteral', parts, line })
  // parts: alternating StringPart | ExprPart

const BinaryExpr = (op, left, right, line) => ({ type: 'BinaryExpr', op, left, right, line })
const UnaryExpr = (op, operand, line) => ({ type: 'UnaryExpr', op, operand, line })
const AssignExpr = (op, left, right, line) => ({ type: 'AssignExpr', op, left, right, line })
const LogicalExpr = (op, left, right, line) => ({ type: 'LogicalExpr', op, left, right, line })
const PipelineExpr = (left, right, line) => ({ type: 'PipelineExpr', left, right, line })
const IsExpr = (subject, typeOrValue, line) => ({ type: 'IsExpr', subject, typeOrValue, line })

const CallExpr = (callee, args, line) => ({ type: 'CallExpr', callee, args, line })
const MemberExpr = (object, property, computed, line) => ({ type: 'MemberExpr', object, property, computed, line })
const OptionalChain = (object, property, line) => ({ type: 'OptionalChain', object, property, line })
const NullCoalesce = (left, right, line) => ({ type: 'NullCoalesce', left, right, line })

const ArrayLiteral = (elements, line) => ({ type: 'ArrayLiteral', elements, line })
const ObjectLiteral = (properties, line) => ({ type: 'ObjectLiteral', properties, line })
const ObjectProp = (key, value, shorthand, line, computedKey = null) => ({ type: 'ObjectProp', key, value, shorthand, line, computedKey })
const SpreadElement = (argument, line) => ({ type: 'SpreadElement', argument, line })

const ArrowFn = (params, body, isAsync, line) => ({ type: 'ArrowFn', params, body, isAsync, line })
const AwaitExpr = (argument, line) => ({ type: 'AwaitExpr', argument, line })
const YieldExpr = (argument, line) => ({ type: 'YieldExpr', argument, line })

const TernaryExpr = (condition, consequent, alternate, line) => ({
  type: 'TernaryExpr', condition, consequent, alternate, line
})

const MatchExpr = (subject, arms, line) => ({ type: 'MatchExpr', subject, arms, line })
const MatchArm = (pattern, body, line) => ({ type: 'MatchArm', pattern, body, line })

const RangeExpr = (start, end, inclusive, line) => ({ type: 'RangeExpr', start, end, inclusive, line })

const ResultOk = (value, line) => ({ type: 'ResultOk', value, line })
const ResultErr = (value, line) => ({ type: 'ResultErr', value, line })
const TryExpr = (expr, line) => ({ type: 'TryExpr', expr, line })

const ThrowExpr = (argument, line) => ({ type: 'ThrowExpr', argument, line })

// ── Type Annotations ──────────────────────────────────────────────────────────

const TypeAnnotation = (name, args, nullable, line) => ({
  type: 'TypeAnnotation', name, args, nullable, line
  // args: for generics like Promise<User>
  // nullable: for User?
})

const UnionType = (members, line) => ({ type: 'UnionType', members, line })
const ArrayType = (elementType, line) => ({ type: 'ArrayType', elementType, line })
const ObjectType = (fields, line) => ({ type: 'ObjectType', fields, line })

// ── Function parameters ───────────────────────────────────────────────────────

const Param = (name, typeAnnotation, defaultValue, rest, line) => ({
  type: 'Param', name, typeAnnotation, defaultValue, rest, line
})

const DestructureParam = (pattern, defaultValue, line) => ({
  type: 'DestructureParam', pattern, defaultValue, line
})

module.exports = {
  Program,
  ImportDecl, ExportDecl,
  StateDecl, ComputedDecl, BuildDecl, LiveDecl, RealtimeDecl, ServerFn, WorkerFn,
  WidgetDecl, PageDecl,
  Element, TextNode, InterpolationNode,
  IfNode, UnlessNode, ForNode, MatchTemplateNode, RawNode,
  DesignBlock, StyleRule, StyleProp, StyleCondition,
  VarDecl, FnDecl, ClassDecl, ClassField, ClassMethod,
  BlockStatement, ReturnStatement,
  IfStatement, UnlessStatement, WhileStatement, UntilStatement,
  LoopStatement, ForStatement, BreakStatement, ContinueStatement,
  TryCatch, MatchStatement, ExprStatement,
  Identifier, AtProperty, Literal, TemplateLiteral,
  BinaryExpr, UnaryExpr, AssignExpr, LogicalExpr, PipelineExpr, IsExpr,
  CallExpr, MemberExpr, OptionalChain, NullCoalesce,
  ArrayLiteral, ObjectLiteral, ObjectProp, SpreadElement,
  ArrowFn, AwaitExpr, YieldExpr, TernaryExpr,
  MatchExpr, MatchArm, RangeExpr,
  ResultOk, ResultErr, TryExpr, ThrowExpr,
  TypeAnnotation, UnionType, ArrayType, ObjectType,
  Param, DestructureParam,
}
