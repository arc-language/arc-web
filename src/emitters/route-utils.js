'use strict'

function routeHandlerName(route) {
  const slug = route.path.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '') || 'root'
  const method = route.method.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'unknown'
  return `_route_${method}_${slug}`
}

function isValidRoute(route) {
  return route.method && /^[a-zA-Z]+$/.test(route.method) && route.path !== ''
}

module.exports = { routeHandlerName, isValidRoute }
