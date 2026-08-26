// Generates a Scrabble Bags collection:
//   data/bags/sealed.json    PUBLIC  — index, tier, commitment, mint pubkey
//   data/bags/reveals.json   SECRET  — salt + contents per bag (gitignored)
//   data/bags/mints.json     SECRET  — bag NFT keypairs for the bot
//   app/public/bags/*.png    gallery art
// Usage: COUNT=500 GALLERY=24 npx tsx scripts/bags_generate.ts
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { drawContents, SealedBag, BagContents } from '../shared/bags';

const ROOT = path.resolve(import.meta.dirname!, '..');
const OUT = path.join(ROOT, 'data', 'bags');
const ART = path.join(ROOT, 'app', 'public', 'bags');

const TIER_STYLE = {
  common: {
    bg: ['#0d3527', '#05130e'], accent: '#7dedaa', accent2: '#2f8f66',
    gem: '#3a8f6d', label: 'COMMON', rays: false,
  },
  rare: {
    bg: ['#1b2450', '#070b18'], accent: '#9fc2ff', accent2: '#4460c9',
    gem: '#4460c9', label: 'RARE', rays: false,
  },
  legendary: {
    bg: ['#3d1508', '#140502'], accent: '#ffd479', accent2: '#c9862f',
    gem: '#eccb6f', label: 'LEGENDARY', rays: true,
  },
} as const;

function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function tileMotif(x: number, y: number, size: number, letter: string, fill: string, text: string) {
  return `<g><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.16}"
    fill="${fill}" stroke="${text}" stroke-opacity=".55" stroke-width="2"/>
    <text x="${x + size / 2}" y="${y + size * 0.72}" font-family="Georgia,serif" font-weight="900"
      font-size="${size * 0.62}" fill="${text}" text-anchor="middle">${esc(letter)}</text></g>`;
}

function bagSvg(index: number, tier: keyof typeof TIER_STYLE, total: number, preview: string[]): string {
  const st = TIER_STYLE[tier];
  const S = 1024;
  const serial = String(index + 1).padStart(4, '0');
  // deterministic decorative scatter from the index
  let seedNum = (index * 2654435761) >>> 0;
  const rnd = () => ((seedNum = (seedNum * 1664525 + 1013904223) >>> 0) / 2 ** 32);

  const scattered = Array.from({ length: 14 }, (_, i) => {
    const x = 60 + rnd() * (S - 200);
    const y = 120 + rnd() * (S - 320);
    const size = 26 + rnd() * 34;
    const rot = (rnd() * 40 - 20).toFixed(1);
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ*';
    const ch = preview[i % preview.length]?.[0]?.toUpperCase() ?? letters[Math.floor(rnd() * 27)];
    return `<g transform="rotate(${rot} ${x + size / 2} ${y + size / 2})" opacity="${0.12 + rnd() * 0.15}">
      ${tileMotif(x, y, size, ch, st.accent2, '#04110b')}</g>`;
  }).join('');

  const rays = st.rays
    ? `<g opacity=".14">${Array.from({ length: 36 }, (_, i) => {
        const a = (i * 10 * Math.PI) / 180;
        return `<polygon points="512,512 ${(512 + 760 * Math.cos(a - 0.035)).toFixed(0)},${(512 + 760 * Math.sin(a - 0.035)).toFixed(0)} ${(512 + 760 * Math.cos(a + 0.035)).toFixed(0)},${(512 + 760 * Math.sin(a + 0.035)).toFixed(0)}" fill="#e8b95a"/>`;
      }).join('')}<circle cx="512" cy="512" r="430" fill="${st.bg[0]}"/></g>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="85%">
      <stop offset="0%" stop-color="${st.bg[0]}"/><stop offset="100%" stop-color="${st.bg[1]}"/>
    </radialGradient>
    <linearGradient id="foil" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${st.accent}"/><stop offset="45%" stop-color="#ffffff"/>
      <stop offset="55%" stop-color="${st.accent}"/><stop offset="100%" stop-color="${st.accent2}"/>
    </linearGradient>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/>
      <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .05 0"/>
      <feComposite operator="over" in2="SourceGraphic"/></filter>
    <filter id="soft"><feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#000" flood-opacity=".6"/></filter>
  </defs>

  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  ${rays}
  ${scattered}

  <!-- ornate frame -->
  <rect x="42" y="42" width="${S - 84}" height="${S - 84}" rx="36" fill="none"
        stroke="url(#foil)" stroke-width="7"/>
  <rect x="64" y="64" width="${S - 128}" height="${S - 128}" rx="26" fill="none"
        stroke="${st.accent}" stroke-opacity=".45" stroke-width="2"/>
  ${[[84, 84], [S - 84, 84], [84, S - 84], [S - 84, S - 84]].map(([x, y]) =>
    `<circle cx="${x}" cy="${y}" r="13" fill="url(#foil)"/>`).join('')}

  <!-- crest -->
  <g filter="url(#soft)">
    <path d="M512 250 L660 330 L660 520 C660 640 512 720 512 720 C512 720 364 640 364 520 L364 330 Z"
          fill="#071c14" stroke="url(#foil)" stroke-width="8"/>
    <path d="M512 300 L615 355 L615 512 C615 600 512 660 512 660 C512 660 409 600 409 512 L409 355 Z"
          fill="none" stroke="${st.accent}" stroke-opacity=".5" stroke-width="2"/>
    <rect x="437" y="392" width="150" height="150" rx="24" fill="#f5ecd7" stroke="${st.gem}" stroke-width="6"/>
    <text x="512" y="512" font-family="Georgia,serif" font-weight="900" font-size="104"
          fill="#123227" text-anchor="middle">S</text>
    <circle cx="587" cy="543" r="17" fill="${st.accent}"/>
  </g>

  <!-- tier banner -->
  <rect x="${S / 2 - 285}" y="756" width="570" height="78" rx="39" fill="#04110b"
        stroke="url(#foil)" stroke-width="4"/>
  <text x="512" y="810" font-family="Georgia,serif" font-weight="900" font-size="38"
        letter-spacing="7" fill="${st.accent}" text-anchor="middle">${st.label}</text>

  <!-- serial -->
  <text x="512" y="886" font-family="Georgia,serif" font-size="27" letter-spacing="3"
        fill="#cfe4d8" text-anchor="middle">No. ${serial} / ${total}</text>
  <text x="512" y="930" font-family="Georgia,serif" font-size="19" letter-spacing="2"
        fill="#8fb8a5" text-anchor="middle">CRYPTO SCRABBLE · SCRABBLE BAGS</text>

  <rect width="${S}" height="${S}" fill="transparent" filter="url(#grain)"/>
</svg>`;
}

