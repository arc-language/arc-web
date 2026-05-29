import { GradientText } from "../../stdlib/gradient"

page "Gradient Text — Arc"
  meta description="CSS-first gradient text. Zero runtime JS for static. Hardware-accelerated animations."
  meta og:title="Gradient Text — Arc"
  meta og:description="CSS-first gradient text widget for Arc. Zero runtime JS for static use, ~50 bytes for animated."

  main
    section
      h1
        GradientText name="rainbow" "Gradient Text"
      p "Zero runtime JS for static use. ~50 bytes for animated. Hardware-accelerated via CSS."

    section
      h2 "Named Presets"
      div class="preset-grid"
        GradientText name="rainbow" "rainbow"
        GradientText name="sunrise" "sunrise"
        GradientText name="ocean" "ocean"
        GradientText name="fire" "fire"
        GradientText name="neon" "neon"
        GradientText name="aurora" "aurora"
        GradientText name="candy" "candy"
        GradientText name="gold" "gold"

    section
      h2 "Animated"
      div class="preset-grid"
        GradientText name="rainbow" animate=true "rainbow loop"
        GradientText name="neon" animate=true duration="2s" "neon fast"
        GradientText name="aurora" animate=true duration="6s" "aurora slow"
        GradientText name="fire" animate=true duration="3s" direction="135deg" "fire diagonal"

    section
      h2 "Custom Colors"
      div class="preset-grid"
        GradientText colors=["#6366f1","#8b5cf6","#d946ef"] "indigo violet"
        GradientText colors=["#10b981","#06b6d4"] direction="45deg" "teal 45deg"
        GradientText colors=["#f43f5e","#fb923c","#facc15"] animate=true "custom animated"

    section
      h2 "gradient-text CSS shorthand"
      p "Apply directly in any design block — no widget import needed."
      div class="shorthand-row"
        span class="ex-rainbow" "rainbow"
        span class="ex-angled" "135deg custom"
        span class="ex-ocean" "ocean"
        span class="ex-shimmer" "shimmer"

  design
    main
      max-w: 900px
      m: 0 auto
      p: 48px 24px
      col gap=56

    section
      col gap=20

    h1
      size: 3.5rem
      weight: bold
      line: tight

    h2
      size: 1.25rem
      weight: semibold
      fg: #6b7280

    p
      fg: #374151
      line: relaxed

    .preset-grid
      display: grid
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))
      gap: 16px

    .arc-gt
      size: 1.875rem
      weight: bold
      line: tight

    .shorthand-row
      row gap=24px
      flex: wrap

    .ex-rainbow
      gradient-text: rainbow
      size: 1.875rem
      weight: bold
      display: inline-block

    .ex-angled
      gradient-text: 135deg, #6366f1, #d946ef
      size: 1.875rem
      weight: bold
      display: inline-block

    .ex-ocean
      gradient-text: ocean
      size: 1.875rem
      weight: bold
      display: inline-block

    .ex-shimmer
      gradient-text: #f59e0b, #fbbf24, #fde68a, #f59e0b
      size: 1.875rem
      weight: bold
      display: inline-block
