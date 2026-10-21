/**
 * Tree layout: depth decides the column (x), siblings stack down the page (y).
 *
 * Each section is given a vertical slot as tall as its whole subtree, then centred
 * inside it, so a parent sits level with the middle of its children and no two cards
 * ever overlap.
 */

import type { Section } from "./parser";

export interface LayoutOptions {
  cardWidth: number;
  cardHeight: number;
  /** Horizontal gap between a parent column and its children column. */
  columnGap: number;
  /** Vertical gap between two neighbouring cards. */
  rowGap: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  cardWidth: 400,
  cardHeight: 240,
  columnGap: 160,
  rowGap: 60,
};

export interface PlacedSection {
  section: Section;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Height a section needs including everything below it. */
function subtreeHeight(section: Section, opts: LayoutOptions): number {
  if (section.children.length === 0) return opts.cardHeight;
  const childrenHeight = section.children.reduce(
    (sum, child, i) => sum + subtreeHeight(child, opts) + (i > 0 ? opts.rowGap : 0),
    0
  );
  return Math.max(opts.cardHeight, childrenHeight);
}

/**
 * Place every section on the canvas plane. Roots start at (0, 0) and grow down-right.
 */
export function layoutSections(roots: Section[], options: Partial<LayoutOptions> = {}): PlacedSection[] {
  const opts = { ...DEFAULT_LAYOUT, ...options };
  const placed: PlacedSection[] = [];

  /** Place `section` in a band starting at `top`, in the column for `depth`. */
  const place = (section: Section, depth: number, top: number): number => {
    const height = subtreeHeight(section, opts);
    const x = depth * (opts.cardWidth + opts.columnGap);
    // Centre the card against its own subtree band.
    const y = top + (height - opts.cardHeight) / 2;

    placed.push({ section, x, y, width: opts.cardWidth, height: opts.cardHeight });

    let childTop = top;
    section.children.forEach((child, i) => {
      if (i > 0) childTop += opts.rowGap;
      childTop += place(child, depth + 1, childTop);
    });

    return height;
  };

  let top = 0;
  roots.forEach((root, i) => {
    if (i > 0) top += opts.rowGap;
    top += place(root, 0, top);
  });

  return placed;
}
