'use strict'

const path = require('path')

// Paths to arc-cms source directories — consumed by `arc cms init`
const CMS_SRC = path.join(__dirname)

module.exports = {
  // Source directories for `arc cms init` scaffolding
  pagesDir:   path.join(CMS_SRC, 'pages'),
  widgetsDir: path.join(CMS_SRC, 'widgets'),
  serverDir:  path.join(CMS_SRC, 'server'),
  schemaDir:  path.join(CMS_SRC, 'schema'),
  cssDir:     path.join(CMS_SRC, 'css'),

  // Server route files (used by cms.js copy step)
  serverRoutes: [
    path.join(CMS_SRC, 'server', 'auth.arc'),
    path.join(CMS_SRC, 'server', 'users.arc'),
    path.join(CMS_SRC, 'server', 'groups.arc'),
    path.join(CMS_SRC, 'server', 'pages.arc'),
    path.join(CMS_SRC, 'server', 'media.arc'),
  ],

  // Schema
  blockTypesSchema: path.join(CMS_SRC, 'schema', 'block-types.json'),
  cmsConfigTemplate: path.join(CMS_SRC, 'schema', 'cms.config.arc.template'),

  version: require('../package.json').version,
}
