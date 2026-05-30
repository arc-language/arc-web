'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const {
  _pluralize,
  _parseFieldsArg,
  generateAdminRoutes,
  generateListPage,
  generateFormPage,
  generateBlockWidget,
  generateBlockEditorPage,
  scaffold,
  scaffoldAll,
  scaffoldBlock,
  scaffoldBlockInit,
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

// ── _parseFieldsArg: invalid field name exits ─────────────────────────────────

test('_parseFieldsArg: invalid field name calls process.exit(1)', () => {
  let exitCode = null
  const origExit = process.exit
  const origErr = console.error
  process.exit = (c) => { exitCode = c; throw new Error('exit:' + c) }
  console.error = () => {}
  try {
    _parseFieldsArg('123bad')
    assert.fail('should have exited')
  } catch (e) {
    assert.ok(e.message.startsWith('exit:'), `unexpected error: ${e.message}`)
  } finally {
    process.exit = origExit
    console.error = origErr
  }
  assert.strictEqual(exitCode, 1)
})

test('_parseFieldsArg: field with colon type and no optional is parsed correctly', () => {
  const fields = _parseFieldsArg('email:Email')
  assert.strictEqual(fields.length, 1)
  assert.strictEqual(fields[0].name, 'email')
  assert.strictEqual(fields[0].type, 'Email')
  assert.strictEqual(fields[0].optional, false)
})

test('_parseFieldsArg: comma-separated fields are not supported — treated as single token', () => {
  // commas are part of token, so "title,body" is one invalid field name
  let exitCode = null
  const origExit = process.exit
  const origErr = console.error
  process.exit = (c) => { exitCode = c; throw new Error('exit:' + c) }
  console.error = () => {}
  try {
    _parseFieldsArg('title,body')
    assert.fail('should have exited')
  } catch (e) {
    assert.ok(e.message.startsWith('exit:'), `unexpected: ${e.message}`)
  } finally {
    process.exit = origExit
    console.error = origErr
  }
  assert.strictEqual(exitCode, 1)
})

// ── generateAdminRoutes: extra assertions ─────────────────────────────────────

test('generateAdminRoutes: has new/edit page references in routes', () => {
  const model = makeModel('Article', [{ name: 'title' }])
  const out = generateAdminRoutes(model)
  // Five routes: list, show, create, update, delete
  const routeMatches = (out.match(/@route/g) || []).length
  assert.strictEqual(routeMatches, 5, 'should have exactly 5 routes')
})

test('generateAdminRoutes: uses plural for db access', () => {
  const model = makeModel('Category', [{ name: 'name' }])
  const out = generateAdminRoutes(model)
  assert.ok(out.includes('db.categories.'), 'should use plural for db calls')
})

// ── generateListPage: detailed checks ────────────────────────────────────────

test('generateListPage: skips createdAt and updatedAt from column list', () => {
  const model = {
    name: 'Post',
    fields: [
      { name: 'id', decorators: ['@id'], typeAnnotation: { name: 'Int' } },
      { name: 'title', decorators: [], typeAnnotation: { name: 'String' } },
      { name: 'createdAt', decorators: [], typeAnnotation: { name: 'DateTime' } },
      { name: 'updatedAt', decorators: [], typeAnnotation: { name: 'DateTime' } },
    ]
  }
  const out = generateListPage(model)
  assert.ok(!out.includes('th "Created'), 'should not have createdAt column')
  assert.ok(!out.includes('th "Updated'), 'should not have updatedAt column')
})

