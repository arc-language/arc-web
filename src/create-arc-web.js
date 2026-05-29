#!/usr/bin/env node
'use strict'

// Standalone bin for: npx create-arc-web [name] [--template T] [--pm P] [--install|--no-install]
// Shared wizard logic lives in new-command.js; this file is only the CLI entry point.

const { runWizard, newProject, detectPackageManager } = require('./new-command')

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  Usage
    npx create-arc-web [name] [options]

  Options
    --template  default | counter | blog | api | cms  (default: interactive)
    --pm        bun | npm | pnpm | yarn               (default: auto-detected)
    --install   Run package manager install after creating
    --no-install  Skip install step
    --help      Show this help

  Examples
    npx create-arc-web                          # interactive wizard
    npx create-arc-web my-app                  # wizard, name pre-filled
    npx create-arc-web my-blog --template blog # skip wizard, use defaults
  `)
  process.exit(0)
}

// Extract positional name (first non-flag arg)
const tmplIdx = args.indexOf('--template')
const pmIdx = args.indexOf('--pm')
const flagValues = new Set()
if (tmplIdx !== -1 && args[tmplIdx + 1]) flagValues.add(args[tmplIdx + 1])
if (pmIdx !== -1 && args[pmIdx + 1]) flagValues.add(args[pmIdx + 1])
const name = args.find(a => !a.startsWith('--') && !flagValues.has(a))

const template = tmplIdx !== -1 ? args[tmplIdx + 1] : undefined
const pm = pmIdx !== -1 ? args[pmIdx + 1] : undefined
const install = args.includes('--install') ? true : args.includes('--no-install') ? false : undefined

// Skip the wizard when name + template + install preference are all given; pm auto-detects if omitted
const fullySpecified = name && template && install !== undefined
const run = fullySpecified
  ? () => newProject(name, template, { pm: pm ?? detectPackageManager(), install })
  : () => runWizard({ name, template, pm, install })

Promise.resolve(run()).catch(err => {
  console.error(err.message)
  process.exit(1)
})
