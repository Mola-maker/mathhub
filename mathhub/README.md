# MathHub landing frontend

This workspace is the single landing-page source for Math GeoHub. It is not a
second public application: Vite emits the static artifact to
`../public/mathhub/`, and the root Next.js service exposes it at the canonical
`/` URL. Studio gateways are relative same-origin links to `/math` and `/tikz`.

Run from the repository root:

```powershell
npm run dev:mathhub
```

The Vite port is an internal development origin. Browse the product through
<http://localhost:3000> with `MATHHUB_DEV_ORIGIN=http://127.0.0.1:5173`.

The root production build runs this workspace automatically before `next build`.

## Original Vite notes

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
