"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RefObject } from "react";

import type { EditorColumnKind } from "./contracts";

export interface TypePickerOption {
  kind: EditorColumnKind;
  label: string;
  description: string;
}

export const lenniTypePickerOptions: readonly TypePickerOption[] = [
  { kind: "text", label: "Text", description: "Short names and labels" },
  {
    kind: "long_text",
    label: "Long text",
    description: "Notes and longer writing",
  },
  { kind: "number", label: "Number", description: "Counts and quantities" },
  { kind: "currency", label: "Money", description: "Prices and amounts" },
  { kind: "boolean", label: "Yes / No", description: "A simple checkbox" },
  { kind: "date", label: "Date", description: "A calendar date" },
  { kind: "email", label: "Email", description: "Email addresses" },
  { kind: "phone", label: "Phone", description: "Telephone numbers" },
  { kind: "url", label: "Website", description: "Web links" },
  {
    kind: "select",
    label: "Choice",
    description: "A controlled list of choices",
  },
  { kind: "status", label: "Status", description: "A labelled progress state" },
];

export function Popover({
  anchorRef,
  children,
  className = "",
  onClose,
  viewportSafe = false,
}: Readonly<{
  anchorRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  onClose?: () => void;
  viewportSafe?: boolean;
}>): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const [viewportPosition, setViewportPosition] = useState<
    { left: number; top: number } | undefined
  >();

  useEffect(() => {
    if (!viewportSafe || typeof window === "undefined") {
      return;
    }
    const updatePosition = (): void => {
      const popover = ref.current;
      const anchor = anchorRef?.current ?? popover?.parentElement;
      if (!anchor) return;
      const bounds = anchor.getBoundingClientRect();
      const gap = 8;
      const width = Math.min(
        popover?.getBoundingClientRect().width || 288,
        Math.max(0, window.innerWidth - gap * 2),
      );
      const estimatedHeight = Math.min(
        window.innerHeight - gap * 2,
        Math.max(
          0,
          popover?.scrollHeight || popover?.getBoundingClientRect().height || 0,
        ),
      );
      const topBelow = bounds.bottom + gap;
      const top =
        topBelow + estimatedHeight <= window.innerHeight - gap
          ? topBelow
          : Math.max(gap, bounds.top - estimatedHeight - gap);
      const left = Math.min(
        Math.max(gap, bounds.right - width),
        Math.max(gap, window.innerWidth - width - gap),
      );
      setViewportPosition({ left, top });
    };

    updatePosition();
    let followUpFrame: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      followUpFrame = window.requestAnimationFrame(updatePosition);
    });
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      if (followUpFrame !== undefined) {
        window.cancelAnimationFrame(followUpFrame);
      }
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, viewportSafe]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node))
        onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);
  const content = (
    <div
      className={`lenni-popover ${className}`.trim()}
      data-viewport-safe={viewportSafe ? "true" : undefined}
      ref={ref}
      role="dialog"
      style={{
        ...viewportPosition,
        visibility: viewportSafe && !viewportPosition ? "hidden" : undefined,
      }}
    >
      {children}
    </div>
  );

  return viewportSafe && viewportPosition && typeof document !== "undefined"
    ? createPortal(content, document.body)
    : content;
}

export function Menu({
  children,
  className = "",
}: Readonly<{ children: ReactNode; className?: string }>): ReactNode {
  return (
    <div className={`lenni-menu ${className}`.trim()} role="menu">
      {children}
    </div>
  );
}

