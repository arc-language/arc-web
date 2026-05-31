import Snow from "../../stdlib/particles"
import Stars from "../../stdlib/particles"
import Bubbles from "../../stdlib/particles"
import BigCircles from "../../stdlib/particles"
import Ambient from "../../stdlib/particles"
import Fire from "../../stdlib/particles"
import Firefly from "../../stdlib/particles"
import Fountain from "../../stdlib/particles"
import Hyperspace from "../../stdlib/particles"
import ConfettiFalling from "../../stdlib/particles"
import Confetti from "../../stdlib/particles"
import ConfettiCannon from "../../stdlib/particles"
import ConfettiExplosions from "../../stdlib/particles"
import ConfettiParade from "../../stdlib/particles"
import Links from "../../stdlib/particles"
import Triangles from "../../stdlib/particles"
import Squares from "../../stdlib/particles"
import SeaAnemone from "../../stdlib/particles"

page "Arc Particles"
  meta description="All 18 particle presets — click a card to preview"

  main
    h1 "Arc Particles"
    text "18 presets. ~19 KB. Zero dependencies."

    row
      card
        div class="preview"
          Snow fullscreen=false pool=60 sizeMin=1 sizeMax=4
        span "Snow"
      card
        div class="preview"
          Stars fullscreen=false pool=60
        span "Stars"
      card
        div class="preview"
          Bubbles fullscreen=false pool=30 life=120
        span "Bubbles"
      card
        div class="preview"
          BigCircles fullscreen=false pool=8 sizeMin=30 sizeMax=80 life=200
        span "Big Circles"
      card
        div class="preview"
          Ambient fullscreen=false pool=40 sizeMin=2 sizeMax=8
        span "Ambient"
      card
        div class="preview"
          Fire fullscreen=false pool=80 sizeMin=2 sizeMax=6
        span "Fire"
      card
        div class="preview"
          Firefly fullscreen=false pool=30 life=80
        span "Firefly"
      card
        div class="preview"
          Fountain fullscreen=false pool=60 life=120
        span "Fountain"
      card
        div class="preview"
          Hyperspace fullscreen=false pool=80 life=80
        span "Hyperspace"
      card
        div class="preview"
          ConfettiFalling fullscreen=false pool=60 life=200
        span "Confetti Falling"
      card
        div class="preview"
          Confetti fullscreen=false pool=100 life=120
        span "Confetti"
      card
        div class="preview"
          ConfettiCannon fullscreen=false pool=80 life=140
        span "Confetti Cannon"
      card
        div class="preview"
          ConfettiExplosions fullscreen=false pool=100 life=100
        span "Confetti Explosions"
      card
        div class="preview"
          ConfettiParade fullscreen=false pool=80 life=140
        span "Confetti Parade"
      card
        div class="preview"
          Links fullscreen=false pool=30 linkDist=80
        span "Links"
      card
        div class="preview"
          Triangles fullscreen=false pool=25 linkDist=75
        span "Triangles"
      card
        div class="preview"
          Squares fullscreen=false pool=10 sizeMax=160
        span "Squares"
      card
        div class="preview"
          SeaAnemone fullscreen=false pool=50 life=140
        span "Sea Anemone"

  design
    body
      background: #0a0a14
      margin: 0
      font-family: system-ui, sans-serif
    main
      max-width: 1100px
      margin: 0 auto
      padding: 3rem 1.5rem
    h1
      color: white
      font-size: 2.5rem
      margin-bottom: 0.25rem
    p
      color: rgba(255,255,255,0.5)
      margin-bottom: 2.5rem
    .arc-row
      display: grid
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))
      gap: 1rem
    .arc-card
      background: rgba(255,255,255,0.05)
      border: 1px solid rgba(255,255,255,0.1)
      border-radius: 12px
      overflow: hidden
      transition: border-color 0.2s
    .arc-card:hover
      border-color: rgba(255,255,255,0.3)
    .preview
      position: relative
      height: 140px
      background: #000
    span
      display: block
      padding: 0.6rem 0.9rem
      color: rgba(255,255,255,0.75)
      font-size: 0.85rem
