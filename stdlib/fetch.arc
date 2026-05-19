// Arc Fetch — typed API client with ADP binary protocol support
// Usage: import { get, post, put, del, api } from "arc/fetch"
//
// Example:
//   // Simple JSON fetch
//   const user = await get("/api/user/1")
//
//   // With ADP binary (3x smaller, 10x faster decode)
//   const users = await api.adp.get("/api/users")
//
//   // Reactive data fetching
//   @state let data = none
//   @state let loading = false
//   @state let error = none
//
//   button on:click={
//     const result = await api.get("/api/posts")
//     match result {
//       Ok(posts) => data = posts
//       Err(e) => error = e.message
//     }
//   }

// ── Base fetch wrapper ────────────────────────────────────────────────────────

fn _buildHeaders(options, isAdp) {
  const base = {
    "Content-Type": isAdp ? "application/x-adp" : "application/json",
    "Accept": isAdp ? "application/x-adp" : "application/json"
  }
  const extra = options?.headers ?? {}
  return { ...base, ...extra }
}

fn _request(method, url, body, options) {
  const headers = _buildHeaders(options, false)
  const config = {
    method,
    headers,
    credentials: options?.credentials ?? "same-origin",
    signal: options?.signal
  }

  if body != none {
    config.body = JSON.stringify(body)
  }

  return fetch(url, config)
    .then(fn(response) {
      if !response.ok {
        return response.text().then(fn(text) {
          let message = "Request failed: " + response.status
          const ct = response.headers.get("Content-Type") ?? ""
          if ct.includes("application/json") {
            const parsed = JSON.parse(text)
            message = parsed?.error ?? parsed?.message ?? message
          }
          return Err({ status: response.status, message })
        })
      }
      const ct = response.headers.get("Content-Type") ?? ""
      if ct.includes("application/json") {
        return response.json().then(fn(data) => Ok(data))
      }
      return response.text().then(fn(text) => Ok(text))
    })
    .catch(fn(err) => Err({ status: 0, message: err.message ?? "Network error" }))
}

// ── JSON API methods ──────────────────────────────────────────────────────────

fn get(url, options) {
  return _request("GET", url, none, options)
}

fn post(url, body, options) {
  return _request("POST", url, body, options)
}

fn put(url, body, options) {
  return _request("PUT", url, body, options)
}

fn patch(url, body, options) {
  return _request("PATCH", url, body, options)
}

fn del(url, options) {
  return _request("DELETE", url, none, options)
}

// ── ADP Binary Protocol ───────────────────────────────────────────────────────
// ADP: Arc Data Protocol — binary wire format, 3x smaller than JSON
// Server must respond with Content-Type: application/x-adp
// Arc compiler auto-generates ADP decoders for @server fn return types

fn _adpRequest(method, url, body, options) {
  const headers = _buildHeaders(options, true)
  const config = {
    method,
    headers,
    credentials: options?.credentials ?? "same-origin",
    signal: options?.signal
  }

  if body != none {
    if window._arc?.adp?.encode {
      config.body = window._arc.adp.encode(body)
    } else {
      config.headers["Content-Type"] = "application/json"
      config.body = JSON.stringify(body)
    }
  }

  return fetch(url, config)
    .then(fn(response) {
      if !response.ok {
        return response.text().then(fn(text) => Err({ status: response.status, message: text }))
      }
      const ct = response.headers.get("Content-Type") ?? ""
      if ct.includes("application/x-adp") && window._arc?.adp?.decode {
        return response.arrayBuffer().then(fn(buf) => Ok(window._arc.adp.decode(buf)))
      }
      return response.json().then(fn(data) => Ok(data))
    })
    .catch(fn(err) => Err({ status: 0, message: err.message ?? "Network error" }))
}

// ── Unified api object ────────────────────────────────────────────────────────

const api = {
  "get": fn(url, opts) { return _request("GET", url, none, opts) },
  "post": fn(url, body, opts) { return _request("POST", url, body, opts) },
  "put": fn(url, body, opts) { return _request("PUT", url, body, opts) },
  "patch": fn(url, body, opts) { return _request("PATCH", url, body, opts) },
  "delete": fn(url, opts) { return _request("DELETE", url, none, opts) },

  "adp": {
    "get": fn(url, opts) { return _adpRequest("GET", url, none, opts) },
    "post": fn(url, body, opts) { return _adpRequest("POST", url, body, opts) },
    "put": fn(url, body, opts) { return _adpRequest("PUT", url, body, opts) },
    "delete": fn(url, opts) { return _adpRequest("DELETE", url, none, opts) }
  }
}

// ── useFetch — reactive data fetching ────────────────────────────────────────
// Returns a handle with reactive loading/data/error state

fn useFetch(url, options) {
  @state let data = none
  @state let loading = false
  @state let error = none
  @state let controller = none

  fn load() {
    if controller { controller.abort() }
    const c = AbortController()
    controller = c
    loading = true
    error = none

    get(url, { ...options, signal: c.signal })
      .then(fn(result) {
        match result {
          Ok(d) => {
            data = d
            loading = false
          }
          Err(e) => {
            loading = false
            if e.message != "AbortError" {
              error = e.message
            }
          }
        }
      })
  }

  fn cancel() {
    if controller { controller.abort() }
    loading = false
  }

  fn refresh() { load() }

  return {
    "data": fn() { return data },
    "loading": fn() { return loading },
    "error": fn() { return error },
    "load": load,
    "cancel": cancel,
    "refresh": refresh
  }
}
