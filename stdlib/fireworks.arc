// Arc Fireworks — polished canvas particle system with near-zero overhead.
// Engine uses pre-allocated typed arrays and direct Canvas 2D API calls.
// Zero GC during animation, zero framework runtime.
//
// Usage:
//   import Fireworks from "../../stdlib/fireworks"
//   Fireworks                          // full-page overlay, click to launch
//   Fireworks autoLaunch=true          // auto-fires every 2.5s
//   Fireworks fullscreen=false         // embedded in its container
//
// Programmatic trigger (any time after page load):
//   window.arcFwLaunch(x, y)

// Engine state — hoisted at parse time, initialized at page load.
// Config is read from canvas data-fw-* attributes baked in by the widget.
@state let _fw = (fn() {
  const canvas = document.getElementById("arc-fw")
  if !canvas { return null }
  if window.matchMedia("(prefers-reduced-motion: reduce)").matches { return null }

  const ds = canvas.dataset
  const fullscreen = ds.fwFullscreen != undefined
  const colors = ds.fwColors.split(",")
  const gravity = parseFloat(ds.fwGravity)
  const particleCount = parseInt(ds.fwParticleCount)
  const autoLaunch = ds.fwAutoLaunch != undefined
  const autoInterval = parseInt(ds.fwAutoInterval)
  const trailAlpha = parseFloat(ds.fwTrailAlpha)

  // Pre-allocated typed array pool — zero object creation per frame.
  const POOL = 500
  const posX = new Float32Array(POOL)
  const posY = new Float32Array(POOL)
  const velX = new Float32Array(POOL)
  const velY = new Float32Array(POOL)
  const life = new Float32Array(POOL)
  const sz = new Float32Array(POOL)
  const cidx = new Uint8Array(POOL)
  const alive = new Uint8Array(POOL)

  const ctx = canvas.getContext("2d")
  let w = 0
  let h = 0

  fn resize() {
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    w = rect.width
    h = rect.height
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  fn launch(lx, ly) {
    let spawned = 0
    let i = 0
    while spawned < particleCount && i < POOL {
      if !alive[i] {
        const angle = Math.random() * 6.28318
        const speed = 2 + Math.random() * 6
        velX[i] = Math.cos(angle) * speed
        velY[i] = Math.sin(angle) * speed - 3
        posX[i] = lx
        posY[i] = ly
        life[i] = 0.7 + Math.random() * 0.3
        sz[i] = 2 + Math.random() * 3
        cidx[i] = Math.floor(Math.random() * colors.length)
        alive[i] = 1
        spawned += 1
      }
      i += 1
    }
  }

  fn frame() {
    ctx.fillStyle = "rgba(0,0,0," + trailAlpha + ")"
    ctx.fillRect(0, 0, w, h)
    let i = 0
    while i < POOL {
      if alive[i] {
        velY[i] += gravity
        velX[i] *= 0.99
        posX[i] += velX[i]
        posY[i] += velY[i]
        life[i] -= 0.015
        if life[i] <= 0 {
          alive[i] = 0
        } else {
          ctx.globalAlpha = life[i]
          ctx.fillStyle = colors[cidx[i]]
          ctx.fillRect(posX[i], posY[i], sz[i], sz[i])
        }
      }
      i += 1
    }
    ctx.globalAlpha = 1
    requestAnimationFrame(frame)
  }

  if fullscreen {
    canvas.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;pointer-events:none;display:block"
    window.addEventListener("click", fn(e) { launch(e.clientX, e.clientY) })
  } else {
    canvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:auto;display:block"
    canvas.addEventListener("click", fn(e) {
      const r = canvas.getBoundingClientRect()
      launch(e.clientX - r.left, e.clientY - r.top)
    })
  }

  if autoLaunch {
    setInterval(fn() { launch(Math.random() * w, Math.random() * h * 0.7) }, autoInterval)
  }

  new ResizeObserver(fn() { resize() }).observe(canvas)
  window.arcFwLaunch = launch
  resize()
  requestAnimationFrame(frame)
  return launch
})()

widget Fireworks(fullscreen = true, colors = ["#ff4545","#ffa500","#ffff00","#00ff88","#00b4ff","#ff69b4","#cc44ff"], gravity = 0.06, particleCount = 80, autoLaunch = false, autoInterval = 2500, trailAlpha = 0.18)
  canvas id="arc-fw" aria-hidden="true" data-fw-fullscreen=@fullscreen data-fw-colors=@colors data-fw-gravity=@gravity data-fw-particle-count=@particleCount data-fw-auto-launch=@autoLaunch data-fw-auto-interval=@autoInterval data-fw-trail-alpha=@trailAlpha
