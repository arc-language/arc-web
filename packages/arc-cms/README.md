# @arc-lang/arc-cms

First-class admin panel + headless CMS for [Arc](https://arc-language.dev) apps. Built on [`@arc-lang/arc-ui`](https://github.com/arc-language/arc-ui).

## Install

```bash
npm install @arc-lang/arc-cms
arc cms init
```

This scaffolds the parts you'll customize and imports the rest live from the package.

**Scaffolded** (copied into your project — yours to edit):
- `admin/` — admin pages (dashboard, users, groups, pages, blocks, media, settings, profile)
- `site/cms/CmsLayout.arc`, `site/cms/CmsPageHeader.arc` — chrome widgets (almost every project rebrands these)
- `site/cms/theme.arc` — brand CSS variables
- `cms.config.arc` — site-level config
- `server/cms/` — auth guard + audit log helpers
- `server/block-types.json` — default block schemas

**Live from package** (imported via `@arc-cms/widgets/...` alias — `npm update` ships bug fixes):
- `CmsField`, `CmsEmpty`, `CmsConfirm` — atomic widgets that rarely need customization

## Customizing a package-owned widget

Use the alias as-is, or eject one file for local override:

```bash
arc cms eject CmsField
```

That copies `CmsField.arc` into `site/cms/widgets/`. The resolver checks `site/cms/widgets/` first, then falls back to the package — so your local copy now wins. Eject only what you need to change; the rest keep tracking the package.

## Branding

After `arc cms init`, edit `site/cms/theme.arc`:

```arc
design
  :root
    --brand-from: #ff6b00      # gradient start (logo, active states)
    --brand-to: #ffd60a        # gradient end
    --brand-accent: #c2410c    # solid accent (links, focus rings)
```

That's it. Both the public site and the admin panel pick this up automatically.
arc-ui ships sensible cyan/violet defaults — the admin looks polished out of the box.

For finer surface control (`--ui-bg`, `--ui-fg`, borders), see the
[arc-ui Theming guide](https://github.com/arc-language/arc-ui#theming).

## What you get

- Users, groups, role-based access — backed by your existing `User`/`Group` models
- Page-builder UI — pages are groups of typed blocks, edited via per-type forms (no JSON textareas)
- Live preview iframe in the block editor
- Media library with image picker
- Audit log of every mutation
- Confirm modals before destructive actions
- Toast notifications for success/error
- Server-side route protection for all `/admin/*` paths

## Layout

```
your-app/
  admin/                 # admin pages (scaffolded — yours to customize)
  site/cms/
    CmsLayout.arc        # chrome — scaffolded, yours to customize
    CmsPageHeader.arc    # ditto
    theme.arc            # brand variables
    widgets/             # only appears here when you `arc cms eject <Name>`
  server/block-types.json
  server/cms/            # auth-guard, audit-log (scaffolded)
  cms.config.arc         # custom block types, branding
  node_modules/@arc-lang/arc-cms/  # CmsField, CmsEmpty, CmsConfirm live here
```

Admin pages import atomic widgets via the package alias:

```arc
import CmsField from "@arc-cms/widgets/CmsField.arc"
import CmsEmpty from "@arc-cms/widgets/CmsEmpty.arc"
```

The resolver checks `site/cms/widgets/<Name>.arc` first (eject), then falls back to the package source. Layout widgets stay on local imports because everyone customizes them:

```arc
import CmsLayout from "site/cms/CmsLayout.arc"
```

## License

MIT
