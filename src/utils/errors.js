'use strict'

const path = require('path')

const RED    = process.stderr.isTTY ? '\x1b[31m' : ''
const GREEN  = process.stderr.isTTY ? '\x1b[32m' : ''
const YELLOW = process.stderr.isTTY ? '\x1b[33m' : ''
const CYAN   = process.stderr.isTTY ? '\x1b[36m' : ''
const DIM    = process.stderr.isTTY ? '\x1b[2m'  : ''
const RESET  = process.stderr.isTTY ? '\x1b[0m'  : ''

function formatError(e, source, filename) {
  const msg = e.message ?? String(e)
  const filePrefix = filename ? `${path.relative(process.cwd(), filename)}: ` : ''
  const lines = msg.split('\n').filter(Boolean)
  for (const line of lines) {
    console.error(`${RED}error${RESET}: ${filePrefix}${line}`)
    const m = line.match(/:(\d+)(?::(\d+))?:/)
    if (m && source) {
      showSourceContext(source, parseInt(m[1]), m[2] ? parseInt(m[2]) : undefined)
    }
  }
}

function showSourceContext(source, lineNum, col) {
  if (!lineNum || !source) return
  const lines = source.split('\n')
  const line = lines[lineNum - 1]
  if (!line) return
  const lineStr = String(lineNum).padStart(4)
  console.error(`${DIM}${lineStr} │${RESET} ${line}`)
  if (col && col > 0) {
    const spaces = ' '.repeat(4 + 3 + col - 1)
    console.error(`${CYAN}${spaces}^${RESET}`)
  }
}

module.exports = { RED, GREEN, YELLOW, CYAN, DIM, RESET, formatError, showSourceContext }
