function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Places the contextual block menu beside its block without letting a short
 * viewport or a narrow phone push its controls off-screen.
 */
export function positionPageBlockMenu(
  anchor: { left: number; top: number },
  viewport: { height: number; width: number },
  menu: { height: number; width: number },
): { left: number; top: number } {
  const inset = 8;
  const maxLeft = Math.max(inset, viewport.width - menu.width - inset);
  const maxTop = Math.max(inset, viewport.height - menu.height - inset);
  return {
    left: clamp(anchor.left - 44, inset, maxLeft),
    top: clamp(anchor.top, inset, maxTop),
  };
}
