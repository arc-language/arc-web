'use strict'

function routeHandlerName(route) {
  const slug = route.path.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '') || 'root'
  return `_route_${route.method.toLowerCase()}_${slug}`
}

module.exports = { routeHandlerName }
