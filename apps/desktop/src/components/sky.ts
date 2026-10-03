/*
 * What the sky does over the island: rain and snow, the season's petals,
 * leaves, fluff and fireflies, shooting stars, fog, and a storm's lightning.
 * Screen-space sprites over the world, in a few small textures drawn once.
 * Nothing is simulated: each particle's place is a function of the time, so
 * a frame costs a loop over a couple of hundred sprites, and none when the
 * sky is still.
 */
import type { Season, Weather } from "@blob-land/sim";
import { Container, Graphics, Sprite, Texture, type Renderer } from "pixi.js";

type Kind = "rain" | "snow" | "petal" | "leaf" | "fluff";

// What falls (or floats) in each weather, and else in each season: how many, in which colours.
const FALLS: Partial<Record<Weather, { kind: Kind; count: number; tints: number[] }>> = {
  rain: { kind: "rain", count: 120, tints: [0xcfe6ff] },
  storm: { kind: "rain", count: 200, tints: [0xb8d4f0] },
  snow: { kind: "snow", count: 110, tints: [0xffffff] },
};
const SEASON_FALLS: Partial<Record<Season, { kind: Kind; count: number; tints: number[] }>> = {
  blossom: { kind: "petal", count: 30, tints: [0xff9fc6, 0xffb8d6, 0xffd6e7] },
  bloom: { kind: "petal", count: 22, tints: [0xfff07a, 0xffffff, 0xd7b8ff, 0xffc0d9] },
  summer: { kind: "fluff", count: 16, tints: [0xffffff] },
  falling_leaves: { kind: "leaf", count: 26, tints: [0xe8833a, 0xd9502f, 0xf2c14e, 0xb5651d] },
};
const FIREFLIES = 26;
// How grey and dim each weather makes the day: it reads as an early dusk.
export const GLOOM: Record<Weather, number> = { clear: 0, cloudy: 0.35, rain: 0.7, storm: 1, snow: 0.3, fog: 0.5 };

// A fixed pseudo-random number in [0, 1) per particle and use.
const hash = (i: number, k: number) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function shape(renderer: Renderer, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  const texture = renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return texture;
}

export class Sky {
  readonly root = new Container();
  private readonly fog = new Sprite(Texture.WHITE);
  private readonly flash = new Sprite(Texture.WHITE);
  private readonly falling = new Container();
  private readonly flies = new Container();
  private readonly star: Sprite;
  private readonly textures: Record<Kind | "firefly" | "star", Texture>;
  private fall: { kind: Kind; count: number; tints: number[] } | null = null;
  private weather: Weather | null = null;
  private season: Season | null = null;

  constructor(renderer: Renderer) {
    this.textures = {
      rain: shape(renderer, (g) => g.roundRect(0, 0, 2.5, 18, 1.25).fill(0xffffff)),
      snow: shape(renderer, (g) => g.circle(4, 4, 4).fill(0xffffff)),
      petal: shape(renderer, (g) => g.ellipse(6, 3.5, 6, 3.5).fill(0xffffff)),
      leaf: shape(renderer, (g) => g.moveTo(0, 5).quadraticCurveTo(7, -3, 14, 5).quadraticCurveTo(7, 13, 0, 5).fill(0xffffff)),
      fluff: shape(renderer, (g) => {
        g.circle(5, 5, 2.5).fill(0xffffff);
        for (let k = 0; k < 6; k++) g.moveTo(5, 5).lineTo(5 + 5 * Math.cos(k), 5 + 5 * Math.sin(k)).stroke({ color: 0xffffff, width: 0.8, alpha: 0.8 });
      }),
      firefly: shape(renderer, (g) => g.circle(11, 11, 11).fill({ color: 0xeaff8a, alpha: 0.2 }).circle(11, 11, 6).fill({ color: 0xeaff8a, alpha: 0.35 }).circle(11, 11, 3.5).fill(0xf6ffc4)),
      star: shape(renderer, (g) => {
        for (let k = 0; k < 10; k++) g.rect(k * 8, 1, 8, 2).fill({ color: 0xffffff, alpha: (k + 1) / 10 });
        g.circle(81, 2, 2.5).fill(0xffffff);
      }),
    };
    this.fog.tint = 0xe2e8ef;
    this.fog.alpha = 0;
    this.flash.alpha = 0;
    this.star = new Sprite(this.textures.star);
    this.star.anchor.set(1, 0.5);
    this.star.visible = false;
    for (let i = 0; i < FIREFLIES; i++) {
      const fly = new Sprite(this.textures.firefly);
      fly.anchor.set(0.5);
      this.flies.addChild(fly);
    }
    this.root.addChild(this.fog, this.falling, this.flies, this.star, this.flash);
  }

  /** The weather and season to show. */
  set(weather: Weather, season: Season) {
    if (weather === this.weather && season === this.season) return;
    [this.weather, this.season] = [weather, season];
    this.fall = FALLS[weather] ?? (weather === "fog" ? null : (SEASON_FALLS[season] ?? null));
    this.falling.removeChildren().forEach((s) => s.destroy());
    if (!this.fall) return;
    for (let i = 0; i < this.fall.count; i++) {
      const sprite = new Sprite(this.textures[this.fall.kind]);
      sprite.anchor.set(0.5);
      sprite.tint = this.fall.tints[i % this.fall.tints.length]!;
      this.falling.addChild(sprite);
    }
  }

