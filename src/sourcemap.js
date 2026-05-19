'use strict'

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function encodeVlq(n) {
  // Encode signed integer as VLQ base64
  let vlq = n < 0 ? ((-n) << 1) | 1 : n << 1
  let result = ''
  do {
    let digit = vlq & 0x1f
    vlq >>>= 5
    if (vlq > 0) digit |= 0x20
    result += BASE64[digit]
  } while (vlq > 0)
  return result
}

class SourceMapBuilder {
  constructor() {
    // Each mapping: { genLine, genCol, srcLine, srcCol }
    this.mappings = []
  }

  addMapping(genLine, genCol, srcLine, srcCol) {
    this.mappings.push({ genLine, genCol, srcLine, srcCol })
  }

  generate(sourceFile, sourceContent) {
    // Group mappings by generated line
    const byLine = new Map()
    for (const m of this.mappings) {
      if (!byLine.has(m.genLine)) byLine.set(m.genLine, [])
      byLine.get(m.genLine).push(m)
    }

    // Find the max generated line
    let maxLine = 0
    for (const line of byLine.keys()) {
      if (line > maxLine) maxLine = line
    }

    // Build mappings string
    const lineStrings = []
    let prevSrcLine = 0
    let prevSrcCol = 0

    for (let i = 0; i <= maxLine; i++) {
      const segs = byLine.get(i)
      if (!segs || segs.length === 0) {
        lineStrings.push('')
        continue
      }

      // Sort segments by genCol
      segs.sort((a, b) => a.genCol - b.genCol)

      let prevGenCol = 0
      const segStrings = []

      for (const seg of segs) {
        const genColDelta = seg.genCol - prevGenCol
        const srcLineDelta = seg.srcLine - prevSrcLine
        const srcColDelta = seg.srcCol - prevSrcCol

        segStrings.push(
          encodeVlq(genColDelta) +
          encodeVlq(0) + // sourceIndex always 0 (single source)
          encodeVlq(srcLineDelta) +
          encodeVlq(srcColDelta)
        )

        prevGenCol = seg.genCol
        prevSrcLine = seg.srcLine
        prevSrcCol = seg.srcCol
      }

      lineStrings.push(segStrings.join(','))
    }

    const mappingsStr = lineStrings.join(';')

    return {
      version: 3,
      file: sourceFile,
      sources: [sourceFile.replace(/\.js$/, '.arc')],
      sourcesContent: [sourceContent ?? null],
      mappings: mappingsStr,
    }
  }
}

module.exports = { encodeVlq, SourceMapBuilder }
