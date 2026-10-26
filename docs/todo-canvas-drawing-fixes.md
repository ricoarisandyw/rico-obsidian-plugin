# Todo: canvas drawing fixes

Two bugs: the drawing toolbar does not appear, and stroke width changes with zoom.

## Phase 1: toolbar does not show

- [x] Step 0: add `console.log(">>> debug", ...)` at rail click, `toggleDrawingMode`, `setVisible`, `syncOverlays`, `onMouseDown`
- [x] Step 1: failing tests (missing toggle button, wrong-canvas click, rebuilt canvas DOM)
- [x] Step 2: rail click resolves the overlay by its own canvas, no fallback to the first overlay
- [x] Step 3: `toggleDrawingMode` no longer throws when the toggle button was never found
- [x] Step 4: `syncOverlays` re-attaches when a tab's canvas element changed
- [ ] Step 5: run tests, then verify in the app

### UI check
1. Reload the plugin, open a canvas, click the palette icon on the left rail: toolbar appears at the top.
2. Open a second canvas tab, click the icon: toolbar shows there.
3. Go back to the first tab, click the icon: toolbar shows there too.
4. Open a different canvas file in the same tab, click the icon. Press `Esc` to close.

## Phase 2: same line width at every zoom

- [x] Step 1: rewrite the width tests (same stored width at 0.5, 1, 2 zoom)
- [x] Step 2: store the chosen width as-is (drop the `/ scale`)
- [x] Step 3: check arrow head and eraser still behave
- [ ] Step 4: run tests, then verify in the app

### UI check
1. Drawing mode on, size 5.
2. Draw at normal zoom, zoomed in, and zoomed out.
3. At normal zoom all three lines are the same thickness.
4. Zoom in and out: all three grow and shrink together.
5. Reload the app: lines look the same.

## Cleanup
- [ ] Remove the `>>> debug` logs once both bugs are confirmed fixed
