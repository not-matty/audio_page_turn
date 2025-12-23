# Page Turn Studio (Local-Only Sheet Viewer)

Local-first sheet music viewer focused on performance-friendly page turning. Runs entirely in the browser (offline capable) with no cloud services or accounts.

## Audio-Driven Page Turning (Planned)
The long-term goal is reliable, safe page turning driven by live audio analysis, fully on-device:
- Build a local fingerprint index from synthetic audio (score-derived) and/or a user-supplied reference recording.
- Stream microphone audio, extract rolling fingerprints, and retrieve top candidate score positions.
- Track position with a multi-hypothesis graph-aware localizer that respects repeats, DS/DC, and coda jumps.
- Gate page turns through configurable page-turn windows plus confidence thresholds and continuity checks.
- Support modes: follow master score, follow part, and hybrid gating.

## Getting Started

From the `web/` folder, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Tech Stack
- Next.js (App Router) + React + TypeScript
- PDF rendering: `pdfjs-dist` (PDF.js)
- Styling: plain CSS

## Roadmap (High Level)
Phase 1 (MVP)
- PDF import, local storage, and performance viewer refinements.
- Page-turn window authoring and per-document persistence.

Phase 2
- MusicXML/MIDI import.
- Score navigation graph (repeats, DS/DC/coda).
- Score-to-PDF mapping tools.

Phase 3+
- Synthetic reference indexing and measure hashing.
- Live audio localization with safe page-turn gating.
- Hybrid master/part following modes.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
