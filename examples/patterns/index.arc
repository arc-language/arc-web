page "Native Patterns"
  heading "Zero-JS Interactive Patterns"
  text "All interactions below use zero JavaScript."

  heading "Accordion"
  accordion
    summary "What is Arc?"
    text "Arc is a new language for the web that compiles to zero-JS HTML."

  accordion
    summary "Why no runtime?"
    text "Shipping a runtime means shipping weight. Arc compiles away the framework."

  heading "Modal"
  button trigger="demo-modal" "Open Modal"
  modal id="demo-modal"
    heading "Hello from a native modal"
    text "This dialog uses the browser's built-in <dialog> element."
    button close="demo-modal" "Close"

  heading "Tooltip"
  span tooltip="This is a native tooltip using the Popover API" "Hover over me"