  private get fireflies() {
    return (this.season === "fireflies" || this.season === "summer") && (this.weather === "clear" || this.weather === "cloudy");
  }

  private get shootingStars() {
    return this.season === "shooting_stars" && this.weather === "clear";
  }

  /** Whether anything moves: frames have to be drawn for it. */
  active(light: number): boolean {
    return this.fall !== null || this.weather === "storm" || (light < 0.6 && (this.fireflies || this.shootingStars));
  }

  /**
   * Places everything for a `w` x `h` px screen at `now` (ms), under
   * daylight `light`. Still (`still`: reduced motion, or the map), only
   * the fog and the gloom stay.
   */
  frame(w: number, h: number, now: number, light: number, still: boolean) {
    const t = now / 1000;
    const fog = this.weather === "fog" ? 0.45 : this.season === "mist" && this.weather !== "clear" ? 0.15 : 0;
    // Fades in and out over a few seconds, rather than popping.
    this.fog.alpha += (fog * (0.45 + 0.55 * light) - this.fog.alpha) * (still ? 1 : 0.05);
    this.fog.setSize(w, h);
    this.falling.visible = !still;
    this.flies.visible = !still && light < 0.6 && this.fireflies;
    this.star.visible = false;
    this.flash.alpha = 0;
    if (still) return;

    const fall = this.fall;
    if (fall) {
      const dim = 0.55 + 0.45 * light;
      this.falling.children.forEach((s, i) => {
        const [r1, r2, r3, r4] = [hash(i, 1), hash(i, 2), hash(i, 3), hash(i, 4)];
        // How far down the screen it is, wrapping round: speed in screen heights a second.
        const down = (speed: number) => ((((t * speed + r3) % 1) + 1) % 1) * (h + 60) - 30;
        switch (fall.kind) {
          case "rain": {
            const y = down(1.1 + 0.6 * r2);
            s.position.set(r1 * (w + 0.3 * h) - 0.25 * y, y);
            s.rotation = 0.25;
            s.alpha = (0.5 + 0.4 * r4) * dim;
            break;
          }
          case "snow":
            s.position.set(r1 * w + 18 * Math.sin(t * 0.8 + r3 * 6), down(0.05 + 0.06 * r2));
            s.scale.set(0.45 + 0.6 * r4);
            s.alpha = 0.9 * dim;
            break;
          case "petal":
          case "leaf":
            s.position.set(r1 * w * 1.2 - 0.1 * w + 40 * Math.sin(t * 0.6 + r3 * 6), down(0.04 + 0.05 * r2));
            s.rotation = t * (0.8 + r4) + r3 * 6;
            s.scale.set(1.1 + 0.8 * r4, (1.1 + 0.8 * r4) * (0.6 + 0.4 * Math.cos(t * 2 + r1 * 6)));
            s.alpha = dim;
            break;
          case "fluff":
            s.position.set(((((t * 0.015 * (1 + r2) + r1) % 1.2) + 1.2) % 1.2) * w - 0.1 * w, h * (0.15 + 0.7 * r3) + 20 * Math.sin(t * 0.7 + r4 * 6));
            s.rotation = t * 0.3 + r4 * 6;
            s.alpha = 0.85 * dim;
            break;
        }
      });
    }

    if (this.flies.visible) {
      this.flies.children.forEach((s, i) => {
        const [r1, r2, r3, r4] = [hash(i, 5), hash(i, 6), hash(i, 7), hash(i, 8)];
        s.position.set(r1 * w + 30 * Math.sin(t * 0.4 * (1 + r2) + r3 * 6), h * (0.4 + 0.55 * r4) + 18 * Math.cos(t * 0.5 + r1 * 6));
        s.alpha = (1 - light / 0.6) * (0.25 + 0.75 * Math.max(0, Math.sin(t * 1.5 * (0.6 + r2) + r3 * 10)));
      });
    }

    // Now and then a shooting star, high up: one every seven seconds, mostly.
    if (light < 0.6 && this.shootingStars) {
      const n = Math.floor(t / 7);
      const p = (t - n * 7) / 0.9;
      if (p < 1 && hash(n, 9) < 0.7) {
        const [x0, y0] = [(0.35 + 0.6 * hash(n, 10)) * w, (0.04 + 0.22 * hash(n, 11)) * h];
        this.star.visible = true;
        this.star.position.set(x0 - p * 0.25 * w, y0 + p * 0.1 * w);
        this.star.rotation = Math.atan2(0.1, -0.25);
        this.star.alpha = (1 - light / 0.6) * Math.sin(p * Math.PI);
      }
    }

    // Lightning: a double flash every few seconds, not every time.
    if (this.weather === "storm") {
      const n = Math.floor(t / 6);
      const f = t - n * 6;
      if (hash(n, 12) < 0.45 && (f < 0.1 || (f > 0.22 && f < 0.3))) this.flash.alpha = 0.4;
      this.flash.setSize(w, h);
    }
  }

  destroy() {
    for (const texture of Object.values(this.textures)) texture.destroy(true);
    this.root.destroy({ children: true });
  }
}
