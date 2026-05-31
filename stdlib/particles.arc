// Arc Particles — unified particle engine for all presets.
// One typed-array pool per canvas. Zero GC per frame. Zero dependencies.
//
// Key optimizations:
//   - Free-list for O(1) slot allocation (vs O(n) linear scan)
//   - cidx + rawC hex strings: zero per-frame color string allocation
//   - Squared distance in Links/Triangles: no sqrt in outer check
//   - setTransform for confetti rotation: 1 call vs save+translate+rotate+restore
//   - initFn called after resize(): spawn positions use real w/h
//   - Pre-computed TAU, linkD²; squaresMode flag avoids per-frame string compare
//   - emitAcc only decrements on successful spawn
//
// Usage:
//   import Snow from "../../stdlib/particles"
//   Snow                          // fullscreen
//   Snow fullscreen=false pool=80 // embedded with custom pool
//
// Widgets: Snow Stars Bubbles BigCircles Ambient Fire Firefly Fountain
//          Hyperspace ConfettiFalling Confetti ConfettiCannon
//          ConfettiExplosions ConfettiParade Links Triangles Squares SeaAnemone

@state let _pfx = (fn() {
  if window.matchMedia("(prefers-reduced-motion: reduce)").matches { return }

  fn boot(canvas) {
    const ef = canvas.dataset.arcPfx
    if !ef { return }

    const P    = parseInt(canvas.dataset.pfxPool) || 300
    const px   = new Float32Array(P)
    const py   = new Float32Array(P)
    const vx   = new Float32Array(P)
    const vy   = new Float32Array(P)
    const lf   = new Float32Array(P)
    const ml   = new Float32Array(P)
    const sz   = new Float32Array(P)
    const ag   = new Float32Array(P)
    const av   = new Float32Array(P)
    const cidx = new Uint8Array(P)
    const sh   = new Uint8Array(P)
    const al   = new Uint8Array(P)
    const free = new Int16Array(P)
    let freeTop = P
    let fi = 0
    while fi < P { free[fi] = fi; fi += 1 }

    const ctx = canvas.getContext("2d")
    let w = 0
    let h = 0
    let dpr = 1

    // Hex strings used directly as CSS colors — zero allocation per frame
    const rawC = (canvas.dataset.pfxColors || "#ffffff").split(",")
    const nc   = rawC.length
    const TAU  = 6.28318

    fn rnd(a, b) { return a + Math.random() * (b - a) }
    fn rndC(i)   { cidx[i] = Math.floor(Math.random() * nc) }

    // O(1) free-list allocation
    fn slot() {
      if freeTop <= 0 { return -1 }
      freeTop -= 1
      return free[freeTop]
    }
    fn kill(i) {
      al[i] = 0
      free[freeTop] = i
      freeTop += 1
    }

    const spd    = parseFloat(canvas.dataset.pfxSpeed)    || 1
    const grav   = parseFloat(canvas.dataset.pfxGravity)  || 0
    const szMin  = parseFloat(canvas.dataset.pfxSizeMin)  || 3
    const szMax  = parseFloat(canvas.dataset.pfxSizeMax)  || 6
    const lifeN  = parseFloat(canvas.dataset.pfxLife)     || 180
    const emitN  = parseInt(canvas.dataset.pfxEmit)       || 2
    const trailA = parseFloat(canvas.dataset.pfxTrail)    || 0
    const linkD  = parseFloat(canvas.dataset.pfxLinkDist) || 120
    const linkD2 = linkD * linkD

    let spawnFn  = fn(i) {}
    let updateFn = fn(i) {}
    let drawFn   = fn(i) {}
    let postFn   = fn()  {}
    let initFn   = fn()  {}
    let emitRate = 0
    let useClick = false
    let useHover = false
    let squaresMode = ef == "squares"
    let fullscr  = canvas.dataset.pfxFullscreen != undefined
    let clickX   = 0
    let clickY   = 0
    let emitAcc  = 0
    let ticker   = 0

    fn prefill() {
      let ii = 0
      while ii < P { const s = slot(); if s >= 0 { spawnFn(s) }; ii += 1 }
    }

    // ── Snow ──────────────────────────────────────────────────────────────────
    if ef == "snow" {
      spawnFn = fn(i) {
        px[i] = rnd(0, w); py[i] = rnd(-20, 0)
        vx[i] = rnd(-0.4, 0.4); vy[i] = rnd(0.5, 1.5) * spd
        sz[i] = rnd(szMin, szMax); lf[i] = rnd(0, TAU)
        rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        px[i] += vx[i] + Math.sin(py[i] * 0.04 + lf[i]) * 0.4
        py[i] += vy[i]; lf[i] += 0.02
        if py[i] > h + 10 { kill(i) }
      }
      drawFn = fn(i) {
        ctx.globalAlpha = 0.5 + Math.sin(lf[i]) * 0.3
        ctx.fillStyle = rawC[cidx[i]]
        ctx.beginPath(); ctx.arc(px[i], py[i], sz[i], 0, TAU); ctx.fill()
      }
      emitRate = 2
    }

    // ── Stars ─────────────────────────────────────────────────────────────────
    if ef == "stars" {
      spawnFn = fn(i) {
        px[i] = rnd(0, w); py[i] = rnd(0, h)
        vx[i] = rnd(-0.05, 0.05) * spd; vy[i] = rnd(-0.05, 0.05) * spd
        sz[i] = rnd(szMin, szMax); lf[i] = rnd(0, TAU); ml[i] = rnd(0.015, 0.05)
        rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        px[i] += vx[i]; py[i] += vy[i]; lf[i] += ml[i]
        if px[i] < 0 { px[i] = w }; if px[i] > w { px[i] = 0 }
        if py[i] < 0 { py[i] = h }; if py[i] > h { py[i] = 0 }
      }
      drawFn = fn(i) {
        ctx.globalAlpha = 0.2 + Math.abs(Math.sin(lf[i])) * 0.8
        ctx.fillStyle = rawC[cidx[i]]
        ctx.beginPath(); ctx.arc(px[i], py[i], sz[i], 0, TAU); ctx.fill()
      }
      initFn = fn() { prefill() }
    }

    // ── Bubbles ───────────────────────────────────────────────────────────────
    if ef == "bubbles" {
      spawnFn = fn(i) {
        px[i] = rnd(w * 0.2, w * 0.8); py[i] = h + rnd(0, 10)
        vx[i] = rnd(-0.3, 0.3); vy[i] = rnd(-1.5, -0.5) * spd
        sz[i] = rnd(szMin, szMax); lf[i] = lifeN; ml[i] = lifeN
        rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        px[i] += vx[i] + Math.sin(py[i] * 0.04) * 0.3
        py[i] += vy[i]; lf[i] -= 1
        if py[i] < -10 || lf[i] <= 0 { kill(i) }
      }
      drawFn = fn(i) {
        ctx.globalAlpha = (lf[i] / ml[i]) * 0.7
        ctx.strokeStyle = rawC[cidx[i]]; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(px[i], py[i], sz[i], 0, TAU); ctx.stroke()
      }
      emitRate = 1
    }

    // ── Big Circles ───────────────────────────────────────────────────────────
    if ef == "bigcircles" {
      spawnFn = fn(i) {
        px[i] = rnd(0, w); py[i] = h + rnd(0, 50)
        vx[i] = rnd(-0.5, 0.5); vy[i] = rnd(-2, -1) * spd
        sz[i] = rnd(szMin, szMax); lf[i] = lifeN; ml[i] = lifeN
        rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        px[i] += vx[i]; py[i] += vy[i]; lf[i] -= 1
        if py[i] < -szMax - 10 || lf[i] <= 0 { kill(i) }
      }
      drawFn = fn(i) {
        ctx.globalAlpha = (lf[i] / ml[i]) * 0.5
        ctx.fillStyle = rawC[cidx[i]]
        ctx.beginPath(); ctx.arc(px[i], py[i], sz[i], 0, TAU); ctx.fill()
      }
      emitRate = 0.5
    }

    // ── Ambient ───────────────────────────────────────────────────────────────
    if ef == "ambient" {
      spawnFn = fn(i) {
        px[i] = rnd(0, w); py[i] = rnd(0, h)
        vx[i] = rnd(-0.4, 0.4) * spd; vy[i] = rnd(-0.4, 0.4) * spd
        sz[i] = rnd(szMin, szMax); lf[i] = rnd(0, TAU); ml[i] = rnd(0.01, 0.03)
        rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        px[i] += vx[i]; py[i] += vy[i]; lf[i] += ml[i]
        if px[i] < 0 { px[i] = 0; vx[i] = -vx[i] }
        if px[i] > w { px[i] = w; vx[i] = -vx[i] }
        if py[i] < 0 { py[i] = 0; vy[i] = -vy[i] }
        if py[i] > h { py[i] = h; vy[i] = -vy[i] }
      }
      drawFn = fn(i) {
        ctx.globalAlpha = 0.2 + Math.abs(Math.sin(lf[i])) * 0.6
        ctx.fillStyle = rawC[cidx[i]]
        ctx.beginPath(); ctx.arc(px[i], py[i], sz[i], 0, TAU); ctx.fill()
      }
      initFn = fn() { prefill() }
    }

    // ── Fire ──────────────────────────────────────────────────────────────────
    if ef == "fire" {
      spawnFn = fn(i) {
        px[i] = w * 0.5 + rnd(-w * 0.15, w * 0.15); py[i] = h
        vx[i] = rnd(-0.8, 0.8) * spd; vy[i] = rnd(-3, -1) * spd
        sz[i] = rnd(szMin, szMax); lf[i] = lifeN * rnd(0.3, 1); ml[i] = lf[i]
        rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        vx[i] += rnd(-0.15, 0.15); px[i] += vx[i]; py[i] += vy[i]
        vy[i] -= 0.03; sz[i] *= 0.995; lf[i] -= 1
        if lf[i] <= 0 { kill(i) }
      }
      drawFn = fn(i) {
        ctx.globalAlpha = (lf[i] / ml[i]) * 0.8
        ctx.fillStyle = rawC[cidx[i]]
        ctx.beginPath(); ctx.arc(px[i], py[i], sz[i], 0, TAU); ctx.fill()
      }
      emitRate = 4
    }

    // ── Firefly ───────────────────────────────────────────────────────────────
    if ef == "firefly" {
      spawnFn = fn(i) {
        px[i] = clickX + rnd(-20, 20); py[i] = clickY + rnd(-20, 20)
        vx[i] = rnd(-1, 1) * spd; vy[i] = rnd(-1, 1) * spd
        sz[i] = rnd(szMin, szMax); lf[i] = lifeN; ml[i] = lifeN
        rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        vx[i] += rnd(-0.1, 0.1); vy[i] += rnd(-0.1, 0.1)
        vx[i] *= 0.97; vy[i] *= 0.97
        px[i] += vx[i]; py[i] += vy[i]; lf[i] -= 1
        if lf[i] <= 0 { kill(i) }
      }
      drawFn = fn(i) {
        const a = lf[i] / ml[i]
        ctx.globalAlpha = a * a
        ctx.fillStyle = rawC[cidx[i]]
        ctx.beginPath(); ctx.arc(px[i], py[i], sz[i], 0, TAU); ctx.fill()
      }
      useHover = true
    }

    // ── Fountain ──────────────────────────────────────────────────────────────
    if ef == "fountain" {
      spawnFn = fn(i) {
        px[i] = w * 0.5 + rnd(-10, 10); py[i] = h * 0.85
        const angle = rnd(-2.2, -0.95)
        const speed = rnd(3, 8) * spd
        vx[i] = Math.cos(angle) * speed; vy[i] = Math.sin(angle) * speed
        sz[i] = rnd(szMin, szMax); lf[i] = lifeN; ml[i] = lifeN
        rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        vy[i] += grav || 0.2; px[i] += vx[i]; py[i] += vy[i]; lf[i] -= 1
        if py[i] > h * 0.87 && vy[i] > 0 { vy[i] *= -0.55; vx[i] *= 0.8; sz[i] *= 0.85 }
        if sz[i] < 0.5 || lf[i] <= 0 { kill(i) }
      }
      drawFn = fn(i) {
        ctx.globalAlpha = (lf[i] / ml[i]) * 0.9
        ctx.fillStyle = rawC[cidx[i]]
        ctx.beginPath(); ctx.arc(px[i], py[i], sz[i], 0, TAU); ctx.fill()
      }
      emitRate = 3
    }

    // ── Hyperspace ────────────────────────────────────────────────────────────
    if ef == "hyperspace" {
      spawnFn = fn(i) {
        const angle = Math.random() * TAU
        px[i] = w * 0.5; py[i] = h * 0.5
        const speed = rnd(1, 4) * spd
        vx[i] = Math.cos(angle) * speed; vy[i] = Math.sin(angle) * speed
        sz[i] = rnd(1, 2); lf[i] = lifeN; ml[i] = lifeN
        rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        vx[i] *= 1.035; vy[i] *= 1.035; px[i] += vx[i]; py[i] += vy[i]; lf[i] -= 1
        sz[i] = Math.min(sz[i] + 0.05, 4)
        if px[i] < 0 || px[i] > w || py[i] < 0 || py[i] > h || lf[i] <= 0 { kill(i) }
      }
      drawFn = fn(i) {
        ctx.globalAlpha = lf[i] / ml[i]
        ctx.fillStyle = rawC[cidx[i]]
        ctx.fillRect(px[i] - sz[i] * 0.5, py[i] - sz[i] * 0.5, sz[i], sz[i] * 3)
      }
      emitRate = 3
    }

    // ── Shared confetti draw (setTransform — no save/restore) ─────────────────
    fn confettiDraw(i) {
      ctx.globalAlpha = lf[i] / ml[i]
      ctx.fillStyle = rawC[cidx[i]]
      const c = Math.cos(ag[i]); const s = Math.sin(ag[i])
      ctx.setTransform(c * dpr, s * dpr, -s * dpr, c * dpr, px[i] * dpr, py[i] * dpr)
      const h2 = sz[i] * 0.5
      if sh[i] == 0 { ctx.beginPath(); ctx.arc(0, 0, h2, 0, TAU); ctx.fill() }
      else if sh[i] == 1 { ctx.fillRect(-h2, -h2, sz[i], sz[i]) }
      else { ctx.beginPath(); ctx.moveTo(0, -h2); ctx.lineTo(h2, h2); ctx.lineTo(-h2, h2); ctx.closePath(); ctx.fill() }
    }

    // ── Confetti Falling ──────────────────────────────────────────────────────
    if ef == "confettifall" {
      spawnFn = fn(i) {
        px[i] = rnd(0, w); py[i] = rnd(-20, 0)
        vx[i] = rnd(-1, 1); vy[i] = rnd(1, 3) * spd
        sz[i] = rnd(szMin, szMax); lf[i] = lifeN; ml[i] = lifeN
        ag[i] = Math.random() * TAU; av[i] = rnd(-0.1, 0.1)
        sh[i] = Math.random() < 0.5 ? 1 : 0; rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        px[i] += vx[i] + Math.sin(py[i] * 0.03) * 0.5
        py[i] += vy[i]; ag[i] += av[i]; lf[i] -= 1
        if py[i] > h + 10 || lf[i] <= 0 { kill(i) }
      }
      drawFn = fn(i) { confettiDraw(i) }
      emitRate = 2
    }

    // ── Confetti (click burst) ────────────────────────────────────────────────
    if ef == "confetti" {
      spawnFn = fn(i) {
        px[i] = clickX; py[i] = clickY
        const angle = Math.random() * TAU
        const speed = rnd(4, 12) * spd
        vx[i] = Math.cos(angle) * speed; vy[i] = Math.sin(angle) * speed - 4
        sz[i] = rnd(szMin, szMax); lf[i] = lifeN; ml[i] = lifeN
        ag[i] = Math.random() * TAU; av[i] = rnd(-0.2, 0.2)
        sh[i] = Math.floor(Math.random() * 3); rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        vy[i] += grav || 0.18; vx[i] *= 0.99
        px[i] += vx[i]; py[i] += vy[i]; ag[i] += av[i]; lf[i] -= 1
        if py[i] > h + 20 || lf[i] <= 0 { kill(i) }
      }
      drawFn = fn(i) { confettiDraw(i) }
      useClick = true
    }

    // ── Confetti Cannon ───────────────────────────────────────────────────────
    if ef == "confetticannon" {
      spawnFn = fn(i) {
        px[i] = w * 0.5; py[i] = h
        const angle = rnd(-2.4, -0.7)
        const speed = rnd(5, 14) * spd
        vx[i] = Math.cos(angle) * speed; vy[i] = Math.sin(angle) * speed
        sz[i] = rnd(szMin, szMax); lf[i] = lifeN; ml[i] = lifeN
        ag[i] = Math.random() * TAU; av[i] = rnd(-0.25, 0.25)
        sh[i] = Math.floor(Math.random() * 3); rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        vy[i] += grav || 0.2; vx[i] *= 0.99
        px[i] += vx[i]; py[i] += vy[i]; ag[i] += av[i]; lf[i] -= 1
        if py[i] > h + 20 || lf[i] <= 0 { kill(i) }
      }
      drawFn = fn(i) { confettiDraw(i) }
      emitRate = 2
    }

    // ── Confetti Explosions (click) ───────────────────────────────────────────
    if ef == "confettiex" {
      spawnFn = fn(i) {
        px[i] = clickX; py[i] = clickY
        const angle = Math.random() * TAU
        const speed = rnd(8, 22) * spd
        vx[i] = Math.cos(angle) * speed; vy[i] = Math.sin(angle) * speed - 6
        sz[i] = rnd(szMin, szMax); lf[i] = lifeN * 0.6; ml[i] = lf[i]
        ag[i] = Math.random() * TAU; av[i] = rnd(-0.3, 0.3)
        sh[i] = Math.floor(Math.random() * 3); rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        vy[i] += grav || 0.28; vx[i] *= 0.97
        px[i] += vx[i]; py[i] += vy[i]; ag[i] += av[i]; lf[i] -= 1
        if py[i] > h + 20 || lf[i] <= 0 { kill(i) }
      }
      drawFn = fn(i) { confettiDraw(i) }
      useClick = true
    }

    // ── Confetti Parade (dual emitter) ────────────────────────────────────────
    if ef == "confettiparade" {
      let side = 0
      spawnFn = fn(i) {
        side = 1 - side
        if side == 0 {
          px[i] = rnd(0, w * 0.05); py[i] = rnd(h * 0.2, h * 0.5)
          const angle = rnd(-0.6, 0.2); const speed = rnd(6, 14) * spd
          vx[i] = Math.cos(angle) * speed; vy[i] = Math.sin(angle) * speed
        } else {
          px[i] = rnd(w * 0.95, w); py[i] = rnd(h * 0.2, h * 0.5)
          const angle = rnd(2.9, 3.7); const speed = rnd(6, 14) * spd
          vx[i] = Math.cos(angle) * speed; vy[i] = Math.sin(angle) * speed
        }
        sz[i] = rnd(szMin, szMax); lf[i] = lifeN; ml[i] = lifeN
        ag[i] = Math.random() * TAU; av[i] = rnd(-0.25, 0.25)
        sh[i] = Math.floor(Math.random() * 3); rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        vy[i] += grav || 0.18; vx[i] *= 0.99
        px[i] += vx[i]; py[i] += vy[i]; ag[i] += av[i]; lf[i] -= 1
        if py[i] > h + 20 || lf[i] <= 0 { kill(i) }
      }
      drawFn = fn(i) { confettiDraw(i) }
      emitRate = 3
    }

    // ── Links ─────────────────────────────────────────────────────────────────
    if ef == "links" {
      spawnFn = fn(i) {
        px[i] = rnd(0, w); py[i] = rnd(0, h)
        vx[i] = rnd(-0.5, 0.5) * spd; vy[i] = rnd(-0.5, 0.5) * spd
        sz[i] = rnd(szMin, szMax); rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        px[i] += vx[i]; py[i] += vy[i]
        if px[i] < 0 { px[i] = 0; vx[i] = -vx[i] }
        if px[i] > w { px[i] = w; vx[i] = -vx[i] }
        if py[i] < 0 { py[i] = 0; vy[i] = -vy[i] }
        if py[i] > h { py[i] = h; vy[i] = -vy[i] }
      }
      drawFn = fn(i) {
        ctx.globalAlpha = 0.8; ctx.fillStyle = rawC[cidx[i]]
        ctx.beginPath(); ctx.arc(px[i], py[i], sz[i], 0, TAU); ctx.fill()
      }
      // Squared distance avoids sqrt in the outer check
      postFn = fn() {
        ctx.lineWidth = 1
        let i = 0
        while i < P {
          if al[i] {
            let j = i + 1
            while j < P {
              if al[j] {
                const dx = px[i] - px[j]; const dy = py[i] - py[j]
                const d2 = dx * dx + dy * dy
                if d2 < linkD2 {
                  ctx.globalAlpha = (1 - Math.sqrt(d2) / linkD) * 0.6
                  ctx.strokeStyle = rawC[cidx[i]]
                  ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(px[j], py[j]); ctx.stroke()
                }
              }
              j += 1
            }
          }
          i += 1
        }
      }
      initFn = fn() { prefill() }
    }

    // ── Triangles ─────────────────────────────────────────────────────────────
    if ef == "triangles" {
      spawnFn = fn(i) {
        px[i] = rnd(0, w); py[i] = rnd(0, h)
        vx[i] = rnd(-0.6, 0.6) * spd; vy[i] = rnd(-0.6, 0.6) * spd
        sz[i] = rnd(szMin, szMax); rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        px[i] += vx[i]; py[i] += vy[i]
        if px[i] < 0 { px[i] = 0; vx[i] = -vx[i] }
        if px[i] > w { px[i] = w; vx[i] = -vx[i] }
        if py[i] < 0 { py[i] = 0; vy[i] = -vy[i] }
        if py[i] > h { py[i] = h; vy[i] = -vy[i] }
      }
      drawFn = fn(i) {
        ctx.globalAlpha = 0.8; ctx.fillStyle = rawC[cidx[i]]
        ctx.beginPath(); ctx.arc(px[i], py[i], sz[i], 0, TAU); ctx.fill()
      }
      // All distance comparisons use squared distance — sqrt only on confirmed pairs/triplets
      postFn = fn() {
        ctx.lineWidth = 1
        let i = 0
        while i < P {
          if al[i] {
            let j = i + 1
            while j < P {
              if al[j] {
                const dxij = px[i] - px[j]; const dyij = py[i] - py[j]
                const d2ij = dxij * dxij + dyij * dyij
                if d2ij < linkD2 {
                  ctx.globalAlpha = (1 - Math.sqrt(d2ij) / linkD) * 0.5
                  ctx.strokeStyle = rawC[cidx[i]]
                  ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(px[j], py[j]); ctx.stroke()
                  let k = j + 1
                  while k < P {
                    if al[k] {
                      const dxik = px[i] - px[k]; const dyik = py[i] - py[k]
                      const dxjk = px[j] - px[k]; const dyjk = py[j] - py[k]
                      if dxik * dxik + dyik * dyik < linkD2 && dxjk * dxjk + dyjk * dyjk < linkD2 {
                        ctx.globalAlpha = 0.07; ctx.fillStyle = rawC[cidx[i]]
                        ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(px[j], py[j]); ctx.lineTo(px[k], py[k]); ctx.closePath(); ctx.fill()
                      }
                    }
                    k += 1
                  }
                }
              }
              j += 1
            }
          }
          i += 1
        }
      }
      initFn = fn() { prefill() }
    }

    // ── Squares ───────────────────────────────────────────────────────────────
    if ef == "squares" {
      spawnFn = fn(i) {
        px[i] = w * 0.5; py[i] = h * 0.5
        sz[i] = 1; ml[i] = szMax; ag[i] = Math.random() * TAU; av[i] = rnd(-0.01, 0.01)
        rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        sz[i] += spd * 2.5; ag[i] += av[i]
        if sz[i] > ml[i] { kill(i) }
      }
      drawFn = fn(i) {
        ctx.globalAlpha = (1 - sz[i] / ml[i]) * 0.8
        ctx.strokeStyle = rawC[cidx[i]]; ctx.lineWidth = 3
        const c = Math.cos(ag[i]); const s = Math.sin(ag[i])
        ctx.setTransform(c * dpr, s * dpr, -s * dpr, c * dpr, px[i] * dpr, py[i] * dpr)
        ctx.strokeRect(-sz[i] * 0.5, -sz[i] * 0.5, sz[i], sz[i])
      }
    }

    // ── Sea Anemone ───────────────────────────────────────────────────────────
    if ef == "seaanemone" {
      spawnFn = fn(i) {
        ag[i] = Math.random() * TAU
        px[i] = w * 0.5; py[i] = h * 0.5
        vx[i] = Math.cos(ag[i]) * spd; vy[i] = Math.sin(ag[i]) * spd
        av[i] = rnd(-0.04, 0.04)
        sz[i] = rnd(szMin, szMax); lf[i] = lifeN; ml[i] = lifeN
        rndC(i); al[i] = 1
      }
      updateFn = fn(i) {
        // Rotate direction angle and rebuild velocity — oscillates outward in curves
        ag[i] += av[i]
        const speed = rnd(0.5, 2) * spd
        vx[i] = Math.cos(ag[i]) * speed; vy[i] = Math.sin(ag[i]) * speed
        px[i] += vx[i]; py[i] += vy[i]; lf[i] -= 1
        if px[i] < 0 || px[i] > w || py[i] < 0 || py[i] > h || lf[i] <= 0 { kill(i) }
      }
      drawFn = fn(i) {
        ctx.globalAlpha = (lf[i] / ml[i]) * 0.85
        ctx.fillStyle = rawC[cidx[i]]
        ctx.beginPath(); ctx.arc(px[i], py[i], sz[i], 0, TAU); ctx.fill()
      }
      emitRate = 2
    }

    // ── Frame loop ────────────────────────────────────────────────────────────
    fn frame() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if trailA > 0 {
        ctx.fillStyle = "rgba(0,0,0," + trailA + ")"
        ctx.fillRect(0, 0, w, h)
      } else {
        ctx.clearRect(0, 0, w, h)
      }

      // squaresMode flag avoids per-frame string compare
      if squaresMode {
        ticker += 1
        if ticker > 60 { ticker = 0; const s = slot(); if s >= 0 { spawnFn(s) } }
      } else if emitRate > 0 {
        emitAcc += emitRate
        while emitAcc >= 1 {
          const s = slot()
          if s >= 0 { spawnFn(s); emitAcc -= 1 } else { emitAcc = 0 }
        }
      }

      let i = 0
      while i < P {
        if al[i] { updateFn(i); if al[i] { drawFn(i) } }
        i += 1
      }

      // Reset transform after confetti/squares may have used setTransform
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalAlpha = 1
      postFn()
      requestAnimationFrame(frame)
    }

    if fullscr {
      canvas.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;pointer-events:none;display:block"
    } else {
      canvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;display:block"
    }

    fn resize() {
      dpr = window.devicePixelRatio || 1
      if fullscr {
        w = window.innerWidth; h = window.innerHeight
      } else {
        const par = canvas.parentElement
        w = par.clientWidth || canvas.clientWidth
        h = par.clientHeight || canvas.clientHeight
      }
      canvas.width = w * dpr; canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    if useClick {
      const tgt = fullscr ? window : canvas
      tgt.addEventListener("click", fn(e) {
        const r = canvas.getBoundingClientRect()
        clickX = e.clientX - r.left; clickY = e.clientY - r.top
        let b = 0
        while b < emitN { const s = slot(); if s >= 0 { spawnFn(s) }; b += 1 }
      })
    }

    if useHover {
      canvas.style.pointerEvents = "auto"
      canvas.addEventListener("mousemove", fn(e) {
        const r = canvas.getBoundingClientRect()
        clickX = e.clientX - r.left; clickY = e.clientY - r.top
        const s = slot(); if s >= 0 { spawnFn(s) }
      })
    }

    new ResizeObserver(fn() { resize() }).observe(canvas)
    resize()
    initFn()
    requestAnimationFrame(frame)
  }

  document.querySelectorAll("canvas[data-arc-pfx]").forEach(fn(c) { boot(c) })
})()

