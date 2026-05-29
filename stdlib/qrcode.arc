// Arc QR Code — stdlib/qrcode.arc
// Zero-dependency QR code widget. Inline SVG, single <path> element.
// Byte-mode QR generation from scratch (ISO 18004, versions 1–40).
//
// Usage:
//   import QRCode from "../../stdlib/qrcode"
//   QRCode value="https://arc.codes"
//   QRCode value="https://arc.codes" size=300 level="H"
//   QRCode value="https://arc.codes" dark="#1a1a2e" light="#eef"

// ── QR engine — runs at page load, finds and renders all [data-arc-qr] spans ──
@state let _qrLib = (fn() {
  // GF(256) exp/log tables for Reed-Solomon
  const exp = new Uint8Array(512)
  const log = new Uint8Array(256)
  let x = 1
  let i = 0
  while i < 255 {
    exp[i] = x
    log[x] = i
    x = x << 1
    if x > 255 { x = x ^ 0x11d }
    i += 1
  }
  let j = 255
  while j < 512 { exp[j] = exp[j - 255]; j += 1 }

  fn gfMul(a, b) {
    if a == 0 || b == 0 { return 0 }
    return exp[(log[a] + log[b]) % 255]
  }

  fn rsGen(n) {
    const g = new Uint8Array(n)
    g[n - 1] = 1
    let root = 1
    let i = 0
    while i < n {
      let j = 0
      while j < n {
        g[j] = gfMul(g[j], root)
        if j + 1 < n { g[j] = g[j] ^ g[j + 1] }
        j += 1
      }
      root = gfMul(root, 2)
      i += 1
    }
    return g
  }

  fn rsRem(data, gpoly) {
    const n = gpoly.length
    const rem = new Uint8Array(n)
    let i = 0
    while i < data.length {
      const f = data[i] ^ rem[0]
      let j = 0
      while j < n {
        rem[j] = (j < n - 1 ? rem[j + 1] : 0) ^ gfMul(gpoly[j], f)
        j += 1
      }
      i += 1
    }
    return rem
  }

  // Capacity tables (index = version, 0 = unused sentinel)
  const CW = [0,26,44,70,100,134,172,196,242,292,346,404,466,532,581,655,733,815,901,991,1085,1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,2323,2465,2611,2761,2876,3034,3196,3362,3532,3706]

  // EC codewords per block [L, M, Q, H][version]
  const EPB = [
    [0,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [0,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
    [0,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [0,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30]
  ]

  // Number of blocks [L, M, Q, H][version]
  const NB = [
    [0,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
    [0,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
    [0,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
    [0,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81]
  ]

  // Alignment pattern center positions per version (1-indexed)
  const AP = [
    [],[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],
    [6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],
    [6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],
    [6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],
    [6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],
    [6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],
    [6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],
    [6,34,62,90,118,146],[6,30,54,82,110,138,166],[6,24,50,76,102,128,154],
    [6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],
    [6,30,58,86,114,142,170]
  ]

  fn encode(text, ecLvl) {
    const bytes = Array.from(new TextEncoder().encode(text))
    const dlen = bytes.length
    let ver = 1
    while ver <= 40 {
      const cap = CW[ver] - EPB[ecLvl][ver] * NB[ecLvl][ver]
      const ccBits = ver < 10 ? 8 : 16
      if cap * 8 >= 4 + ccBits + dlen * 8 { break }
      ver += 1
    }
    if ver > 40 { return null }

    const nb = NB[ecLvl][ver]
    const epb = EPB[ecLvl][ver]
    const totalData = CW[ver] - epb * nb
    const maxBits = totalData * 8
    const ccBits = ver < 10 ? 8 : 16

    const cws = []
    let acc = 0
    let accN = 0

    fn pushBits(val, n) {
      let i = n - 1
      while i >= 0 {
        acc = (acc << 1) | ((val >> i) & 1)
        accN += 1
        if accN == 8 { cws.push(acc & 0xFF); acc = 0; accN = 0 }
        i -= 1
      }
    }

    pushBits(4, 4)
    pushBits(dlen, ccBits)
    let i = 0
    while i < dlen { pushBits(bytes[i], 8); i += 1 }

    let t = 0
    while t < 4 && cws.length * 8 + accN < maxBits { pushBits(0, 1); t += 1 }
    while accN > 0 { pushBits(0, 1) }

    let pi = 0
    while cws.length < totalData { cws.push(pi % 2 == 0 ? 0xEC : 0x11); pi += 1 }

    const shortLen = Math.floor(totalData / nb)
    const numLong = totalData % nb
    const gpoly = rsGen(epb)
    const dataBlocks = []
    const ecBlocks = []
    let off = 0
    let bi = 0
    while bi < nb {
      const blen = bi < nb - numLong ? shortLen : shortLen + 1
      const blk = new Uint8Array(blen)
      let k = 0
      while k < blen { blk[k] = cws[off + k]; k += 1 }
      dataBlocks.push(blk)
      ecBlocks.push(rsRem(blk, gpoly))
      off += blen
      bi += 1
    }

    const result = new Uint8Array(CW[ver])
    let ri = 0
    let col = 0
    while col <= shortLen {
      let row = 0
      while row < nb {
        if col < dataBlocks[row].length { result[ri] = dataBlocks[row][col]; ri += 1 }
        row += 1
      }
      col += 1
    }
    let ec = 0
    while ec < epb {
      let row = 0
      while row < nb { result[ri] = ecBlocks[row][ec]; ri += 1; row += 1 }
      ec += 1
    }
    return { cws: result, ver }
  }

  fn buildMatrix(cws, ver) {
    const sz = 17 + 4 * ver
    const mod = new Uint8Array(sz * sz)
    const res = new Uint8Array(sz * sz)

    fn set(x, y, v) { mod[y * sz + x] = v; res[y * sz + x] = 1 }
    fn get(x, y) { return mod[y * sz + x] }

    fn finder(ox, oy) {
      let dy = -1
      while dy <= 7 {
        let dx = -1
        while dx <= 7 {
          const x = ox + dx
          const y = oy + dy
          if x >= 0 && x < sz && y >= 0 && y < sz {
            const inFinder = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6
            let dark = 0
            if inFinder {
              dark = (dx == 0 || dx == 6 || dy == 0 || dy == 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)) ? 1 : 0
            }
            set(x, y, dark)
          }
          dx += 1
        }
        dy += 1
      }
    }

    finder(0, 0)
    finder(sz - 7, 0)
    finder(0, sz - 7)

    let ti = 8
    while ti < sz - 8 {
      set(ti, 6, ti % 2 == 0 ? 1 : 0)
      set(6, ti, ti % 2 == 0 ? 1 : 0)
      ti += 1
    }

    const ap = AP[ver]
    let ai = 0
    while ai < ap.length {
      let aj = 0
      while aj < ap.length {
        const cx = ap[aj]
        const cy = ap[ai]
        if !((cx <= 8 && cy <= 8) || (cx >= sz - 8 && cy <= 8) || (cx <= 8 && cy >= sz - 8)) {
          let dy = -2
          while dy <= 2 {
            let dx = -2
            while dx <= 2 {
              const dark = (dx == -2 || dx == 2 || dy == -2 || dy == 2 || (dx == 0 && dy == 0)) ? 1 : 0
              set(cx + dx, cy + dy, dark)
              dx += 1
            }
            dy += 1
          }
        }
        aj += 1
      }
      ai += 1
    }

    fn reserveFmt(x, y) { if !res[y * sz + x] { res[y * sz + x] = 1 } }
    let fi = 0
    while fi <= 8 {
      reserveFmt(fi, 8)
      reserveFmt(8, fi)
      reserveFmt(sz - 1 - fi, 8)
      reserveFmt(8, sz - 1 - fi)
      fi += 1
    }
    set(8, 4 * ver + 9, 1)

    if ver >= 7 {
      let vinfo = ver << 12
      let vi = 17
      while vi >= 12 {
        if (vinfo >> vi) & 1 { vinfo = vinfo ^ (0x1F25 << (vi - 12)) }
        vi -= 1
      }
      vinfo = (ver << 12) | (vinfo & 0xFFF)
      let vb = 0
      while vb < 18 {
        const dark = (vinfo >> vb) & 1
        const row = Math.floor(vb / 3)
        const col2 = vb % 3
        set(sz - 11 + col2, row, dark)
        set(row, sz - 11 + col2, dark)
        vb += 1
      }
    }

    const bits = new Uint8Array(CW[ver] * 8)
    let blen = 0
    let cwi = 0
    while cwi < cws.length {
      let b = 7
      while b >= 0 { bits[blen] = (cws[cwi] >> b) & 1; blen += 1; b -= 1 }
      cwi += 1
    }

    let bitIdx = 0
    let right = sz - 1
    while right >= 1 {
      if right == 6 { right -= 1 }
      let upward = ((sz - 1 - right) / 2) % 2 == 0
      let y = upward ? sz - 1 : 0
      while (upward ? y >= 0 : y < sz) {
        let dx = 0
        while dx < 2 {
          const x = right - dx
          if !res[y * sz + x] {
            mod[y * sz + x] = bitIdx < blen ? bits[bitIdx] : 0
            bitIdx += 1
          }
          dx += 1
        }
        y += upward ? -1 : 1
      }
      right -= 2
    }

    return { mod, res, sz }
  }

  fn penalty(mod, sz) {
    let score = 0
    let y = 0
    while y < sz {
      let run = 1
      let x = 1
      while x < sz {
        if mod[y * sz + x] == mod[y * sz + x - 1] { run += 1 } else { if run >= 5 { score += 3 + (run - 5) }; run = 1 }
        x += 1
      }
      if run >= 5 { score += 3 + (run - 5) }
      y += 1
    }
    let x = 0
    while x < sz {
      let run = 1
      let y2 = 1
      while y2 < sz {
        if mod[y2 * sz + x] == mod[(y2 - 1) * sz + x] { run += 1 } else { if run >= 5 { score += 3 + (run - 5) }; run = 1 }
        y2 += 1
      }
      if run >= 5 { score += 3 + (run - 5) }
      x += 1
    }
    let ry = 0
    while ry < sz - 1 {
      let rx = 0
      while rx < sz - 1 {
        const v = mod[ry * sz + rx]
        if mod[ry * sz + rx + 1] == v && mod[(ry + 1) * sz + rx] == v && mod[(ry + 1) * sz + rx + 1] == v { score += 3 }
        rx += 1
      }
      ry += 1
    }
    const p1 = [1,0,1,1,1,0,1,0,0,0,0]
    const p2 = [0,0,0,0,1,0,1,1,1,0,1]
    let py = 0
    while py < sz {
      let px = 0
      while px <= sz - 11 {
        let m1 = 1
        let m2 = 1
        let pi = 0
        while pi < 11 {
          if mod[py * sz + px + pi] != p1[pi] { m1 = 0 }
          if mod[py * sz + px + pi] != p2[pi] { m2 = 0 }
          pi += 1
        }
        if m1 { score += 40 }
        if m2 { score += 40 }
        px += 1
      }
      py += 1
    }
    let pvx = 0
    while pvx < sz {
      let pvy = 0
      while pvy <= sz - 11 {
        let m1 = 1
        let m2 = 1
        let pi = 0
        while pi < 11 {
          if mod[(pvy + pi) * sz + pvx] != p1[pi] { m1 = 0 }
          if mod[(pvy + pi) * sz + pvx] != p2[pi] { m2 = 0 }
          pi += 1
        }
        if m1 { score += 40 }
        if m2 { score += 40 }
        pvy += 1
      }
      pvx += 1
    }
    let dark = 0
    let total = sz * sz
    let di = 0
    while di < total { dark += mod[di]; di += 1 }
    const pct = Math.abs(dark * 100 / total - 50)
    score += Math.floor(pct / 5) * 10
    return score
  }

  fn applyMask(mod, res, sz, mask) {
    const out = new Uint8Array(mod)
    let y = 0
    while y < sz {
      let x = 0
      while x < sz {
        if !res[y * sz + x] {
          let flip = 0
          if mask == 0 { flip = (x + y) % 2 == 0 ? 1 : 0 }
          else if mask == 1 { flip = y % 2 == 0 ? 1 : 0 }
          else if mask == 2 { flip = x % 3 == 0 ? 1 : 0 }
          else if mask == 3 { flip = (x + y) % 3 == 0 ? 1 : 0 }
          else if mask == 4 { flip = (Math.floor(y / 2) + Math.floor(x / 3)) % 2 == 0 ? 1 : 0 }
          else if mask == 5 { flip = (x * y % 2 + x * y % 3) == 0 ? 1 : 0 }
          else if mask == 6 { flip = (x * y % 2 + x * y % 3) % 2 == 0 ? 1 : 0 }
          else { flip = ((x + y) % 2 + x * y % 3) % 2 == 0 ? 1 : 0 }
          if flip { out[y * sz + x] = out[y * sz + x] ^ 1 }
        }
        x += 1
      }
      y += 1
    }
    return out
  }

  fn writeFmt(mod, sz, ecLvl, mask) {
    const ecBits = [1, 0, 3, 2]
    let data = (ecBits[ecLvl] << 3) | mask
    let rem = data << 10
    let i = 14
    while i >= 10 {
      if (rem >> i) & 1 { rem = rem ^ (0x537 << (i - 10)) }
      i -= 1
    }
    const fmt = ((data << 10) | (rem & 0x3FF)) ^ 0x5412
    const coords = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]]
    let fi = 0
    while fi < 15 {
      const dark = (fmt >> fi) & 1
      mod[coords[fi][1] * sz + coords[fi][0]] = dark
      if fi < 7 { mod[8 * sz + (sz - 1 - fi)] = dark }
      else { mod[(sz - 7 + (fi - 8)) * sz + 8] = dark }
      fi += 1
    }
  }

  fn toSvg(text, size, dark, light, ecStr) {
    if !text || text.length == 0 { return "" }
    const safeSize = Math.max(10, Math.min(4096, Number(size) || 200))
    const safeDark = String(dark || "#000000").replace(RegExp("[^a-zA-Z0-9#()., %-]", "g"), "")
    const safeLight = String(light || "#ffffff").replace(RegExp("[^a-zA-Z0-9#()., %-]", "g"), "")
    const ecMap = { "L": 0, "M": 1, "Q": 2, "H": 3 }
    const ecLvl = ecMap[String(ecStr).toUpperCase()] ?? 1

    const enc = encode(String(text), ecLvl)
    if !enc { return "" }

    const mat = buildMatrix(enc.cws, enc.ver)
    const sz = mat.sz

    let bestMod = null
    let bestScore = Infinity
    let m = 0
    while m < 8 {
      const masked = applyMask(mat.mod, mat.res, sz, m)
      writeFmt(masked, sz, ecLvl, m)
      const score = penalty(masked, sz)
      if score < bestScore { bestScore = score; bestMod = masked }
      m += 1
    }

    const q = 4
    const n = sz + q * 2
    let path = ""
    let y = 0
    while y < sz {
      let x = 0
      while x < sz {
        if bestMod[y * sz + x] {
          let run = 1
          while x + run < sz && bestMod[y * sz + x + run] { run += 1 }
          path += "M" + (x + q) + "," + (y + q) + "h" + run + "v1h-" + run + "z"
          x += run
        } else {
          x += 1
        }
      }
      y += 1
    }

    return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " + n + " " + n + "\" width=\"" + safeSize + "\" height=\"" + safeSize + "\" shape-rendering=\"crispEdges\"><rect width=\"" + n + "\" height=\"" + n + "\" fill=\"" + safeLight + "\"/><path fill=\"" + safeDark + "\" d=\"" + path + "\"/></svg>"
  }

  fn renderEl(el) {
    const d = el.dataset
    el.innerHTML = toSvg(d.v, d.s, d.d, d.l, d.e)
  }

  window._arcQrToSvg = toSvg

  document.querySelectorAll("[data-arc-qr]").forEach(fn(el) { renderEl(el) })

  new MutationObserver(fn(muts) {
    muts.forEach(fn(m) {
      m.addedNodes.forEach(fn(n) {
        if n.nodeType == 1 {
          if n.hasAttribute("data-arc-qr") { renderEl(n) }
          n.querySelectorAll("[data-arc-qr]").forEach(fn(el) { renderEl(el) })
        }
      })
    })
  }).observe(document.body, { childList: true, subtree: true })

  return null
})()

// ── Widget ────────────────────────────────────────────────────────────────────
widget QRCode(value = "", size = 200, dark = "#000000", light = "#ffffff", level = "M")
  span data-arc-qr="1" data-v=@value data-s=@size data-d=@dark data-l=@light data-e=@level
  design
    span
      display: inline-block
      line-height: 0
