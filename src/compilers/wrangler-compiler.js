'use strict'

// Generates wrangler.toml for a Cloudflare Workers project.
// Scans ModelDecl + JobDecl nodes to emit the correct D1/Queue bindings.

function generateWranglerToml(program, opts = {}) {
  const name = opts.name ?? 'arc-app'
  const schemas = program.declarations.filter(d => d.type === 'ModelDecl')
  const jobs = program.declarations.filter(d => d.type === 'JobDecl')
  const hasJobs = jobs.length > 0
  const hasDb = schemas.length > 0

  const lines = [
    `name = "${name}"`,
    `main = "dist/worker.js"`,
    `compatibility_date = "2024-09-23"`,
    ``,
  ]

  if (hasDb) {
    lines.push(`[[d1_databases]]`)
    lines.push(`binding = "DB"`)
    lines.push(`database_name = "${name}-db"`)
    lines.push(`database_id = "00000000-0000-0000-0000-000000000000"  # run: wrangler d1 create ${name}-db`)
    lines.push(``)
  }

  if (hasJobs) {
    lines.push(`[[queues.producers]]`)
    lines.push(`binding = "QUEUE"`)
    lines.push(`queue = "${name}-queue"`)
    lines.push(``)
    lines.push(`[[queues.consumers]]`)
    lines.push(`queue = "${name}-queue"`)
    lines.push(`max_batch_size = 10`)
    lines.push(`max_batch_timeout = 30`)
    lines.push(``)
  }

  lines.push(`[vars]`)
  lines.push(`# SESSION_SECRET = "set-in-wrangler-secrets"`)
  lines.push(`# RESEND_API_KEY = "set-in-wrangler-secrets"`)
  lines.push(``)
  lines.push(`# To set secrets: wrangler secret put SESSION_SECRET`)

  return lines.join('\n')
}

module.exports = { generateWranglerToml }
