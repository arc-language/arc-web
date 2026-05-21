// Arc Router — client-side routing using View Transitions API
// Usage: import Router, Link from "arc/router"
//
// The router intercepts <a> clicks, updates the URL via History API,
// and uses View Transitions for animated page swaps when available.
// Falls back to instant swap on browsers without View Transitions.
//
// Example:
//   page "App"
//     import Router, Link from "arc/router"
//     Router
//       route path="/" component={ HomePage }
//       route path="/about" component={ AboutPage }
//       route path="/posts/:id" component={ PostPage }

@state let _routerPath = location.pathname
@state let _routerParams = {}
@state let _routerTransitioning = false

// Escape a single character for use inside a RegExp literal.
fn _escRegexChar(c) {
  if c == "." { return "\\." }
  if c == "*" { return "\\*" }
  if c == "+" { return "\\+" }
  if c == "?" { return "\\?" }
  if c == "^" { return "\\^" }
  if c == "$" { return "\\$" }
  if c == "\{" { return "\\\{" }
  if c == "\}" { return "\\\}" }
  if c == "[" { return "\\[" }
  if c == "]" { return "\\]" }
  if c == "(" { return "\\(" }
  if c == ")" { return "\\)" }
  if c == "|" { return "\\|" }
  if c == "\\" { return "\\\\" }
  return c
}

// Parse a route pattern into a regex + param names.
// "/posts/:id/comments/:cid" → { regex: RegExp, params: ["id", "cid"] }
fn parseRoute(pattern) {
  const params = []
  // Walk the pattern char by char — replace :name segments with capture groups,
  // escape regex metacharacters in static segments to prevent ReDoS.
  let regexStr = ""
  let i = 0
  while i < pattern.length {
    if pattern[i] == ":" {
      // Collect param name (param names are identifiers — no escaping needed)
      let name = ""
      i += 1
      while i < pattern.length && pattern[i] != "/" {
        name = name + pattern[i]
        i += 1
      }
      params.push(name)
      regexStr = regexStr + "([^/]+)"
    } else {
      regexStr = regexStr + _escRegexChar(pattern[i])
      i += 1
    }
  }
  return { regex: RegExp("^" + regexStr + "$"), params }
}

// Match current path against a route pattern.
// Returns { matched: true, params: {} } or { matched: false, params: {} }
fn matchRoute(pattern, path) {
  const route = parseRoute(pattern)
  const m = path.match(route.regex)
  unless m { return { matched: false, params: {} } }
  const extracted = {}
  for i, name in route.params {
    extracted[name] = m[i + 1]
  }
  return { matched: true, params: extracted }
}

// Move focus to main content after navigation for screen reader users
fn _focusMain() {
  const main = document.querySelector("main, [role='main'], #main-content")
  if main {
    if !main.hasAttribute("tabindex") { main.setAttribute("tabindex", "-1") }
    main.focus({ preventScroll: false })
  }
}

// Navigate to a new path — updates URL and runs View Transition if available
fn navigate(path) {
  unless path == _routerPath {
    if document.startViewTransition {
      _routerTransitioning = true
      document.startViewTransition(fn() {
        history.pushState({}, "", path)
        _routerPath = path
        _routerTransitioning = false
        _focusMain()
      })
    } else {
      history.pushState({}, "", path)
      _routerPath = path
      _focusMain()
    }
  }
}

// Handle browser back/forward buttons
window.addEventListener("popstate", fn() {
  _routerPath = location.pathname
})

// Router widget — renders the first matching route
widget Router
  @state let routes = []

  fn register(path, component) {
    routes = [...routes, { path, component }]
  }

  for route in routes {
    const result = matchRoute(route.path, _routerPath)
    if result.matched {
      _routerParams = result.params
      route.component
    }
  }

// Route declaration widget
widget Route
  // Attrs: path, component
  // Registered automatically by parent Router via slot mechanism

// Link widget — renders <a> that uses router navigation instead of full page load
widget Link
  // Attrs: href, class, (slot for children)
  link href={ @href }
    on:click={ fn(e) {
      e.preventDefault()
      navigate(@href)
    }}
    slot