// ── Widget declarations ───────────────────────────────────────────────────────

widget Snow(colors = ["#ddeeff","#eef4ff","#ffffff","#cce8ff"], speed = 1, sizeMin = 2, sizeMax = 6, pool = 200, fullscreen = true)
  canvas data-arc-pfx="snow" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-fullscreen=@fullscreen

widget Stars(colors = ["#ffffff","#ffe4b5","#add8e6","#ffd700"], speed = 1, sizeMin = 1, sizeMax = 2, pool = 120, fullscreen = true)
  canvas data-arc-pfx="stars" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-fullscreen=@fullscreen

widget Bubbles(colors = ["#88ccff","#aaddff","#cceeff","#ffffff"], speed = 1, sizeMin = 4, sizeMax = 14, pool = 80, life = 220, fullscreen = true)
  canvas data-arc-pfx="bubbles" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-life=@life data-pfx-fullscreen=@fullscreen

widget BigCircles(colors = ["#ff4444","#ff8800","#ffee00","#00cc66","#0099ff","#cc44ff"], speed = 1, sizeMin = 80, sizeMax = 200, pool = 30, life = 300, fullscreen = true)
  canvas data-arc-pfx="bigcircles" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-life=@life data-pfx-fullscreen=@fullscreen

widget Ambient(colors = ["#00e5ff","#80eeff","#b3f5ff"], speed = 1, sizeMin = 3, sizeMax = 15, pool = 150, fullscreen = true)
  canvas data-arc-pfx="ambient" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-fullscreen=@fullscreen

