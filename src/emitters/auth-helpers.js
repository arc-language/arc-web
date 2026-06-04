'use strict'

// Auth helpers emitted into generated server.js.
// Uses only Web Crypto API (built into Bun and modern Node) - zero external deps.
//
// Session: signed cookie (HMAC-SHA256). No server-side storage needed.
// JWT: HS256 via Web Crypto.
// OAuth: GitHub and Google (configurable via env vars).

function emitAuthPreamble(opts = {}) {
  const sessionMaxAge = opts.sessionMaxAge ?? 7 * 24 * 60 * 60 // 7 days
  const cookieName = opts.cookieName ?? 'arc_session'

  return `
// ── Auth helpers ──────────────────────────────────────────────────────────────

let _AUTH_SECRET = process.env.SESSION_SECRET
if (!_AUTH_SECRET) {
  if (process.env.NODE_ENV === 'production') throw new Error('[arc:auth] SESSION_SECRET must be set in production — set SESSION_SECRET env var')
  // In dev: persist a stable secret to .arc-dev-secret so sessions survive hot-reloads.
  // A random secret on every restart would invalidate all signed cookies.
  // __dirname anchors to the emitted file's directory (CJS; import.meta is not available in CJS).
  const _devSecretPath = require('path').join(typeof __dirname !== 'undefined' ? __dirname : process.cwd(), '.arc-dev-secret')
  try {
    const _stored = require('fs').readFileSync(_devSecretPath, 'utf8').trim()
    if (!_stored) throw new Error('empty')
    _AUTH_SECRET = _stored
  } catch {
    _AUTH_SECRET = crypto.randomUUID() + crypto.randomUUID()
    try { require('fs').writeFileSync(_devSecretPath, _AUTH_SECRET, { mode: 0o600 }) } catch {}
  }
  console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', msg: '[arc:auth] SESSION_SECRET is not set — sessions will not persist across restarts. Set SESSION_SECRET env var before deploying to production.' }))
}
// __Host- prefix in production: prevents subdomain session fixation (RFC 6265bis).
// Requires Secure + Path=/ + no Domain= - all satisfied below. Plain name in dev (no HTTPS).
const _PROD_COOKIE = process.env.NODE_ENV === 'production'
const _SESSION_COOKIE = _PROD_COOKIE ? '__Host-${cookieName}' : '${cookieName}'
const _SESSION_MAX_AGE = ${sessionMaxAge}

// HMAC-SHA256 sign/verify (Web Crypto - built into Bun + Node 18+)
// Keyed by secret string so jwt.sign/verify with custom secrets work correctly
const _hmacKeyCache = new Map()
function _getHmacKey(secret) {
  if (_hmacKeyCache.has(secret)) return _hmacKeyCache.get(secret)
  // Cache the Promise, not the resolved key - concurrent calls with the same secret
  // await the same derivation instead of each starting their own crypto.subtle.importKey.
  // Evict the oldest entry (FIFO - Map preserves insertion order) so active keys stay warm.
  if (_hmacKeyCache.size >= 64) _hmacKeyCache.delete(_hmacKeyCache.keys().next().value)
  const enc = new TextEncoder()
  const p = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  _hmacKeyCache.set(secret, p)
  return p
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
  try {
    return await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data))
  } catch (_e) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'hmac_verify_failed', msg: _e?.message ?? String(_e) }))
    return false
  }
}

// Session: encode/decode signed cookie value
async function _sessionEncode(payload) {
  const json = JSON.stringify(payload)
  const b64 = Buffer.from(json).toString('base64')
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
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  } catch { return null }
}

// Parse cookies from a request
function _parseCookies(req) {
  const header = req.headers.get('cookie') ?? ''
  const cookies = {}
  for (const part of header.split(';')) {
    const [k, ...vs] = part.trim().split('=')
    if (k) { try { cookies[k.trim()] = decodeURIComponent(vs.join('=')) } catch { cookies[k.trim()] = vs.join('=') } }
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

  // Set session cookie on a Response (preserves all existing headers including duplicate Set-Cookie)
  set: async (res, payload) => {
    const value = await _sessionEncode(payload)
    const cookie = \`\${_SESSION_COOKIE}=\${value}; HttpOnly; SameSite=Strict; Max-Age=\${_SESSION_MAX_AGE}; Path=/\${_PROD_COOKIE ? '; Secure' : ''}\`
    const h = new Headers(res.headers)
    h.append('Set-Cookie', cookie)
    return new Response(res.body, { status: res.status, headers: h })
  },

  // Clear session cookie on a Response
  clear: (res) => {
    const cookie = \`\${_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/\${_PROD_COOKIE ? '; Secure' : ''}\`
    const h = new Headers(res.headers)
    h.append('Set-Cookie', cookie)
    return new Response(res.body, { status: res.status, headers: h })
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
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('[arc:jwt] expiresIn must be a positive finite number (seconds)')
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
    // Reject tokens that don't declare HS256 - prevents alg:none attacks and cross-algorithm confusion
    try {
      const hdr = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')))
      if (hdr.alg !== 'HS256') return null
    } catch { return null }
    if (!await _hmacVerify(\`\${headerB64}.\${payloadB64}\`, sig, secret)) return null
    try {
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
      // Require exp - tokens without an expiry claim are rejected (permanent tokens are a security risk)
      if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
      return payload
    } catch { return null }
  },
}

// OAuth helpers (GitHub)
const oauth = {
  github: {
    // Returns { url, state } - store state in session and verify in callback
    url: (scopes = ['user:email']) => {
      const clientId = process.env.GITHUB_CLIENT_ID
      if (!clientId) throw new Error('[arc:oauth] GITHUB_CLIENT_ID env var is not set')
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
      if (!tokenRes.ok) { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'oauth_token_error', provider: 'github', status: tokenRes.status })); return { ok: false, error: 'auth_failed' } }
      let _ghToken; try { _ghToken = await tokenRes.json() } catch { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'oauth_token_parse_error', provider: 'github' })); return { ok: false, error: 'auth_failed' } }
      const { access_token, error: _ghErr } = _ghToken
      if (_ghErr || !access_token) { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'oauth_no_token', provider: 'github' })); return { ok: false, error: 'auth_failed' } }
      const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: \`Bearer \${access_token}\`, 'User-Agent': 'arc-server' },
        signal: AbortSignal.timeout(10000),
      })
      if (!userRes.ok) { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'oauth_user_error', provider: 'github', status: userRes.status })); return { ok: false, error: 'auth_failed' } }
      let user; try { user = await userRes.json() } catch { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'oauth_user_parse_error', provider: 'github' })); return { ok: false, error: 'auth_failed' } }
      // accessToken not included: callers should not store provider tokens long-term.
      // Use the token within this callback if needed, then discard it.
      return { ok: true, user }
    },
  },

  google: {
    // Returns { url, state } - store state in session and verify in callback
    url: (scopes = ['email', 'profile']) => {
      const clientId = process.env.GOOGLE_CLIENT_ID
      if (!clientId) throw new Error('[arc:oauth] GOOGLE_CLIENT_ID env var is not set')
      const redirectUri = process.env.GOOGLE_REDIRECT_URI
      if (!redirectUri) throw new Error('[arc:oauth] GOOGLE_REDIRECT_URI env var is not set')
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
      const redirectUri = process.env.GOOGLE_REDIRECT_URI
      if (!redirectUri) throw new Error('[arc:oauth] GOOGLE_REDIRECT_URI env var is not set')
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
      if (!tokenRes.ok) { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'oauth_token_error', provider: 'google', status: tokenRes.status })); return { ok: false, error: 'auth_failed' } }
      let _gToken; try { _gToken = await tokenRes.json() } catch { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'oauth_token_parse_error', provider: 'google' })); return { ok: false, error: 'auth_failed' } }
      const { access_token, id_token, error: _gErr } = _gToken
      if (_gErr || !access_token) { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'oauth_no_token', provider: 'google' })); return { ok: false, error: 'auth_failed' } }
      // Require id_token: Google's OIDC flow always returns one; absence indicates an unexpected
      // response (non-OIDC scope, revoked app, or token swap attack). Fail closed.
      if (!id_token) { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'oauth_no_id_token', provider: 'google' })); return { ok: false, error: 'auth_failed' } }
      // Validate id_token aud claim: reject tokens issued for a different client_id
      try {
        const _idParts = id_token.split('.')
        const _idPayload = JSON.parse(atob(_idParts[1].replace(/-/g, '+').replace(/_/g, '/')))
        if (_idPayload.aud !== process.env.GOOGLE_CLIENT_ID) { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'oauth_aud_mismatch', provider: 'google' })); return { ok: false, error: 'auth_failed' } }
        // Validate issuer: only accept tokens from Google's OIDC endpoint
        if (_idPayload.iss !== 'https://accounts.google.com' && _idPayload.iss !== 'accounts.google.com') { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'oauth_iss_mismatch', provider: 'google' })); return { ok: false, error: 'auth_failed' } }
      } catch { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'oauth_id_token_decode_failed', provider: 'google' })); return { ok: false, error: 'auth_failed' } }
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: \`Bearer \${access_token}\` },
        signal: AbortSignal.timeout(10000),
      })
      if (!userRes.ok) { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'oauth_user_error', provider: 'google', status: userRes.status })); return { ok: false, error: 'auth_failed' } }
      let user; try { user = await userRes.json() } catch { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'oauth_user_parse_error', provider: 'google' })); return { ok: false, error: 'auth_failed' } }
      // accessToken not included: callers should not store provider tokens long-term.
      return { ok: true, user }
    },
  },
}
`.trim()
}

module.exports = { emitAuthPreamble }
