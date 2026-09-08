import type { ReactNode } from "react";

interface LenniBrandProps {
  className?: string;
  variant?: "lockup" | "symbol";
}

/**
 * The supplied Lenni logo specification requires an outlined wordmark (with a
 * custom coral i-dot), so it must not be substituted with live Satoshi text.
 */
export function LenniBrand({
  className,
  variant = "lockup",
}: Readonly<LenniBrandProps>): ReactNode {
  const isSymbolOnly = variant === "symbol";
  return (
    <span
      aria-label="lenni"
      className={`lenni-brand-lockup${isSymbolOnly ? " lenni-brand-lockup-symbol" : ""}${className ? ` ${className}` : ""}`}
      role="img"
    >
      <svg
        aria-hidden="true"
        className="lenni-brand-symbol"
        fill="none"
        viewBox="4.5 12.5 39 23"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g
          stroke="currentColor"
          strokeLinecap="butt"
          strokeLinejoin="miter"
          strokeWidth={6}
        >
          <path d="M7.5 35.5V21.5A6 6 0 0 1 19.5 21.5V35.5" />
          <path d="M28.5 35.5V21.5A6 6 0 0 1 40.5 21.5V35.5" />
        </g>
      </svg>
      {isSymbolOnly ? null : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className="lenni-brand-wordmark"
          draggable={false}
          src="/brand/lenni-wordmark.svg"
        />
      )}
    </span>
  );
}
