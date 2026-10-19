# Rico Obsidian Plugin

An all-in-one suite of quality-of-life features for [Obsidian](https://obsidian.md): canvas tools,
tab management, file-explorer tweaks, and a few extras. Every feature is a separate toggle in
settings, so you can run just the parts you want.

> Personal project, shared as-is. It is not in the Obsidian community plugin directory.

## Features

Each one can be switched on or off individually under **Settings → Rico Obsidian Plugin**.

### Canvas

| Feature | What it does |
| --- | --- |
| Freehand Drawing | Draw on a canvas with a pen overlay, above or below the nodes. |
| Hammer Popup Menu | A radial-style popup menu for quick canvas actions. |
| OG Link Cards | Renders link nodes as preview cards with title, description and image. |
| Layers Panel | Group canvas nodes into layers and toggle their visibility. |
| Icon Drop | Drag icons onto the canvas. |
| Canvas Outline | A sidebar outline of the current canvas. |

### Tabs

| Feature | What it does |
| --- | --- |
| Auto-pin opened tabs | Pins every tab a file opens in, so the next file never replaces what you are reading. Opening a file that is already open reuses that tab instead of duplicating it. |
| Force close tabs | Adds "Force close all tabs" and "Force close other tabs" commands and right-click items that close tabs **even when they are pinned** — including tabs Obsidian has not loaded yet. |

Those two are designed as a pair: auto-pin stops Obsidian from recycling your tabs, and force-close
is the escape hatch for clearing them out afterwards.

### Files & explorer

| Feature | What it does |
| --- | --- |
| Show hidden folders & files | Reveals dotfolders like `.obsidian` in the explorer, using gitignore-style rules. Optionally hides them from the Quick Switcher. |
| Open extra file types | Opens a chosen list of extensions (`html`, `ts`, `css`, …) in a real code editor inside Obsidian. |
| New file (any extension) | A right-click "New file…" that lets you pick the extension. |
| Folder Base | Folder-level database views (`.fbase`). |
| Script right-click actions | Custom right-click actions defined in `scripts/actions.json`. |
| Run in Terminal | Run a file or folder in your terminal from the explorer. |

### Writing

| Feature | What it does |
| --- | --- |
| Block reference | Create and follow block references. |
| Block reference panels | Side panels showing a block's references. |
| Floating Table of Contents | A floating TOC for the active note. |
| Typing Game | A typing-practice view that uses your own notes. |

## Install

This plugin is not in the Obsidian community directory, so it has to be installed by hand.
You need **Obsidian 1.4.0 or later**.

An installed plugin is just a folder with three files in it:

```
<your vault>/.obsidian/plugins/rico-obsidian-plugin/
├── main.js        <- built from source (not in this repo)
├── manifest.json
└── styles.css
```

The folder name must be exactly `rico-obsidian-plugin`, matching the `id` in `manifest.json`.

### Build it yourself

`main.js` is a build artifact and is deliberately not committed, so you build it once:

```bash
git clone https://github.com/ricoarisandyw/rico-obsidian-plugin.git
cd rico-obsidian-plugin
pnpm install
pnpm run build
```

That produces `main.js` in the repo root. Then copy the three files into your vault:

```bash
# macOS / Linux — replace the path with your own vault
VAULT=~/Documents/MyVault
mkdir -p "$VAULT/.obsidian/plugins/rico-obsidian-plugin"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/rico-obsidian-plugin/"
```

Finally, open Obsidian and go to **Settings → Community plugins**. If Restricted Mode is on,
turn it off, then find **Rico Obsidian Plugin** in the installed list and enable it. If it does
not appear, hit the reload icon next to "Installed plugins", or restart Obsidian.

Every feature has its own toggle under **Settings → Rico Obsidian Plugin**. Some of them only
take effect after the plugin reloads (disable and re-enable it, or restart Obsidian).

### Symlink instead, if you plan to edit

If you want to hack on the plugin, symlink the repo into your vault so a rebuild lands straight
in Obsidian. Note that `.obsidian/plugins` is normally hidden in Finder — use the terminal:

```bash
VAULT=~/Documents/MyVault
ln -s "$(pwd)" "$VAULT/.obsidian/plugins/rico-obsidian-plugin"
```

Then run `pnpm run dev` for a watch build, and use the
[Hot Reload plugin](https://github.com/pjeby/hot-reload) — or just disable and re-enable this
plugin in settings — to pick up changes.

### Updating

Pull the latest code, rebuild, and copy `main.js` over again:

```bash
git pull
pnpm run build
cp main.js "$VAULT/.obsidian/plugins/rico-obsidian-plugin/"
```

Copy `manifest.json` and `styles.css` too if either has changed. Your settings live in
`data.json` inside the plugin folder and are left alone by an update — don't delete that file
unless you want to reset everything.

### Removing it

Disable it in **Settings → Community plugins**, then delete the
`<your vault>/.obsidian/plugins/rico-obsidian-plugin/` folder.

## Development

```bash
pnpm install
pnpm run dev     # watch build, unminified
pnpm run build   # production build
pnpm test        # run the test suite
```

The entry point is `src/main.tsx`; each feature lives in its own folder under `src/modules/`
and is registered only when its setting is enabled. Pure logic is split into `logic.ts` files so
it can be unit-tested without mocking Obsidian.

To develop against a real vault, see [Symlink instead, if you plan to edit](#symlink-instead-if-you-plan-to-edit) above.

## License

MIT — see [LICENSE](LICENSE).
