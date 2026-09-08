export interface TransientPointerSurface<TTarget> {
  contains(target: TTarget): boolean;
  dismiss(): void;
  open: boolean;
}

export interface PointerTargetEvent {
  target: EventTarget | null;
}

export function dismissTransientPointerSurfaces<TTarget>(
  target: TTarget,
  surfaces: readonly TransientPointerSurface<TTarget>[],
): void {
  for (const surface of surfaces) {
    if (surface.open && !surface.contains(target)) surface.dismiss();
  }
}

export function createTransientPointerDismissal<TTarget>(
  isTarget: (candidate: unknown) => candidate is TTarget,
  surfaces: readonly TransientPointerSurface<TTarget>[],
): (event: PointerTargetEvent) => void {
  return (event): void => {
    if (!isTarget(event.target)) return;
    dismissTransientPointerSurfaces(event.target, surfaces);
  };
}

/**
 * Capture phase ensures an embedded control cannot stop a pointer event before
 * an unrelated open transient surface has a chance to dismiss itself.
 */
export function registerCapturePointerDismissal(
  documentTarget: Document,
  listener: (event: PointerTargetEvent) => void,
): () => void {
  documentTarget.addEventListener("pointerdown", listener, true);
  return () => {
    documentTarget.removeEventListener("pointerdown", listener, true);
  };
}
