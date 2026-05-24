'use strict'

// Emits a `_headers` file compatible with both Cloudflare Pages and Netlify.
// Centralizes security headers + sets immutable Cache-Control for content-hashed
// assets + emits Link: preload for the shared CSS so CDNs can send 103 Early Hints.

const DEFAULT_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'"

function emit({ sharedCssFilename = null, csp = DEFAULT_CSP } = {}) {
  const blocks = []

  // Site-wide security headers
  blocks.push(`/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()`)

  // Content-hashed assets: cache forever
  if (sharedCssFilename) {
    // shared.<sha>.css is content-hashed; safe to mark immutable
    blocks.push(`/shared.*.css
  Cache-Control: public, max-age=31536000, immutable`)
  }

  // Image variants are content-hashed: <stem>.<sha8>.<width>w.<ext>
  blocks.push(`/*.avif
  Cache-Control: public, max-age=31536000, immutable

/*.webp
  Cache-Control: public, max-age=31536000, immutable

/*.jpg
  Cache-Control: public, max-age=31536000, immutable

/*.png
  Cache-Control: public, max-age=31536000, immutable`)

  // HTML must revalidate; preload the shared CSS via Link header so the CDN
  // can convert it to a 103 Early Hint response.
  const linkPreload = sharedCssFilename
    ? `\n  Link: </${sharedCssFilename}>; rel=preload; as=style`
    : ''
  blocks.push(`/*.html
  Cache-Control: public, max-age=0, must-revalidate${linkPreload}`)

  return blocks.join('\n\n') + '\n'
}

module.exports = { emit }
