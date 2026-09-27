// Draws the app's icon and banner from the game's own pieces: three blobatars
// stacked on a small floating island built from the iso sprite pack.
// Writes brand/{icon,banner}.png; `pnpm tauri icon brand/icon.png` then
// makes every platform's icon from icon.png.
// Needs rsvg-convert (brew install librsvg) and, for the banner, the Fredoka font.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blobatar } from "blobatar";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iso = join(root, "src/assets/iso");
const out = join(root, "brand");
const widths = JSON.parse(readFileSync(join(iso, "widths.json"), "utf8"));

// The world's tile geometry (see src/components/world.ts), in pack pixels.
const [HALF_W, HALF_H, LEVEL, TILE_W, TILE_H, TOP_X, TOP_Y] = [139, 81, 109, 304, 296, 152, 15.3];
const png = (name) => `data:image/png;base64,${readFileSync(join(iso, `${name}.png`)).toString("base64")}`;
const size = (name) => {
  const b = readFileSync(join(iso, `${name}.png`));
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
const image = (name, x, y, w, h) => `<image href="${png(name)}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const at = (u, v, height = 0) => ({ x: (u - v) * HALF_W, y: (u + v) * HALF_H - height * LEVEL });

// A 4 x 4 island: grass, a sandy front, a few trees.
const N = 4;
const ground = (i, j) => (i + j >= 2 * N - 3 && (i === N - 1 || j === N - 1) ? "sand" : "grass");
const height = () => 0;
const decor = { "0,0": "tree-4", "0,2": "tree-2", "2,0": "tree-6", "3,1": "bush-2", "0,3": "rock-2" };

function island() {
  const parts = [];
  const cells = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) cells.push([i, j]);
  cells.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [i, j] of cells) {
    for (let level = 0; level <= height(i, j); level++) {
      const p = at(i, j, level);
      parts.push(image(`tile-${level < height(i, j) ? "dirt" : ground(i, j)}`, p.x - TOP_X, p.y - TOP_Y, TILE_W, TILE_H));
    }
  }
  for (const [i, j] of cells) {
    const name = decor[`${i},${j}`];
    if (!name) continue;
    const p = at(i + 0.5, j + 0.5, height(i, j));
    const w = widths[name];
    const h = (w * size(name).h) / size(name).w;
    parts.push(image(name, p.x - w / 2, p.y - 0.92 * h, w, h));
  }
  return parts.join("");
}

// Blobatars, bottom to top. alain00 is the one on blobatar.dev's front page.
const STACK = [
  { name: "mochi", box: 560 },
  { name: "land", box: 480 },
  { name: "alain00", box: 420 },
];
function stack(cx, baseY) {
  const parts = [`<ellipse cx="${cx}" cy="${baseY - 8}" rx="${STACK[0].box * 0.3}" ry="${STACK[0].box * 0.08}" fill="#000" opacity="0.18"/>`];
  let bottom = baseY;
  for (const { name, box } of STACK) {
    // A blob's body fills roughly 17%..83% of its box; each sits a bit into the one below.
    const y = bottom - 0.83 * box;
    // Outlined like the sprite pack's pieces: the first group is the body.
    const inner = blobatar(name, { background: false })
      .replace(/^<svg[^>]*>|<\/svg>$/g, "")
      .replace("<g ", '<g stroke="#000" stroke-width="2.2" stroke-linejoin="round" ');
    parts.push(`<svg x="${cx - box / 2}" y="${y}" width="${box}" height="${box}" viewBox="0 0 100 100">${inner}</svg>`);
    bottom = y + 0.3 * box;
  }
  return { svg: parts.join(""), top: bottom - 0.3 * STACK.at(-1).box + 0.13 * STACK.at(-1).box };
}

// The scene in pack pixels, with its bounding box.
function scene() {
  const centre = at(N / 2, N / 2);
  const s = stack(centre.x, centre.y + 30);
  const x0 = -N * HALF_W - 20;
  const x1 = N * HALF_W + 20;
  const y1 = at(N, N).y + (TILE_H - TOP_Y - 2 * HALF_H) + 10;
  const y0 = Math.min(s.top, at(0, 0).y - 300) - 10;
  return { svg: island() + s.svg, x0, y0, w: x1 - x0, h: y1 - y0 };
}

const sky = (id) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fdcff"/><stop offset="1" stop-color="#e6f6ff"/></linearGradient>`;
const cloud = (name, x, y, w, opacity) => {
  const { w: iw, h: ih } = size(name);
  return `<image href="${png(name)}" x="${x}" y="${y}" width="${w}" height="${(w * ih) / iw}" opacity="${opacity}"/>`;
};
const fit = (sc, x, y, w, h) => {
  const k = Math.min(w / sc.w, h / sc.h);
  const dx = x + (w - sc.w * k) / 2 - sc.x0 * k;
  const dy = y + (h - sc.h * k) / 2 - sc.y0 * k;
  return `<g transform="translate(${dx} ${dy}) scale(${k})">${sc.svg}</g>`;
};

// macOS icon grid: an 824 squircle-ish tile centred on a 1024 canvas.
function icon() {
  const sc = scene();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>${sky("sky")}<clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>
<filter id="drop" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-opacity="0.28"/></filter></defs>
<g filter="url(#drop)"><rect x="100" y="100" width="824" height="824" rx="185" fill="url(#sky)"/></g>
<g clip-path="url(#tile)">${cloud("cloud-large", 560, 170, 300, 0.9)}${cloud("cloud-small", 150, 300, 190, 0.8)}
${fit(sc, 150, 135, 724, 760)}</g>
</svg>`;
}

function banner() {
  const sc = scene();
  const [W, H] = [1280, 640];
  const title = (dy, fill, extra = "") =>
    `<text x="500" y="${350 + dy}" font-family="Fredoka" font-weight="700" font-size="150" letter-spacing="2" fill="${fill}" ${extra}>Blob Land</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>${sky("sky")}<linearGradient id="word" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8f07a"/><stop offset="1" stop-color="#3fbf6a"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
${cloud("cloud-large", 1000, 30, 250, 0.9)}${cloud("cloud-small", 420, 470, 170, 0.7)}${cloud("cloud-small", 1080, 490, 150, 0.6)}
${fit(sc, 30, 40, 440, 580)}
${title(12, "#0b1a10", 'stroke="#0b1a10" stroke-width="18" stroke-linejoin="round"')}
${title(0, "url(#word)", 'stroke="#0b1a10" stroke-width="18" stroke-linejoin="round" paint-order="stroke"')}
<text x="508" y="425" font-family="Fredoka" font-weight="500" font-size="34" fill="#1d3b4d" opacity="0.8">A little world of blobs that live on their own.</text>
</svg>`;
}

mkdirSync(out, { recursive: true });
for (const [name, svg] of [["icon", icon()], ["banner", banner()]]) {
  execFileSync("rsvg-convert", ["-o", join(out, `${name}.png`)], { input: svg });
  console.log(`brand/${name}.png`);
}
