'use strict'

function getContentType(path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8'
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.js')) return 'application/javascript'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.ico')) return 'image/x-icon'
  return 'application/octet-stream'
}

module.exports = { getContentType }
