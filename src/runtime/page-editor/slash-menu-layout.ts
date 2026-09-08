export interface SlashMenuCursor {
  bottom: number;
  left: number;
  top: number;
}

export interface SlashMenuPosition {
  left: number;
  maxHeight: number;
  top: number;
}

const menuGap = 8;
const menuMinimumHeight = 176;
const menuPreferredHeight = 384;
const menuWidth = 336;

export function positionSlashMenu(
  cursor: SlashMenuCursor,
  viewport: { height: number; width: number },
): SlashMenuPosition {
  const availableBelow = Math.max(
    0,
    viewport.height - cursor.bottom - menuGap * 2,
  );
  const availableAbove = Math.max(0, cursor.top - menuGap * 2);
  const openAbove =
    availableBelow < menuMinimumHeight && availableAbove > availableBelow;
  const availableHeight = openAbove ? availableAbove : availableBelow;
  const maxHeight = Math.min(menuPreferredHeight, availableHeight);

  return {
    left: Math.min(
      Math.max(menuGap, cursor.left),
      Math.max(menuGap, viewport.width - menuWidth - menuGap),
    ),
    top: openAbove
      ? Math.max(menuGap, cursor.top - maxHeight - menuGap)
      : Math.max(menuGap, cursor.bottom + menuGap),
    maxHeight,
  };
}

export function slashMenuScrollTopForActiveOption(input: {
  clientHeight: number;
  optionBottom: number;
  optionTop: number;
  scrollTop: number;
}): number {
  if (input.optionTop < input.scrollTop) {
    return Math.max(0, input.optionTop);
  }
  if (input.optionBottom > input.scrollTop + input.clientHeight) {
    return Math.max(0, input.optionBottom - input.clientHeight);
  }
  return input.scrollTop;
}
