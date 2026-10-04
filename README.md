# PickleServe™ 21

Single-page site for PickleServe™ 21, the pickleball serve-training target mat by RCI: product overview, game instructions, serving-strategy diagrams, an on-court scorekeeper and a printable scoresheet.

Built with Vite + strict TypeScript, no UI framework and no runtime dependencies. Fonts are self-hosted via `@fontsource`.

## Develop

Requires Node 22.12+ (see `.nvmrc`).

```sh
npm install
npm run dev        # dev server
npm run typecheck  # tsc --noEmit
npm test           # vitest unit tests (scorekeeper model + storage)
npm run build      # production build to dist/
npm run preview    # serve dist/ locally
```

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` runs on every push to `main`: install, typecheck, test, build, then deploy `dist/` with `actions/deploy-pages`. Jekyll is not used.

One-time setup:

1. **Settings → Pages → Source:** GitHub Actions.
2. **Settings → Pages → Custom domain:** `pickleserve21.com`, then enable **Enforce HTTPS** once the certificate is issued. (`public/CNAME` already ships the domain in every build.)
3. **DNS** at your registrar:
   - Apex `A` records → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - Optional `AAAA` records → `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
   - Optional `www` `CNAME` → `<user>.github.io`

`vite.config.ts` uses `base: './'`, so the build also works from the `https://<user>.github.io/pickleserve21/` fallback URL.

## Content

All product and game content comes from `public/pickleserve_21_instructions.pdf` (a copy is served at `/pickleserve_21_instructions.pdf`). Open TODOs are marked with `<!-- TODO -->` in `index.html` (currently: real product photos). The social preview image is `public/og-image.jpg` (1200×630).
