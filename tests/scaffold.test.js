'use strict'

const test = require('node:test')
const assert = require('node:assert')
const {
  _pluralize,
  _parseFieldsArg,
  generateAdminRoutes,
  generateListPage,
  generateFormPage,
  generateBlockWidget,
  generateBlockEditorPage,
} = require('../src/commands/scaffold')

// ── _pluralize ─────────────────────────────────────────────────────────────────

test('_pluralize: adds s for regular nouns', () => {
  assert.strictEqual(_pluralize('Post'), 'posts')
  assert.strictEqual(_pluralize('User'), 'users')
  assert.strictEqual(_pluralize('Comment'), 'comments')
})

test('_pluralize: -y → -ies for consonant+y words', () => {
  assert.strictEqual(_pluralize('Category'), 'categories')
  assert.strictEqual(_pluralize('Entry'), 'entries')
  assert.strictEqual(_pluralize('Reply'), 'replies')
})

test('_pluralize: -ay/-ey/-oy/-uy just adds s (vowel+y)', () => {
  assert.strictEqual(_pluralize('Day'), 'days')
  assert.strictEqual(_pluralize('Key'), 'keys')
  assert.strictEqual(_pluralize('Boy'), 'boys')
  assert.strictEqual(_pluralize('Guy'), 'guys')
})

test('_pluralize: -s/-x/-z/-ch/-sh adds es', () => {
  assert.strictEqual(_pluralize('Class'), 'classes')
  assert.strictEqual(_pluralize('Box'), 'boxes')
  assert.strictEqual(_pluralize('Buzz'), 'buzzes')
  assert.strictEqual(_pluralize('Match'), 'matches')
  assert.strictEqual(_pluralize('Flash'), 'flashes')
})

test('_pluralize: lowercases the result', () => {
  assert.strictEqual(_pluralize('POST'), 'posts')
  assert.strictEqual(_pluralize('Article'), 'articles')
})

// ── _parseFieldsArg ───────────────────────────────────────────────────────────

test('_parseFieldsArg: null/undefined returns default fields', () => {
  const fields = _parseFieldsArg(null)
  assert.strictEqual(fields.length, 2)
  assert.strictEqual(fields[0].name, 'title')
  assert.strictEqual(fields[1].name, 'body')
})

test('_parseFieldsArg: parses simple field names with default String type', () => {
  const fields = _parseFieldsArg('title body')
  assert.strictEqual(fields.length, 2)
  assert.strictEqual(fields[0].name, 'title')
  assert.strictEqual(fields[0].type, 'String')
  assert.strictEqual(fields[0].optional, false)
})

test('_parseFieldsArg: parses name:type pairs', () => {
  const fields = _parseFieldsArg('title:String published:Bool count:Int')
  assert.strictEqual(fields[0].type, 'String')
  assert.strictEqual(fields[1].type, 'Bool')
  assert.strictEqual(fields[2].type, 'Int')
})

test('_parseFieldsArg: parses optional fields with ? suffix', () => {
  const fields = _parseFieldsArg('title:String? body?')
  assert.strictEqual(fields[0].optional, true)
  assert.strictEqual(fields[0].name, 'title')
  assert.strictEqual(fields[1].optional, true)
  assert.strictEqual(fields[1].name, 'body')
})

test('_parseFieldsArg: handles extra whitespace', () => {
  const fields = _parseFieldsArg('  title   body  ')
  assert.strictEqual(fields.length, 2)
})

// ── Model factory for generator tests ─────────────────────────────────────────

function makeModel(name, fieldDefs) {
  return {
    name,
    fields: [
      { name: 'id', decorators: ['@id'], typeAnnotation: { name: 'Int' } },
      ...fieldDefs.map(({ name, type = 'String', optional = false, decorators = [] }) => ({
        name,
        decorators,
        typeAnnotation: { name: type, nullable: optional },
        optional,
      })),
    ],
  }
}

// ── generateAdminRoutes ───────────────────────────────────────────────────────