test('generateListPage: limits to 4 fields in table', () => {
  const model = makeModel('Big', [
    { name: 'a' }, { name: 'b' }, { name: 'c' },
    { name: 'd' }, { name: 'e' }, { name: 'f' },
  ])
  const out = generateListPage(model)
  const thMatches = (out.match(/\bth "/g) || []).length
  // ID + up to 4 fields + empty action header = 6 max
  assert.ok(thMatches <= 6, `should cap columns, got ${thMatches}`)
})

// ── generateFormPage: input type variations ───────────────────────────────────

test('generateFormPage: Bool field renders checkbox', () => {
  const model = makeModel('Product', [{ name: 'active', type: 'Bool' }])
  const out = generateFormPage(model)
  assert.ok(out.includes('type="checkbox"'), 'should have checkbox for Bool field')
})

test('generateFormPage: Int field renders number input', () => {
  const model = makeModel('Product', [{ name: 'stock', type: 'Int' }])
  const out = generateFormPage(model)
  assert.ok(out.includes('type="number"'), 'should have number input for Int')
})

test('generateFormPage: Float field renders number input', () => {
  const model = makeModel('Item', [{ name: 'price', type: 'Float' }])
  const out = generateFormPage(model)
  assert.ok(out.includes('type="number"'), 'should have number input for Float')
})

test('generateFormPage: DateTime field renders datetime-local input', () => {
  const model = makeModel('Event', [{ name: 'startsAt', type: 'DateTime' }])
  const out = generateFormPage(model)
  assert.ok(out.includes('type="datetime-local"'), 'should have datetime-local input')
})

test('generateFormPage: Email field renders email input', () => {
  const model = makeModel('User', [{ name: 'email', type: 'Email' }])
  const out = generateFormPage(model)
  assert.ok(out.includes('type="email"'), 'should have email input')
})

test('generateFormPage: Text field renders textarea', () => {
  const model = makeModel('Post', [{ name: 'body', type: 'Text' }])
  const out = generateFormPage(model)
  assert.ok(out.includes('textarea'), 'should use textarea for Text type')
})

test('generateFormPage: skips reserved fields (passwordHash, oauthId, etc)', () => {
  const model = {
    name: 'User',
    fields: [
      { name: 'id', decorators: ['@id'], typeAnnotation: { name: 'Int' } },
      { name: 'email', decorators: [], typeAnnotation: { name: 'String' } },
      { name: 'passwordHash', decorators: [], typeAnnotation: { name: 'String' } },
      { name: 'oauthId', decorators: [], typeAnnotation: { name: 'String' } },
    ]
  }
  const out = generateFormPage(model)
  assert.ok(!out.includes('passwordHash'), 'should skip passwordHash')
  assert.ok(!out.includes('oauthId'), 'should skip oauthId')
  assert.ok(out.includes('email'), 'should include email field')
})

test('generateFormPage: optional fields render without required attribute', () => {
  const model = makeModel('Post', [{ name: 'subtitle', type: 'String', optional: true }])
  const out = generateFormPage(model)
  // Optional field should not have " required" on the input
  assert.ok(!out.includes('name="subtitle" required'), 'optional field should not be required')
})

// ── generateBlockWidget: detailed checks ─────────────────────────────────────

test('generateBlockWidget: Bool field renders if/col with checkmark', () => {
  const out = generateBlockWidget('promo', [{ name: 'active', type: 'Bool', optional: false }])
  assert.ok(out.includes('if active'), 'should have conditional for Bool')
  assert.ok(out.includes('✓'), 'should show checkmark for Bool true')
})

test('generateBlockWidget: Text field renders text element', () => {
  const out = generateBlockWidget('hero', [{ name: 'body', type: 'Text', optional: false }])
  assert.ok(out.includes('text class='), 'should use text element for Text type')
  assert.ok(out.includes('data-field="body"'), 'should have data-field attribute')
})

test('generateBlockWidget: String field renders heading element', () => {
  const out = generateBlockWidget('cta', [{ name: 'title', type: 'String', optional: false }])
  assert.ok(out.includes('heading class='), 'should use heading for String type')
  assert.ok(out.includes('data-field="title"'), 'should have data-field attribute')
})

test('generateBlockWidget: widget name is capitalized type + Block', () => {
  const out = generateBlockWidget('hero', [])
  assert.ok(out.includes('widget HeroBlock'), 'should have capitalized widget name')
})

test('generateBlockWidget: param list includes id and type', () => {
  const out = generateBlockWidget('banner', [])
  assert.ok(out.includes('id: Int'), 'should have id param')
  assert.ok(out.includes('type: String'), 'should have type param')
})

// ── generateBlockEditorPage: detailed checks ─────────────────────────────────

test('generateBlockEditorPage: Bool field renders checkbox', () => {
  const out = generateBlockEditorPage('promo', [{ name: 'active', type: 'Bool', optional: false }])
  assert.ok(out.includes('type="checkbox"'), 'should have checkbox for Bool type')
})

test('generateBlockEditorPage: Text field renders textarea', () => {
  const out = generateBlockEditorPage('hero', [{ name: 'body', type: 'Text', optional: false }])
  assert.ok(out.includes('textarea'), 'should use textarea for Text type')
})

test('generateBlockEditorPage: optional fields omit required attribute', () => {
  const out = generateBlockEditorPage('info', [{ name: 'subtitle', type: 'String', optional: true }])
  assert.ok(!out.includes('name="subtitle" required'), 'optional field should not be required')
})

test('generateBlockEditorPage: page title is capitalized label', () => {
  const out = generateBlockEditorPage('hero', [])
  assert.ok(out.includes('Hero Block'), 'page title should include capitalized type + Block')
})

test('generateBlockEditorPage: includes back link to /admin/blocks', () => {
  const out = generateBlockEditorPage('hero', [])
  assert.ok(out.includes('/admin/blocks'), 'should have back link to blocks admin')
})

// ── Temp project helpers ──────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arc-scaffold-test-'))
}

async function makeTmpProject(modelSrc) {
  const dir = makeTmpDir()
  const serverDir = path.join(dir, 'server', 'schemas')
  fs.mkdirSync(serverDir, { recursive: true })
  fs.writeFileSync(path.join(serverDir, 'models.arc'), modelSrc)
  return dir
}

// Canonical Arc model syntax requires `let` keyword for fields
const MODEL_POST = `
model Post
  @id let id = autoincrement()
  let title: String
  let body: String?
`

const MODEL_COMMENT = `
model Comment
  @id let id = autoincrement()
  let body: String
`

const MODEL_CATEGORY = `
model Category
  @id let id = autoincrement()
  let name: String
`

const MODEL_TAG = `
model Tag
  @id let id = autoincrement()
  let name: String
`

const MODEL_WIDGET = `
model Widget
  @id let id = autoincrement()
  let name: String
`

function withExitMocked(fn) {
  let exitCode = null
  const origExit = process.exit
  const origErr = console.error
  const origLog = console.log
  const origMax = process.getMaxListeners()
  process.setMaxListeners(50)
  process.exit = (c) => { exitCode = c; throw new Error('exit:' + c) }
  console.error = () => {}
  console.log = () => {}
  return fn()
    .then(() => ({ exitCode, threw: false }))
    .catch(e => {
      if (!e.message?.startsWith('exit:')) throw e
      return { exitCode, threw: true }
    })
    .finally(() => {
      process.exit = origExit
      console.error = origErr
      console.log = origLog
      process.setMaxListeners(origMax)
    })
}

// ── scaffold() ────────────────────────────────────────────────────────────────

test('scaffold: invalid model name exits with code 1', async () => {
  const { exitCode } = await withExitMocked(() => scaffold('123invalid', '.'))
  assert.strictEqual(exitCode, 1)
})

test('scaffold: model name starting with number exits', async () => {
  const { exitCode } = await withExitMocked(() => scaffold('9Post', '.'))
  assert.strictEqual(exitCode, 1)
})

test('scaffold: model not found in server dir exits with code 1', async () => {
  const dir = makeTmpDir()
  try {
    fs.mkdirSync(path.join(dir, 'server'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'server', 'empty.arc'), '')
    const { exitCode } = await withExitMocked(() => scaffold('NotFound', dir))
    assert.strictEqual(exitCode, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffold: creates routes, list, and form files', async () => {
  const dir = await makeTmpProject(MODEL_POST)
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffold('Post', dir)
    console.log = origLog
    assert.ok(fs.existsSync(path.join(dir, 'server', 'admin', 'routes', 'posts.arc')), 'routes file should exist')
    assert.ok(fs.existsSync(path.join(dir, 'admin', 'posts.arc')), 'list page should exist')
    assert.ok(fs.existsSync(path.join(dir, 'admin', 'post-form.arc')), 'form page should exist')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffold: routes file contains correct route definitions', async () => {
  const dir = await makeTmpProject(MODEL_POST)
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffold('Post', dir)
    console.log = origLog
    const routes = fs.readFileSync(path.join(dir, 'server', 'admin', 'routes', 'posts.arc'), 'utf8')
    assert.ok(routes.includes('get "/admin/posts"'), 'should have list route')
    assert.ok(routes.includes('post "/admin/posts"'), 'should have create route')
    assert.ok(routes.includes('del "/admin/posts/:id"'), 'should have delete route')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffold: existing files exit without --force', async () => {
  const dir = await makeTmpProject(MODEL_POST)
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffold('Post', dir)
    console.log = origLog

    const { exitCode } = await withExitMocked(() => scaffold('Post', dir))
    assert.strictEqual(exitCode, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffold: --force overwrites existing files', async () => {
  const dir = await makeTmpProject(MODEL_POST)
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffold('Post', dir)
    await scaffold('Post', dir, { force: true })
    console.log = origLog
    assert.ok(fs.existsSync(path.join(dir, 'admin', 'posts.arc')), 'list page should still exist')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffold: model search falls back to absDir when no server/ subdir', async () => {
  const dir = makeTmpDir()
  try {
    fs.writeFileSync(path.join(dir, 'flat.arc'), MODEL_WIDGET)
    const origLog = console.log
    console.log = () => {}
    await scaffold('Widget', dir)
    console.log = origLog
    // Without server/, routes go in server/admin/routes relative to absDir
    assert.ok(fs.existsSync(path.join(dir, 'server', 'admin', 'routes', 'widgets.arc')), 'routes file should be created')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffold: pluralizes model name correctly in file paths (Category → categories)', async () => {
  const dir = await makeTmpProject(MODEL_CATEGORY)
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffold('Category', dir)
    console.log = origLog
    assert.ok(fs.existsSync(path.join(dir, 'admin', 'categories.arc')), 'plural path should exist')
    assert.ok(fs.existsSync(path.join(dir, 'server', 'admin', 'routes', 'categories.arc')), 'plural routes should exist')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── scaffoldAll() ─────────────────────────────────────────────────────────────

test('scaffoldAll: exits when no models found', async () => {
  const dir = makeTmpDir()
  try {
    fs.mkdirSync(path.join(dir, 'server'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'server', 'empty.arc'), '# no models here\n')
    const { exitCode } = await withExitMocked(() => scaffoldAll(dir))
    assert.strictEqual(exitCode, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldAll: scaffolds all models in server/', async () => {
  const dir = makeTmpDir()
  try {
    fs.mkdirSync(path.join(dir, 'server', 'schemas'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'server', 'schemas', 'models.arc'), MODEL_POST + MODEL_COMMENT)
    const origLog = console.log
    console.log = () => {}
    await scaffoldAll(dir)
    console.log = origLog
    assert.ok(fs.existsSync(path.join(dir, 'admin', 'posts.arc')), 'post list page should exist')
    assert.ok(fs.existsSync(path.join(dir, 'admin', 'comments.arc')), 'comment list page should exist')
    assert.ok(fs.existsSync(path.join(dir, 'server', 'admin', 'routes', 'posts.arc')), 'post routes should exist')
    assert.ok(fs.existsSync(path.join(dir, 'server', 'admin', 'routes', 'comments.arc')), 'comment routes should exist')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldAll: passes --force option to each scaffold call', async () => {
  const dir = makeTmpDir()
  try {
    fs.mkdirSync(path.join(dir, 'server', 'schemas'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'server', 'schemas', 'models.arc'), MODEL_TAG)
    const origLog = console.log
    console.log = () => {}
    await scaffoldAll(dir)
    // Second run with force should not exit
    await scaffoldAll(dir, { force: true })
    console.log = origLog
    assert.ok(fs.existsSync(path.join(dir, 'admin', 'tags.arc')), 'tag list page should exist')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── scaffoldBlockInit() ───────────────────────────────────────────────────────

test('scaffoldBlockInit: creates schema, routes, and admin page files', async () => {
  const dir = makeTmpDir()
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffoldBlockInit(dir)
    console.log = origLog
    assert.ok(fs.existsSync(path.join(dir, 'server', 'schemas', 'pageblock.arc')), 'pageblock schema should exist')
    assert.ok(fs.existsSync(path.join(dir, 'server', 'admin', 'routes', 'blocks.arc')), 'block routes should exist')
    assert.ok(fs.existsSync(path.join(dir, 'server', 'block-types.json')), 'block-types.json should exist')
    assert.ok(fs.existsSync(path.join(dir, 'admin', 'blocks.arc')), 'blocks admin page should exist')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlockInit: creates public/arc-draft.js directory', async () => {
  const dir = makeTmpDir()
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffoldBlockInit(dir)
    console.log = origLog
    assert.ok(fs.existsSync(path.join(dir, 'public')), 'public/ dir should exist')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlockInit: block-types.json starts as empty object', async () => {
  const dir = makeTmpDir()
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffoldBlockInit(dir)
    console.log = origLog
    const typesJson = fs.readFileSync(path.join(dir, 'server', 'block-types.json'), 'utf8')
    assert.deepStrictEqual(JSON.parse(typesJson), {})
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlockInit: admin blocks.arc references Blocks and block routes', async () => {
  const dir = makeTmpDir()
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffoldBlockInit(dir)
    console.log = origLog
    const blocksPage = fs.readFileSync(path.join(dir, 'admin', 'blocks.arc'), 'utf8')
    assert.ok(blocksPage.includes('Blocks'), 'blocks page should reference Blocks')
    assert.ok(blocksPage.includes('/admin/blocks'), 'blocks page should reference admin blocks route')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlockInit: exits if files already exist', async () => {
  const dir = makeTmpDir()
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffoldBlockInit(dir)
    console.log = origLog
    const { exitCode } = await withExitMocked(() => scaffoldBlockInit(dir))
    assert.strictEqual(exitCode, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlockInit: pageblock.arc schema contains required fields', async () => {
  const dir = makeTmpDir()
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffoldBlockInit(dir)
    console.log = origLog
    const schema = fs.readFileSync(path.join(dir, 'server', 'schemas', 'pageblock.arc'), 'utf8')
    assert.ok(schema.includes('model PageBlock'), 'should define PageBlock model')
    assert.ok(schema.includes('model DraftToken'), 'should define DraftToken model')
    assert.ok(schema.includes('type         : String'), 'should have type field')
    assert.ok(schema.includes('page         : String'), 'should have page field')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── scaffoldBlock() ───────────────────────────────────────────────────────────

function makeBlockProject() {
  const dir = makeTmpDir()
  fs.mkdirSync(path.join(dir, 'server'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'server', 'block-types.json'), '{}')
  return dir
}

test('scaffoldBlock: exits if block-types.json not found', async () => {
  const dir = makeTmpDir()
  try {
    const { exitCode } = await withExitMocked(() => scaffoldBlock('hero', dir, {}))
    assert.strictEqual(exitCode, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlock: uppercase type names are auto-lowercased and succeed', async () => {
  // typeKey = type.toLowerCase(), so 'Hero' becomes 'hero' — valid
  const dir = makeBlockProject()
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffoldBlock('Hero', dir, {})
    console.log = origLog
    const registry = JSON.parse(fs.readFileSync(path.join(dir, 'server', 'block-types.json'), 'utf8'))
    assert.ok('hero' in registry, 'should register as lowercase key')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlock: exits for invalid block type name (starts with number)', async () => {
  const dir = makeBlockProject()
  try {
    const { exitCode } = await withExitMocked(() => scaffoldBlock('1block', dir, {}))
    assert.strictEqual(exitCode, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlock: creates editor and widget files', async () => {
  const dir = makeBlockProject()
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffoldBlock('hero', dir, { fields: 'title:String body:Text' })
    console.log = origLog
    assert.ok(fs.existsSync(path.join(dir, 'admin', 'blocks', 'hero.arc')), 'editor file should exist')
    assert.ok(fs.existsSync(path.join(dir, 'site', 'blocks', 'hero.arc')), 'widget file should exist')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlock: updates block-types.json with new type', async () => {
  const dir = makeBlockProject()
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffoldBlock('cta', dir, { fields: 'heading:String' })
    console.log = origLog
    const registry = JSON.parse(fs.readFileSync(path.join(dir, 'server', 'block-types.json'), 'utf8'))
    assert.ok('cta' in registry, 'registry should have cta type')
    assert.ok(registry.cta.label, 'cta entry should have a label')
    assert.ok(Array.isArray(registry.cta.fields), 'cta entry should have fields array')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlock: exits when block type already exists without --force', async () => {
  const dir = makeBlockProject()
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffoldBlock('hero', dir, {})
    console.log = origLog
    const { exitCode } = await withExitMocked(() => scaffoldBlock('hero', dir, {}))
    assert.strictEqual(exitCode, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlock: --force overwrites existing block type', async () => {
  const dir = makeBlockProject()
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffoldBlock('hero', dir, { fields: 'title:String' })
    await scaffoldBlock('hero', dir, { force: true, fields: 'heading:String subtext:Text' })
    console.log = origLog
    const registry = JSON.parse(fs.readFileSync(path.join(dir, 'server', 'block-types.json'), 'utf8'))
    assert.strictEqual(registry.hero.fields.length, 2, 'should have 2 fields after overwrite')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlock: editor page contains block type and form', async () => {
  const dir = makeBlockProject()
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffoldBlock('promo', dir, { fields: 'title:String' })
    console.log = origLog
    const editorSrc = fs.readFileSync(path.join(dir, 'admin', 'blocks', 'promo.arc'), 'utf8')
    assert.ok(editorSrc.includes('promo') || editorSrc.includes('Promo'), 'editor page should reference block type')
    assert.ok(editorSrc.includes('title'), 'editor page should include title field')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlock: widget file contains widget declaration', async () => {
  const dir = makeBlockProject()
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffoldBlock('banner', dir, { fields: 'headline:String' })
    console.log = origLog
    const widgetSrc = fs.readFileSync(path.join(dir, 'site', 'blocks', 'banner.arc'), 'utf8')
    assert.ok(widgetSrc.includes('widget'), 'widget file should start with widget declaration')
    assert.ok(widgetSrc.includes('BannerBlock'), 'widget name should be BannerBlock')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlock: uses default fields when no --fields option given', async () => {
  const dir = makeBlockProject()
  try {
    const origLog = console.log
    console.log = () => {}
    await scaffoldBlock('info', dir, {})
    console.log = origLog
    const registry = JSON.parse(fs.readFileSync(path.join(dir, 'server', 'block-types.json'), 'utf8'))
    // Default fields are title + body
    assert.ok(registry.info.fields.some(f => f.name === 'title'), 'should default to title field')
    assert.ok(registry.info.fields.some(f => f.name === 'body'), 'should default to body field')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffoldBlock: exits gracefully if block-types.json is invalid JSON', async () => {
  const dir = makeTmpDir()
  try {
    fs.mkdirSync(path.join(dir, 'server'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'server', 'block-types.json'), 'NOT VALID JSON{{{')
    const { exitCode } = await withExitMocked(() => scaffoldBlock('hero', dir, {}))
    assert.strictEqual(exitCode, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
