# Credits

Blob Land is made by [William Perret](https://github.com/PerretWilliam), on the shoulders of the people below. Thank you.

Each of these keeps its own license; the [Blob Land license](LICENSE) doesn't cover them.

## Art and type

| What | By | Used for | License |
| --- | --- | --- | --- |
| [blobatar](https://blobatar.dev) | [Alain](https://github.com/Alain00/blobatar) | Every blob's face and body, drawn from its name | MIT |
| Isometric sprite pack (tiles, trees, bushes, rocks, cacti, clouds) | [Zagorskiy](https://x.com/ZagorskiyUA) | The islands, the menu and the app icon | Its author's license: see [`LICENSE.txt`](apps/desktop/src/assets/iso/LICENSE.txt). May be used in other projects as content, not redistributed or sold on its own. |
| [Fredoka](https://github.com/hafontia/Fredoka-One) | The Fredoka Project Authors, packaged by [Fontsource](https://fontsource.org) | All the lettering in the app and on the banner | SIL Open Font License 1.1 |
| [Lucide](https://lucide.dev) | Lucide contributors | Icons in the menus and panels | ISC |

## The app

| What | Used for | License |
| --- | --- | --- |
| [Tauri](https://tauri.app) and its plugins (fs, dialog, http, notification, autostart, opener) | The desktop app around the game | MIT or Apache 2.0 |
| [React](https://react.dev) | The interface | MIT |
| [PixiJS](https://pixijs.com) | Drawing the world with WebGL | MIT |
| [Tailwind CSS](https://tailwindcss.com), [tw-animate-css](https://github.com/Wombosvideo/tw-animate-css) | Styling | MIT |
| [Radix UI](https://www.radix-ui.com), [shadcn/ui](https://ui.shadcn.com) | Interface building blocks | MIT |
| [class-variance-authority](https://cva.style) | Button variants | Apache 2.0 |
| [Vite](https://vite.dev) | Building the app | MIT |

## The garden's server

| What | Used for | License |
| --- | --- | --- |
| [Cloudflare Workers](https://workers.cloudflare.com), [Durable Objects](https://developers.cloudflare.com/durable-objects/), [D1](https://developers.cloudflare.com/d1/) and [Wrangler](https://github.com/cloudflare/workers-sdk) | Running the shared garden | Wrangler: MIT or Apache 2.0 |
| [Hono](https://hono.dev) | The API's routes | MIT |

## Tools

[TypeScript](https://www.typescriptlang.org) (Apache 2.0), [Vitest](https://vitest.dev) (MIT), [pnpm](https://pnpm.io) (MIT), [Changesets](https://github.com/changesets/changesets) (MIT), [commitlint](https://commitlint.js.org) and [husky](https://typicode.github.io/husky/) (MIT).

Every other package the app pulls in along the way is listed, with its license, by `pnpm licenses list`.