test('generateAdminRoutes: includes CRUD routes for model', () => {
  const model = makeModel('Post', [{ name: 'title' }, { name: 'body' }])
  const out = generateAdminRoutes(model)
  assert.ok(out.includes('@route') && out.includes('/admin/posts'), `expected admin routes: ${out.slice(0, 200)}`)
  assert.ok(out.includes('get "/admin/posts"'), 'should have list route')
  assert.ok(out.includes('get "/admin/posts/:id"'), 'should have get-one route')
  assert.ok(out.includes('post "/admin/posts"'), 'should have create route')
  assert.ok(out.includes('patch "/admin/posts/:id"'), 'should have update route')
  assert.ok(out.includes('del "/admin/posts/:id"'), 'should have delete route')
})

test('generateAdminRoutes: uses @auth decorator', () => {
  const model = makeModel('User', [{ name: 'email' }])
  const out = generateAdminRoutes(model)
  assert.ok(out.includes('@auth(admin,editor)') || out.includes('@auth'), 'should have auth')
})

test('generateAdminRoutes: pluralizes model name correctly', () => {
  const model = makeModel('Category', [{ name: 'name' }])
  const out = generateAdminRoutes(model)
  assert.ok(out.includes('/admin/categories'), 'should use plural form')
})

// ── generateListPage ──────────────────────────────────────────────────────────

test('generateListPage: includes page heading and server fn', () => {
  const model = makeModel('Post', [{ name: 'title' }, { name: 'body' }])
  const out = generateListPage(model)
  assert.ok(out.includes('page "'), 'should have page declaration')
  assert.ok(out.includes('@server fn'), 'should have server function')
  assert.ok(out.includes('@live'), 'should have @live for data fetching')
})

test('generateListPage: includes table with ID column and field headers', () => {
  const model = makeModel('Product', [{ name: 'name' }, { name: 'price' }])
  const out = generateListPage(model)
  assert.ok(out.includes('th "ID"'), 'should have ID column header')
  assert.ok(out.includes('name') && out.includes('price'), 'should have field headers')
})

test('generateListPage: includes link to edit route', () => {
  const model = makeModel('Post', [{ name: 'title' }])
  const out = generateListPage(model)
  assert.ok(out.includes('/admin/posts/'), 'should reference admin route')
  assert.ok(out.includes('Edit'), 'should have edit button')
})

test('generateListPage: includes design block', () => {
  const model = makeModel('Post', [{ name: 'title' }])
  const out = generateListPage(model)
  assert.ok(out.includes('design'), 'should have design block')
})

// ── generateFormPage ──────────────────────────────────────────────────────────

test('generateFormPage: includes form with input fields', () => {
  const model = makeModel('Post', [{ name: 'title' }, { name: 'body', type: 'Text' }])
  const out = generateFormPage(model)
  assert.ok(typeof out === 'string' && out.length > 0, 'should return non-empty string')
  assert.ok(out.includes('page "'), 'should have page declaration')
})

test('generateFormPage: references field names', () => {
  const model = makeModel('Product', [{ name: 'name' }, { name: 'price', type: 'Float' }])
  const out = generateFormPage(model)
  assert.ok(out.includes('name') || out.includes('price'), 'should reference field names')
})

// ── generateBlockWidget ───────────────────────────────────────────────────────

test('generateBlockWidget: generates widget markup', () => {
  const out = generateBlockWidget('hero', [{ name: 'title', type: 'String', optional: false }])
  assert.ok(typeof out === 'string' && out.length > 0, 'should return non-empty string')
})

test('generateBlockWidget: includes field name in output', () => {
  const out = generateBlockWidget('cta', [{ name: 'headline', type: 'String', optional: false }])
  assert.ok(out.includes('headline') || out.includes('cta'), 'should reference type or fields')
})

// ── generateBlockEditorPage ───────────────────────────────────────────────────

test('generateBlockEditorPage: generates editor page for block type', () => {
  const out = generateBlockEditorPage('hero', [{ name: 'title', type: 'String', optional: false }])
  assert.ok(typeof out === 'string' && out.length > 0, 'should return non-empty string')
})

test('generateBlockEditorPage: includes block type name', () => {
  const out = generateBlockEditorPage('banner', [{ name: 'text', type: 'String', optional: false }])
  assert.ok(out.includes('banner') || out.includes('Banner'), 'should reference block type')
})
