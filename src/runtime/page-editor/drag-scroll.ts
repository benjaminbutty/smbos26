export function pageEditorDragScrollDelta({
  clientY,
  edge = 48,
  maximum = 24,
  viewportHeight,
}: {
  clientY: number;
  edge?: number;
  maximum?: number;
  viewportHeight: number;
}): number {
  if (viewportHeight <= 0 || edge <= 0 || maximum <= 0) return 0;
  if (clientY < edge) {
    return -Math.max(4, Math.ceil(((edge - clientY) / edge) * maximum));
  }
  if (clientY > viewportHeight - edge) {
    return Math.max(
      4,
      Math.ceil(((clientY - (viewportHeight - edge)) / edge) * maximum),
    );
  }
  return 0;
}
