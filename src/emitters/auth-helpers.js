'use strict'

// Auth helpers emitted into generated server.js.
// Uses only Web Crypto API (built into Bun and modern Node) — zero external deps.
//
// Session: signed cookie (HMAC-SHA256). No server-side storage needed.
// JWT: HS256 via Web Crypto.
// OAuth: GitHub and Google (configurable via env vars).

function emitAuthPreamble(opts = {}) {
  const sessionMaxAge = opts.sessionMaxAge ?? 7 * 24 * 60 * 60 // 7 days
  const cookieName = opts.cookieName ?? 'arc_session'

  return `
// ── Auth helpers ──────────────────────────────────────────────────────────────

const _AUTH_SECRET = process.env.SESSION_SECRET ?? 'change-me-in-production'
if (_AUTH_SECRET === 'change-me-in-production') {
  if (process.env.NODE_ENV === 'production') throw new Error('[arc:auth] SESSION_SECRET must be set in production — set SESSION_SECRET env var')
  console.warn('[arc:auth] WARNING: SESSION_SECRET is not set. Set SESSION_SECRET env var before deploying to production.')
}
const _SESSION_COOKIE = '${cookieName}'
const _SESSION_MAX_AGE = ${sessionMaxAge}

// HMAC-SHA256 sign/verify (Web Crypto — built into Bun + Node 18+)
// Cached key — import once per secret value to avoid per-request overhead
let _hmacKeyCache = null
let _hmacKeyCacheSecret = null
async function _getHmacKey(secret, usage) {
  if (_hmacKeyCache && _hmacKeyCacheSecret === secret) return _hmacKeyCache
  const enc = new TextEncoder()
  _hmacKeyCache = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  _hmacKeyCacheSecret = secret
  return _hmacKeyCache
}

async function _hmacSign(data, secret) {
  const enc = new TextEncoder()
  const key = await _getHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '')
}

async function _hmacVerify(data, sig, secret) {
  const enc = new TextEncoder()
  const key = await _getHmacKey(secret)
  const padded = sig.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - sig.length % 4) % 4)
  const sigBytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0))
  try { return await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data)) } catch { return false }
}

// Session: encode/decode signed cookie value
async function _sessionEncode(payload) {
  const json = JSON.stringify(payload)
  const b64 = btoa(encodeURIComponent(json))
  const sig = await _hmacSign(b64, _AUTH_SECRET)
  return \`\${b64}.\${sig}\`
}

async function _sessionDecode(cookieValue) {
  if (!cookieValue) return null
  const dot = cookieValue.lastIndexOf('.')
  if (dot === -1) return null
  const b64 = cookieValue.slice(0, dot)
  const sig = cookieValue.slice(dot + 1)
  if (!await _hmacVerify(b64, sig, _AUTH_SECRET)) return null
  try {
    return JSON.parse(decodeURIComponent(atob(b64)))
  } catch { return null }
}

// Parse cookies from a request
function _parseCookies(req) {
  const header = req.headers.get('cookie') ?? ''
  const cookies = {}
  for (const part of header.split(';')) {
    const [k, ...vs] = part.trim().split('=')
    if (k) cookies[k.trim()] = decodeURIComponent(vs.join('='))
  }
  return cookies
}

// auth object injected into every route handler
const auth = {
  // Read session from request → returns session payload or null
  session: async (req) => {
    const cookies = _parseCookies(req)
    return _sessionDecode(cookies[_SESSION_COOKIE])
  },

  // Set session cookie on a Response (mutates headers)
  set: async (res, payload) => {
    const value = await _sessionEncode(payload)
    const cookie = \`\${_SESSION_COOKIE}=\${value}; HttpOnly; SameSite=Lax; Max-Age=\${_SESSION_MAX_AGE}; Path=/\${process.env.NODE_ENV === 'production' ? '; Secure' : ''}\`
    return new Response(res.body, {
      status: res.status,
      headers: { ...Object.fromEntries(res.headers), 'Set-Cookie': cookie }
    })
  },

  // Clear session cookie on a Response
  clear: (res) => {
    const cookie = \`\${_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/\${process.env.NODE_ENV === 'production' ? '; Secure' : ''}\`
    return new Response(res.body, {
      status: res.status,
      headers: { ...Object.fromEntries(res.headers), 'Set-Cookie': cookie }
    })
  },

  // Require auth: return 401 if no session, else return session payload
  require: async (req) => {
    const sess = await auth.session(req)
    if (!sess) throw Object.assign(new Error('Unauthorized'), { _authError: true })
    return sess
  },
}

// JWT (HS256 via Web Crypto)
const jwt = {
  sign: async (payload, secret = _AUTH_SECRET, expiresIn = 3600) => {
    const header = { alg: 'HS256', typ: 'JWT' }
    const now = Math.floor(Date.now() / 1000)
    const claims = { ...payload, iat: now, exp: now + expiresIn }
    const enc = new TextEncoder()
    const b64url = (obj) => { const s = encodeURIComponent(JSON.stringify(obj)).replace(/%([0-9A-F]{2})/g, (_, p) => String.fromCharCode(parseInt(p, 16))); return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '') }
    const unsigned = \`\${b64url(header)}.\${b64url(claims)}\`
    const sig = await _hmacSign(unsigned, secret)
    return \`\${unsigned}.\${sig}\`
  },

  verify: async (token, secret = _AUTH_SECRET) => {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [headerB64, payloadB64, sig] = parts
    if (!await _hmacVerify(\`\${headerB64}.\${payloadB64}\`, sig, secret)) return null
    try {
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
      return payload
    } catch { return null }
  },
}

// OAuth helpers (GitHub)
const oauth = {
  github: {
    // Returns { url, state } — store state in session and verify in callback
    url: (scopes = ['user:email']) => {
      const clientId = process.env.GITHUB_CLIENT_ID ?? ''
      const state = crypto.randomUUID()
      const params = new URLSearchParams({ client_id: clientId, scope: scopes.join(' '), state })
      return { url: \`https://github.com/login/oauth/authorize?\${params}\`, state }
    },
    callback: async (req, expectedState) => {
      const url = new URL(req.url)
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code) return { ok: false, error: 'no_code' }
      if (!state || !expectedState || state !== expectedState) return { ok: false, error: 'auth_failed' }
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
        signal: AbortSignal.timeout(10000),
      })
      const { access_token, error } = await tokenRes.json()
      if (error || !access_token) return { ok: false, error: 'auth_failed' }
      const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: \`Bearer \${access_token}\`, 'User-Agent': 'arc-server' },
        signal: AbortSignal.timeout(10000),
      })
      if (!userRes.ok) return { ok: false, error: 'auth_failed' }
      const user = await userRes.json()
      return { ok: true, user, accessToken: access_token }
    },
  },

  google: {
    // Returns { url, state } — store state in session and verify in callback
    url: (scopes = ['email', 'profile']) => {
      const clientId = process.env.GOOGLE_CLIENT_ID ?? ''
      const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? ''
      const state = crypto.randomUUID()
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        state,
      })
      return { url: \`https://accounts.google.com/o/oauth2/v2/auth?\${params}\`, state }
    },
    callback: async (req, expectedState) => {
      const url = new URL(req.url)
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code) return { ok: false, error: 'no_code' }
      if (!state || !expectedState || state !== expectedState) return { ok: false, error: 'auth_failed' }
      const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? ''
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code,
        }),
        signal: AbortSignal.timeout(10000),
      })
      const { access_token, id_token, error } = await tokenRes.json()
      if (error || !access_token) return { ok: false, error: 'auth_failed' }
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: \`Bearer \${access_token}\` },
        signal: AbortSignal.timeout(10000),
      })
      if (!userRes.ok) return { ok: false, error: 'auth_failed' }
      const user = await userRes.json()
      return { ok: true, user, accessToken: access_token, idToken: id_token }
    },
  },
}
`.trim()
}

module.exports = { emitAuthPreamble }