widget Fire(colors = ["#ff9900","#ff6600","#ff3300","#ffcc00","#cc3300"], speed = 1, sizeMin = 3, sizeMax = 8, pool = 200, life = 80, fullscreen = true)
  canvas data-arc-pfx="fire" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-life=@life data-pfx-fullscreen=@fullscreen

widget Firefly(colors = ["#ffffaa","#aaffaa","#aaaaff","#ffaaff"], speed = 1, sizeMin = 3, sizeMax = 6, pool = 60, life = 90, fullscreen = true)
  canvas data-arc-pfx="firefly" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-life=@life data-pfx-fullscreen=@fullscreen

widget Fountain(colors = ["#0099ff","#00ccff","#33aaff","#66bbff","#99ccff"], speed = 1, sizeMin = 3, sizeMax = 7, pool = 150, life = 160, fullscreen = true)
  canvas data-arc-pfx="fountain" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-life=@life data-pfx-fullscreen=@fullscreen

widget Hyperspace(colors = ["#ffffff","#aaddff","#ffaaaa","#aaffaa"], speed = 1, sizeMin = 1, sizeMax = 2, pool = 200, life = 120, trail = 0.15, fullscreen = true)
  canvas data-arc-pfx="hyperspace" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-life=@life data-pfx-trail=@trail data-pfx-fullscreen=@fullscreen

