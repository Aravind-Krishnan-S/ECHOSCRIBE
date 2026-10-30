# EchoScribe web app

React 19 + TypeScript + Vite + Tailwind CSS v4. The server (`../src`) serves the built app from `dist/`.

```bash
npm install
npm run dev     # Vite dev server on :5173, proxying /api to the server on :3000
npm run build   # type-check and build to dist/
```

Design notes are in [DESIGN.md](DESIGN.md) and [PRODUCT.md](PRODUCT.md).
