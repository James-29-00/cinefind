# Cinefind Design

## Color (CSS variables in :root; 9 themes via data-t, default "space")
- Background --bg #0b0b0b, header --hd #121212, card --card #1b1b1b, panel --panel #151515
- Text --tx #f2f0ea, muted --mu #a6a39c, border --bd #2f2f2f
- Accent per theme: --ac, --ac2 (links), --ac3, text-on-accent --onac
- Status: ok #4ade80, bad #f87171, warn #fb923c, unknown #a1a1aa
- Rules: 60% bg, 30% surfaces, 10% accent. No hard-coded colors outside theme blocks. Text contrast >= 4.5:1. Never color alone for meaning.

## Type
- Headings/brand: Newsreader (serif). Body/UI: Instrument Sans. Body 16px, line-height 1.55.

## Spacing and layout
- Scale: 4, 8, 12, 16, 24, 32px. Page max width 1440px. Section gap 72px desktop, 36-48px mobile.
- Cards radius 14px, posters 10px, pills 999px.
- Tap targets >= 44px. Breakpoints: 700px (phone), 960px (tablet).

## Motion
- Short ease-out only. Every animation needs a prefers-reduced-motion fallback.

## Checklist before deploy
- Test 360, 390, 768, 1280. No horizontal scroll. Keyboard focus visible. Lighthouse 90+.
