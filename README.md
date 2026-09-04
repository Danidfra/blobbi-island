# Blobbi Island

A Nostr client application built with React 18.x, TailwindCSS 3.x, Vite, and Nostrify.

## Getting Started

### Prerequisites

- **Node.js 24 LTS**: the exact version is pinned in [`.nvmrc`](./.nvmrc), so
  `nvm use` (or any version manager that reads it) selects it for you.
  `package.json` declares `engines.node: ">=24 <25"`; the arcade's Pool physics
  engine, [planck](https://www.npmjs.com/package/planck), requires Node 24.
- npm 11 or later (bundled with Node 24)

### Development

Install dependencies once, and again whenever `package-lock.json` changes:

```bash
npm ci
```

Start the development server:

```bash
npm run dev
```

The application will be available at `http://localhost:8080`

### Production

Build for production:

```bash
npm run build
```

## Screenshots

<img width="1915" height="1009" alt="blobbi island homescreen" src="https://github.com/user-attachments/assets/1f25b4f8-eaf7-4c27-8d82-1ee013f03d89" />  

<img width="1915" height="1009" alt="image" src="https://github.com/user-attachments/assets/499f47be-283e-45b0-86c9-c40d467f83b6" />

## License

This project is licensed under the MIT License.
