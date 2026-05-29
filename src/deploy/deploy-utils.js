'use strict'

const SAFE_HANDLER_NAME_RE = /^_handler_[a-zA-Z_$][a-zA-Z0-9_$]*$/

/**
 * Resolve handler function names from either an explicit list (from the compiler AST)
 * or by scanning edge function source text. Falls back to empty array if neither provided.
 */
function resolveHandlerNames(handlerNames, edgeFunctions) {
  if (handlerNames) {
    return handlerNames.filter(h => SAFE_HANDLER_NAME_RE.test(h))
  }
  if (edgeFunctions) {
    return [...new Set([...edgeFunctions.matchAll(/^async function (_handler_\w+)\s*\(/mg)].map(m => m[1]))]
      .filter(h => SAFE_HANDLER_NAME_RE.test(h))
  }
  return []
}

module.exports = { SAFE_HANDLER_NAME_RE, resolveHandlerNames }