widget ConfettiFalling(colors = ["#ff4545","#ffa500","#ffff00","#00ff88","#00b4ff","#ff69b4","#cc44ff"], speed = 1, sizeMin = 4, sizeMax = 10, pool = 150, life = 300, fullscreen = true)
  canvas data-arc-pfx="confettifall" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-life=@life data-pfx-fullscreen=@fullscreen

widget Confetti(colors = ["#ff4545","#ffa500","#ffff00","#00ff88","#00b4ff","#ff69b4","#cc44ff"], speed = 1, sizeMin = 5, sizeMax = 10, pool = 200, life = 180, emit = 60, fullscreen = true)
  canvas data-arc-pfx="confetti" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-life=@life data-pfx-emit=@emit data-pfx-fullscreen=@fullscreen

widget ConfettiCannon(colors = ["#ff4545","#ffa500","#ffff00","#00ff88","#00b4ff","#ff69b4","#cc44ff"], speed = 1, sizeMin = 4, sizeMax = 9, pool = 200, life = 200, fullscreen = true)
  canvas data-arc-pfx="confetticannon" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-life=@life data-pfx-fullscreen=@fullscreen

widget ConfettiExplosions(colors = ["#ff4545","#ffa500","#ffff00","#00ff88","#00b4ff","#ff69b4","#cc44ff"], speed = 1, sizeMin = 5, sizeMax = 10, pool = 300, life = 150, emit = 80, fullscreen = true)
  canvas data-arc-pfx="confettiex" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-life=@life data-pfx-emit=@emit data-pfx-fullscreen=@fullscreen

