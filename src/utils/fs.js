'use strict'

const fs = require('fs')
const path = require('path')

function findArcFiles(dir) {
  const results = []
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) }
  catch (e) { console.warn(`arc: warning: cannot read directory ${dir}: ${e.message}`); return results }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
      results.push(...findArcFiles(path.join(dir, entry.name)))
    } else if (entry.isFile() && entry.name.endsWith('.arc')) {
      results.push(path.join(dir, entry.name))
    }
  }
  return results
}

module.exports = { findArcFiles }
