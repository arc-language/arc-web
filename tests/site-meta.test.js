'use strict'
const { describe, test } = require('node:test')
const assert = require('node:assert')
const { emit } = require('../src/emitters/site-meta')

describe('site-meta emitter', () => {
  test('returns nulls when no page has a canonical', () => {
    const r = emit([
      { slug: 'page-01', meta: {} },
      { slug: 'page-02', meta: { title: 'X' } },
    ])
    assert.equal(r.sitemap, null)
    assert.equal(r.robots, null)
    assert.equal(r.baseUrl, null)
  })

  test('emits sitemap.xml with one <url> per page with canonical', () => {
    const r = emit([
      { slug: 'page-01', meta: { canonical: 'https://example.com/a' } },
      { slug: 'page-02', meta: { canonical: 'https://example.com/b' } },
      { slug: 'page-03', meta: {} },  // skipped — no canonical
    ])
    assert.ok(r.sitemap)
    const urlCount = (r.sitemap.match(/<url>/g) || []).length
    assert.equal(urlCount, 2)
    assert.ok(r.sitemap.includes('https://example.com/a'))
    assert.ok(r.sitemap.includes('https://example.com/b'))
  })

  test('derives baseUrl from most-common origin', () => {
    const r = emit([
      { slug: 'a', meta: { canonical: 'https://main.example.com/a' } },
      { slug: 'b', meta: { canonical: 'https://main.example.com/b' } },
      { slug: 'c', meta: { canonical: 'https://other.example.com/c' } },
    ])
    assert.equal(r.baseUrl, 'https://main.example.com')
    assert.ok(r.robots.includes('Sitemap: https://main.example.com/sitemap.xml'))
  })

  test('uses meta.modified for lastmod when present', () => {
    const r = emit([
      { slug: 'a', meta: { canonical: 'https://x.com/a', modified: '2024-01-15' } },
    ])
    assert.ok(r.sitemap.includes('<lastmod>2024-01-15</lastmod>'))
  })

  test('uses meta.priority and meta.changefreq when present', () => {
    const r = emit([
      { slug: 'a', meta: { canonical: 'https://x.com/a', priority: 1.0, changefreq: 'daily' } },
    ])
    assert.ok(r.sitemap.includes('<priority>1.0</priority>'))
    assert.ok(r.sitemap.includes('<changefreq>daily</changefreq>'))
  })

  test('escapes XML-special characters in URLs', () => {
    const r = emit([
      { slug: 'a', meta: { canonical: 'https://x.com/a?q=1&v=2' } },
    ])
    assert.ok(r.sitemap.includes('q=1&amp;v=2'))
    assert.ok(!r.sitemap.includes('q=1&v=2'))
  })

  test('robots.txt with no baseUrl still emits a valid file', () => {
    const r = emit([
      { slug: 'a', meta: { canonical: 'not-a-valid-url' } },
    ])
    assert.equal(r.baseUrl, null)
    // sitemap still emits — just no robots Sitemap line
    assert.ok(r.robots.startsWith('User-agent: *'))
  })
})