widget ConfettiParade(colors = ["#ff4545","#ffa500","#ffff00","#00ff88","#00b4ff","#ff69b4","#cc44ff"], speed = 1, sizeMin = 4, sizeMax = 9, pool = 200, life = 200, fullscreen = true)
  canvas data-arc-pfx="confettiparade" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-life=@life data-pfx-fullscreen=@fullscreen

widget Links(colors = ["#ffffff"], speed = 1, sizeMin = 2, sizeMax = 3, pool = 80, linkDist = 130, fullscreen = true)
  canvas data-arc-pfx="links" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-link-dist=@linkDist data-pfx-fullscreen=@fullscreen

widget Triangles(colors = ["#ffffff"], speed = 1, sizeMin = 2, sizeMax = 3, pool = 60, linkDist = 120, fullscreen = true)
  canvas data-arc-pfx="triangles" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-link-dist=@linkDist data-pfx-fullscreen=@fullscreen

widget Squares(colors = ["#ff4545","#ffa500","#ffff00","#00ff88","#00b4ff","#ff69b4","#cc44ff"], speed = 1, sizeMax = 400, pool = 20, fullscreen = true)
  canvas data-arc-pfx="squares" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-fullscreen=@fullscreen

widget SeaAnemone(colors = ["#ff3333","#ff6666","#ff9999","#cc0000","#ff0000"], speed = 1, sizeMin = 3, sizeMax = 7, pool = 120, life = 180, trail = 0.08, fullscreen = true)
  canvas data-arc-pfx="seaanemone" data-pfx-colors=@colors data-pfx-speed=@speed data-pfx-size-min=@sizeMin data-pfx-size-max=@sizeMax data-pfx-pool=@pool data-pfx-life=@life data-pfx-trail=@trail data-pfx-fullscreen=@fullscreen
