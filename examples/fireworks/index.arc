import Fireworks from "../../stdlib/fireworks"

page "Fireworks"
  meta description="Arc Fireworks — ~2KB particle system. Click anywhere."

  Fireworks autoLaunch=true autoInterval=3000

  main
    center
      col
        h1 "Fireworks"
        text "Click anywhere to launch"
        row
          button on:click={ window.arcFwLaunch && window.arcFwLaunch(window.innerWidth * 0.5, window.innerHeight * 0.4) } "Launch center"
          button on:click={ window.arcFwLaunch && window.arcFwLaunch(Math.random() * window.innerWidth, Math.random() * window.innerHeight * 0.6) } "Random"

  design
    main
      position: relative
      z-index: 1
      min-height: 100vh
      display: flex
      align-items: center
      justify-content: center
      pointer-events: none

    button
      pointer-events: auto
      cursor: pointer

    h1
      color: white
      font-size: 3rem
      text-shadow: 0 2px 20px rgba(0,0,0,0.5)
      margin-bottom: 0.5rem

    p
      color: rgba(255,255,255,0.8)
      margin-bottom: 2rem

    .arc-row
      gap: 1rem

    body
      background: #0a0a0f
      margin: 0
