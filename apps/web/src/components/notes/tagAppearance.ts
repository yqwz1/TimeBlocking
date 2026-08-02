import type { CSSProperties } from 'react';

export type TagColors = Record<string, string>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function tagColorFor(tag: string, tagColors: TagColors | undefined): string | null {
  const color = tagColors?.[tag.toLocaleLowerCase()];
  return color && HEX_COLOR.test(color) ? color : null;
}

function withAlpha(hex: string, alpha: string): string {
  return `${hex}${alpha}`;
}

/** Inline style used by tag pills wherever they appear in the Second Brain. */
export function tagPillStyle(tag: string, tagColors: TagColors | undefined): CSSProperties | undefined {
  const color = tagColorFor(tag, tagColors);
  if (!color) return undefined;
  return {
    color,
    backgroundColor: withAlpha(color, '14'),
    borderColor: withAlpha(color, '33'),
  };
}
