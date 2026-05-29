// Arc GradientText — CSS-first gradient text, zero runtime bytes for static use.
// Animated variant: hardware-accelerated CSS background-position trick (~50 bytes JS).
//
// ink-gradient reimagined: ~150KB JS deps → ~50 bytes, terminal ANSI → web CSS,
// no animation support → GPU-composited keyframe animation, no SSR → SSR with fallback.
//
// Usage:
//   import { GradientText } from "arc/gradient"
//   GradientText name="rainbow" "Hello World"
//   GradientText name="ocean" animate=true "Flowing text"
//   GradientText colors=["#6366f1","#d946ef"] "Custom gradient"
//   GradientText name="fire" direction="135deg" duration="2s" animate=true "Fast fire"
//   GradientText name="fire" direction="to bottom right" animate=true "Diagonal"

// NOTE: These presets are duplicated in src/emitters/css.js (GRADIENT_PRESETS const).
// The two copies cannot be consolidated because css.js runs at compile time and this
// module runs at Arc runtime. Keep both in sync when adding or changing presets.
//
// Contrast warning: "sunrise" and "gold" contain #fde68a (yellow, ~1.5:1 on white)
// and "rainbow" contains #ffff00 (1.07:1 on white). Use these only on dark backgrounds
// or ensure the containing element has sufficient contrast for accessibility (WCAG AA).
const PRESETS = {
  "rainbow": "#ff0000,#ff7700,#ffff00,#00ff00,#0077ff,#8b00ff",
  "sunrise": "#f97316,#f59e0b,#fbbf24,#fde68a",
  "ocean":   "#0ea5e9,#06b6d4,#10b981",
  "fire":    "#ef4444,#f97316,#eab308",
  "neon":    "#00f2fe,#4facfe,#a78bfa",
  "aurora":  "#00c6ff,#0072ff,#a855f7",
  "candy":   "#ff6b9d,#c44dff,#4facfe",
  "gold":    "#f59e0b,#fbbf24,#fde68a,#f59e0b"
}

widget GradientText(name = "", colors = ["#ff0000","#ff7700","#ffff00","#00ff00","#0077ff","#8b00ff"], animate = false, direction = "to right", duration = "4s")
  // Guard Array.isArray: colors prop may be passed as a comma-separated string by some callers
  const _colArr = Array.isArray(@colors) ? @colors : String(@colors).split(",")
  const _colStr = @name ? PRESETS[@name] ?? _colArr.join(",") : _colArr.join(",")
  const _bg = "linear-gradient(" + @direction.trim() + "," + _colStr + ")"

  // Values are passed via data-* attributes rather than string interpolation into JS
  // to eliminate XSS risk when colors/direction are user-controlled at runtime.
  span
    class={ @animate ? "arc-gt arc-gt-a" : "arc-gt" }
    data-bg=@_bg
    data-dur=@duration
    slot
    rawscript "const el=document.currentScript.previousElementSibling;if(el){el.style.setProperty('--arc-gt-bg',el.dataset.bg);el.style.setProperty('--arc-gt-dur',el.dataset.dur)}"

  design
    .arc-gt
      display: inline-block
      background: var(--arc-gt-bg, linear-gradient(to right, #ff0000, #ff7700, #ffff00, #00ff00, #0077ff, #8b00ff))
      background-clip: text
      color: transparent

    .arc-gt-a
      background-size: 200% auto
      animate: gradient-shift var(--arc-gt-dur) linear infinite

    // Forced-colors (Windows High Contrast Mode) override: restore text visibility
    // because color:transparent + background-clip:text are both suppressed in this mode.
    media (forced-colors: active)
      .arc-gt
        color: CanvasText
        background: none
        background-clip: unset
        -webkit-background-clip: unset
