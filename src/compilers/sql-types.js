'use strict'

function arcTypeToSql(arcType, dialect = 'sqlite') {
  if (dialect === 'postgres') {
    switch (arcType) {
      case 'Int':      return 'INTEGER'
      case 'Float':    return 'REAL'
      case 'Bool':     return 'BOOLEAN'
      case 'DateTime': return 'TIMESTAMPTZ'
      case 'Email':    return 'TEXT'
      case 'String':   return 'TEXT'
      default:         return 'TEXT'
    }
  }
  switch (arcType) {
    case 'Int':      return 'INTEGER'
    case 'Float':    return 'REAL'
    case 'Bool':     return 'INTEGER'
    case 'DateTime': return 'TEXT'
    case 'Email':    return 'TEXT'
    case 'String':   return 'TEXT'
    default:         return 'TEXT'
  }
}

module.exports = { arcTypeToSql }
