import QRCode from "../../stdlib/qrcode"

page "QR Code"

  main
    col gap=32px p=32px

    h1 "Arc QRCode"

    // Static QR codes — rendered with zero extra client JS
    section
      h2 "Static"
      row gap=24px align=center wrap=true
        QRCode value="https://arc.codes"
        QRCode value="https://arc.codes" size=160 dark="#0d1117" light="#f6f8fa"
        QRCode value="https://arc.codes" size=160 dark="#1a1a2e" light="#eef"

    // Error correction levels — L (7%), M (15%), Q (25%), H (30%)
    section
      h2 "Error correction levels"
      row gap=24px align=center wrap=true
        col align=center gap=8px
          QRCode value="https://arc.codes" size=120 level="L"
          span "L — 7%"
        col align=center gap=8px
          QRCode value="https://arc.codes" size=120 level="M"
          span "M — 15%"
        col align=center gap=8px
          QRCode value="https://arc.codes" size=120 level="Q"
          span "Q — 25%"
        col align=center gap=8px
          QRCode value="https://arc.codes" size=120 level="H"
          span "H — 30%"

    // Custom values
    section
      h2 "Custom values"
      row gap=24px align=center wrap=true
        col align=center gap=8px
          QRCode value="mailto:hello@arc.codes" size=160 level="M"
          span "email"
        col align=center gap=8px
          QRCode value="tel:+15555550100" size=160 level="M"
          span "phone"
        col align=center gap=8px
          QRCode value="BEGIN:VCARD\nVERSION:3.0\nFN:Arc Demo\nEND:VCARD" size=160 level="Q"
          span "vCard"

  design
    main
      max-width: 900px
      margin: 0 auto
      font-family: system-ui, sans-serif
    h1
      font-size: 2rem
      font-weight: 700
      margin-bottom: 8px
    h2
      font-size: 1.1rem
      font-weight: 600
      color: #555
      margin-bottom: 16px
    section
      padding: 24px 0
      border-top: 1px solid #eee
    span
      font-size: 0.8rem
      color: #666