function renderPng(svg: string, out: string) {
  execFileSync('convert', ['svg:-', '-resize', '1024x1024', `png:${out}`], { input: svg });
}

async function main() {
  const count = Number(process.env.COUNT ?? 500);
  const galleryN = Number(process.env.GALLERY ?? 24);
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(ART, { recursive: true });

  if (!process.env.BAGS_SECRET) {
    throw new Error('BAGS_SECRET env required (any long random string) — keep it secret');
  }
  const secret = process.env.BAGS_SECRET;

  const sealed: (SealedBag & { mint: string })[] = [];
  const reveals: unknown[] = [];
  const mintKeys: string[] = [];

  for (let i = 0; i < count; i++) {
    const bag = drawContents(secret, i);
    const kp = Keypair.generate();
    mintKeys.push(bs58.encode(kp.secretKey));
    sealed.push({ index: i, tier: bag.tier, commitment: bag.commitment, mint: kp.publicKey.toBase58() });
    reveals.push({ index: i, tier: bag.tier, salt: bag.salt, contents: bag.contents });
  }

  fs.writeFileSync(path.join(OUT, 'sealed.json'), JSON.stringify(sealed, null, 2));
  fs.writeFileSync(path.join(OUT, 'reveals.json'), JSON.stringify(reveals, null, 2));
  fs.writeFileSync(path.join(OUT, 'mints.json'), JSON.stringify(mintKeys));
  console.log(`plans: ${count} bags -> data/bags/`);

  // public metadata for the frontend
  const tiersCount = sealed.reduce<Record<string, number>>((m, b) => ({ ...m, [b.tier]: (m[b.tier] ?? 0) + 1 }), {});
  fs.writeFileSync(
    path.join(ROOT, 'app', 'public', 'bags', 'collection.json'),
    JSON.stringify({
      name: 'Scrabble Bags — Edition 1',
      symbol: 'BAGS',
      count,
      pricesLamports: { common: 50_000_000, rare: 120_000_000, legendary: 300_000_000 },
      tiers: tiersCount,
      bags: sealed.map((s) => ({ i: s.index, t: s.tier, m: s.mint })),
    }),
  );
  console.log('metadata: app/public/bags/collection.json');

  // art: every bag gets SVG; first GALLERY get PNG renders for the storefront
  for (let i = 0; i < count; i++) {
    const reveal = (reveals as { index: number; contents: BagContents }[])[i];
    const preview = Object.keys(reveal.contents);
    const svg = bagSvg(i, sealed[i].tier, count, preview);
    fs.writeFileSync(path.join(OUT, `${i}.svg`), svg);
    if (i < galleryN) renderPng(svg, path.join(ART, `${i}.png`));
  }
  // tier hero images
  for (const tier of ['common', 'rare', 'legendary'] as const) {
    const i = sealed.findIndex((s) => s.tier === tier);
    renderPng(bagSvg(i, tier, count, ['S']), path.join(ART, `hero-${tier}.png`));
  }
  console.log(`art: ${galleryN} pngs + svgs -> app/public/bags/`);
  void PublicKey;
}

main().catch((e) => { console.error(e); process.exit(1); });
