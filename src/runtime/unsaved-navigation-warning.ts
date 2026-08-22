"use client";

import { useEffect } from "react";

const defaultMessage = "Leave this page? Your unsaved changes will be lost.";

function navigationAnchor(event: MouseEvent): HTMLAnchorElement | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null;
  }
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.target === "_blank" || anchor.hasAttribute("download"))
    return null;
  const destination = new URL(anchor.href, window.location.href);
  return destination.href === window.location.href ? null : anchor;
}

export function useUnsavedNavigationWarning(
  active: boolean,
  message = defaultMessage,
): void {
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = true;
    };
    const beforeLinkNavigation = (event: MouseEvent): void => {
      if (!navigationAnchor(event) || window.confirm(message)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeLinkNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeLinkNavigation, true);
    };
  }, [active, message]);
}