export function TypePicker({
  allowedKinds = lenniTypePickerOptions.map((option) => option.kind),
  onChange,
  value,
}: Readonly<{
  allowedKinds?: readonly EditorColumnKind[];
  onChange: (kind: EditorColumnKind) => void;
  value: EditorColumnKind;
}>): ReactNode {
  const [query, setQuery] = useState("");
  const options = lenniTypePickerOptions.filter(
    (option) =>
      allowedKinds.includes(option.kind) &&
      `${option.label} ${option.description}`
        .toLocaleLowerCase("en")
        .includes(query.toLocaleLowerCase("en")),
  );
  return (
    <div className="lenni-type-picker">
      <input
        aria-label="Search property types"
        className="lenni-picker-search"
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Search types"
        value={query}
      />
      <div className="lenni-picker-options">
        {options.map((option) => (
          <button
            aria-current={option.kind === value ? "true" : undefined}
            className="lenni-type-option"
            key={option.kind}
            onClick={() => onChange(option.kind)}
            role="menuitem"
            type="button"
          >
            <span>{option.label}</span>
            <small>{option.description}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

export function OptionManager({
  maxOptions = 100,
  options,
  onChange,
}: Readonly<{
  maxOptions?: number;
  options: readonly string[];
  onChange: (options: readonly string[]) => void;
}>): ReactNode {
  const [draft, setDraft] = useState("");
  const update = (index: number, value: string): void => {
    onChange(
      options.map((option, optionIndex) =>
        optionIndex === index ? value : option,
      ),
    );
  };
  return (
    <div className="lenni-option-manager">
      {options.length === 0 ? (
        <p className="editor-options-empty-state">No options yet.</p>
      ) : null}
      <div className="lenni-option-list">
        {options.map((option, index) => (
          <div className="lenni-option-row" key={`${index}:${option}`}>
            <input
              aria-label={`Option ${index + 1}`}
              onChange={(event) => update(index, event.currentTarget.value)}
              value={option}
            />
            <button
              aria-label={`Move option ${index + 1} up`}
              disabled={index === 0}
              onClick={() => {
                const next = [...options];
                [next[index - 1]!, next[index]!] = [
                  next[index]!,
                  next[index - 1]!,
                ];
                onChange(next);
              }}
              type="button"
            >
              ↑
            </button>
            <button
              aria-label={`Move option ${index + 1} down`}
              disabled={index === options.length - 1}
              onClick={() => {
                const next = [...options];
                [next[index]!, next[index + 1]!] = [
                  next[index + 1]!,
                  next[index]!,
                ];
                onChange(next);
              }}
              type="button"
            >
              ↓
            </button>
            <button
              aria-label={`Remove option ${index + 1}`}
              onClick={() =>
                onChange(
                  options.filter((_, optionIndex) => optionIndex !== index),
                )
              }
              type="button"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="lenni-option-add">
        <input
          aria-label="New option"
          disabled={options.length >= maxOptions}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="New option"
          value={draft}
        />
        <button
          disabled={!draft.trim() || options.length >= maxOptions}
          onClick={() => {
            if (!draft.trim() || options.length >= maxOptions) return;
            onChange([...options, draft.trim()]);
            setDraft("");
          }}
          type="button"
        >
          Add
        </button>
      </div>
      {options.length >= maxOptions ? (
        <p className="editor-options-limit" role="status">
          Maximum {maxOptions} options.
        </p>
      ) : null}
    </div>
  );
}

export function ShortcutSheet({
  onClose,
}: Readonly<{ onClose: () => void }>): ReactNode {
  return (
    <Popover className="lenni-shortcut-sheet" onClose={onClose}>
      <div className="lenni-popover-heading">
        <strong>Keyboard shortcuts</strong>
        <button
          aria-label="Close keyboard shortcuts"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>
      <dl>
        <div>
          <dt>Enter / F2</dt>
          <dd>Edit cell</dd>
        </div>
        <div>
          <dt>Tab</dt>
          <dd>Save and move right</dd>
        </div>
        <div>
          <dt>Shift + Tab</dt>
          <dd>Save and move left</dd>
        </div>
        <div>
          <dt>⌘ / Ctrl + Shift + P</dt>
          <dd>Add property</dd>
        </div>
        <div>
          <dt>⌘ / Ctrl + C</dt>
          <dd>Copy selection</dd>
        </div>
        <div>
          <dt>⌘ / Ctrl + V</dt>
          <dd>Paste values</dd>
        </div>
        <div>
          <dt>Escape</dt>
          <dd>Close or cancel</dd>
        </div>
      </dl>
    </Popover>
  );
}

export function SaveState({
  status,
  message,
}: Readonly<{
  status: "saved" | "saving" | "error";
  message?: string;
}>): ReactNode {
  return (
    <div className={`editor-save-state editor-save-${status}`} role="status">
      <span aria-hidden="true" className="editor-save-dot" />
      {status === "saving"
        ? "Saving…"
        : status === "error"
          ? (message ?? "Could not save")
          : "Saved"}
    </div>
  );
}
