# EUR/HUF Árfolyam - eurhuf.info

Élő devizaárfolyamok megjelenítése és valutaváltó kalkulátor.

## Funkciók

- **Élő árfolyamok**: EUR/HUF, USD/HUF, GBP/HUF, CHF/HUF
- **Valutaváltó kalkulátor**: Tetszőleges összeg átváltása
- **Drag & drop**: Devizakártyák átrendezése
- **Sötét/világos mód**: Téma váltása

## Technológiák

- **React 18** + TypeScript
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **@dnd-kit** - Drag and drop
- **Lucide React** - Icons

## Telepítés

```bash
npm install
```

## Futtatás (Development)

```bash
npm run dev
```

Megnyitható: http://localhost:5173

## Build (Production)

```bash
npm run build
```

Build output: `dist/` mappa

## Deploy (Render.com)

1. GitHub repo létrehozása és push
2. Render.com-on új Static Site
3. Build Command: `npm run build`
4. Publish Directory: `dist`

## Licensz

© 2026 Minusz - Minden jog fenntartva
