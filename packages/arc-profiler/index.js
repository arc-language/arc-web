'use strict'

const { Collector } = require('./src/collector')
const { DASHBOARD_HTML, TOOLBAR_JS } = require('../src/profiler/hooks')

module.exports = { Collector, DASHBOARD_HTML, TOOLBAR_JS }
