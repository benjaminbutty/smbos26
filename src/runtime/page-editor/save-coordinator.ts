export type SaveCoordinatorFailure = "stale" | "error";

export type SaveCoordinatorResult<T> =
  | { status: "success"; canonical: T }
  | { status: SaveCoordinatorFailure; message: string };

export type SaveCoordinatorStatus =
  "saved" | "unsaved" | "saving" | SaveCoordinatorFailure;

export interface SaveCoordinatorState {
  status: SaveCoordinatorStatus;
  revision: number;
  acknowledgedRevision: number;
  blocked: SaveCoordinatorFailure | null;
}

export interface SaveCoordinatorScheduler {
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SerialSaveCoordinatorOptions<T> {
  debounceMs?: number;
  maxWaitMs?: number;
  equals?: (left: T, right: T) => boolean;
  scheduler?: SaveCoordinatorScheduler;
  initialValue: T;
  save: (input: {
    candidate: T;
    revision: number;
    requestId: object;
  }) => Promise<SaveCoordinatorResult<T>>;
  onStateChange?: (state: SaveCoordinatorState) => void;
}

const browserScheduler: SaveCoordinatorScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function defaultEquals<T>(left: T, right: T): boolean {
  return Object.is(left, right);
}

/**
 * Serialises immutable Page writes while keeping a quiet debounce and a
 * bounded checkpoint for continuous editing. It deliberately stops after a
 * failed or stale request; callers must invoke retry() to resume.
 */
export class SerialSaveCoordinator<T> {
  readonly #debounceMs: number;
  readonly #maxWaitMs: number;
  readonly #equals: (left: T, right: T) => boolean;
  readonly #scheduler: SaveCoordinatorScheduler;
  readonly #save: SerialSaveCoordinatorOptions<T>["save"];
  readonly #onStateChange: ((state: SaveCoordinatorState) => void) | undefined;
  #acknowledged: T;
  #candidate: T;
  #dirtySince: number | null = null;
  #lastEdit: number | null = null;
  #revision = 0;
  #acknowledgedRevision = 0;
  #blocked: SaveCoordinatorFailure | null = null;
  #status: SaveCoordinatorStatus = "saved";
  #timer: unknown = null;
  #inFlight: Promise<SaveCoordinatorResult<T>> | null = null;
  #activeRequestId: object | null = null;
  #requestEpoch = 0;
  #disposed = false;

  constructor(options: SerialSaveCoordinatorOptions<T>) {
    this.#debounceMs = options.debounceMs ?? 1_500;
    this.#maxWaitMs = options.maxWaitMs ?? 10_000;
    this.#equals = options.equals ?? defaultEquals;
    this.#scheduler = options.scheduler ?? browserScheduler;
    this.#save = options.save;
    this.#onStateChange = options.onStateChange;
    this.#acknowledged = options.initialValue;
    this.#candidate = options.initialValue;
  }

  get state(): SaveCoordinatorState {
    return {
      status: this.#status,
      revision: this.#revision,
      acknowledgedRevision: this.#acknowledgedRevision,
      blocked: this.#blocked,
    };
  }

  get inFlight(): boolean {
    return this.#inFlight !== null;
  }

  get hasUnacknowledgedWork(): boolean {
    return !this.#equals(this.#candidate, this.#acknowledged);
  }

  get candidate(): T {
    return this.#candidate;
  }

  /**
   * Return whether a save callback is still acknowledging the latest
   * candidate. The object identity is intentional: every editor candidate is
   * a new immutable envelope, so this distinguishes a later edit even when
   * it happens to serialize to the same value as an earlier one.
   */
  isCurrent(candidate: T, revision: number): boolean {
    return (
      !this.#disposed &&
      this.#revision === revision &&
      this.#candidate === candidate
    );
  }

  /**
   * Return whether the callback for a particular request may apply its
   * acknowledgement. Blocking, accepting a replacement baseline, disposing
   * the editor, or replacing the coordinator invalidates the token while a
   * network response may still be settling.
   */
  isRequestActive(requestId: object): boolean {
    return (
      !this.#disposed &&
      this.#blocked === null &&
      this.#activeRequestId === requestId
    );
  }

  update(candidate: T): void {
    if (this.#disposed) return;
    this.#candidate = candidate;
    this.#revision += 1;
    const now = this.#scheduler.now();
    if (this.#dirtySince === null) this.#dirtySince = now;
    this.#lastEdit = now;
    if (this.hasUnacknowledgedWork) {
      if (this.#blocked) {
        // A new candidate must never resume a failed or conflicted write.
        // The owner has to choose Try again/Keep my version explicitly.
        this.#setStatus(this.#blocked);
      } else {
        this.#setStatus(this.#inFlight ? "saving" : "unsaved");
        this.#schedule();
      }
      return;
    }

    // Undoing back to the acknowledged canonical value is a real semantic
    // no-op. It is safe to clear a stopped error/conflict when no request is
    // still in flight, while an older request still needs to settle before
    // the UI can claim that the document is fully saved.
    this.#dirtySince = null;
    this.#lastEdit = null;
    if (!this.#inFlight) this.#blocked = null;
    this.#setStatus(this.#inFlight ? "saving" : "saved");
  }

  /** Rebase a dirty candidate onto an unrelated configuration head. */
  rebase(): void {
    if (this.#disposed) return;
    // A stale response can mean that another configuration change advanced
    // the workspace head while the target Page stayed byte-for-byte equal to
    // our acknowledged baseline. That is the one recovery the editor may
    // perform automatically. Genuine request failures and target conflicts
    // remain stopped until the owner explicitly retries.
    if (this.#blocked === "stale") {
      this.#blocked = null;
      this.#setStatus(this.hasUnacknowledgedWork ? "unsaved" : "saved");
    }
    if (!this.#blocked) this.#schedule();
  }

  /** Accept a server-provided candidate without creating a new save. */
  acknowledge(canonical: T): void {
    if (this.#disposed) return;
    this.#requestEpoch += 1;
    this.#activeRequestId = null;
    this.#acknowledged = canonical;
    this.#candidate = canonical;
    this.#acknowledgedRevision = this.#revision;
    this.#dirtySince = null;
    this.#lastEdit = null;
    this.#blocked = null;
    this.#clearTimer();
    this.#setStatus("saved");
  }

  /** Stop auto retries after a conflict or request failure. */
  block(status: SaveCoordinatorFailure): void {
    if (this.#disposed) return;
    this.#requestEpoch += 1;
    this.#activeRequestId = null;
    this.#blocked = status;
    this.#clearTimer();
    this.#setStatus(status);
  }

  async retry(): Promise<SaveCoordinatorResult<T> | null> {
    if (this.#disposed) return null;
    this.#blocked = null;
    if (!this.hasUnacknowledgedWork) {
      this.#setStatus("saved");
      return null;
    }
    this.#setStatus(this.#inFlight ? "saving" : "unsaved");
    return this.flush();
  }

  async flush(): Promise<SaveCoordinatorResult<T> | null> {
    if (this.#disposed) return null;
    this.#clearTimer();
    let lastResult: SaveCoordinatorResult<T> | null = null;
    while (!this.#disposed) {
      if (this.#inFlight) {
        const inFlight = this.#inFlight;
        const result = await inFlight;
        if (this.#inFlight === inFlight) this.#inFlight = null;
        lastResult = result;
        if (result.status !== "success") return result;
      }
      this.#clearTimer();
      if (this.#blocked || !this.hasUnacknowledgedWork) {
        if (!this.#blocked && !this.hasUnacknowledgedWork) {
          this.#setStatus("saved");
        }
        return lastResult;
      }
      // A request may have been started by this very flush call, so keep
      // looping after its acknowledgement. This drains edits queued during
      // that request before navigation or lifecycle actions continue.
      lastResult = await this.#runSave();
      if (lastResult.status !== "success") return lastResult;
    }
    return lastResult;
  }

  dispose(): void {
    this.#disposed = true;
    this.#requestEpoch += 1;
    this.#clearTimer();
  }

  #setStatus(status: SaveCoordinatorStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#onStateChange?.(this.state);
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      this.#scheduler.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #schedule(): void {
    if (
      this.#disposed ||
      this.#blocked ||
      !this.hasUnacknowledgedWork ||
      this.#lastEdit === null ||
      this.#dirtySince === null
    ) {
      return;
    }
    this.#clearTimer();
    const now = this.#scheduler.now();
    const quietRemaining = Math.max(
      0,
      this.#debounceMs - (now - this.#lastEdit),
    );
    const maxRemaining = Math.max(
      0,
      this.#maxWaitMs - (now - this.#dirtySince),
    );
    this.#timer = this.#scheduler.setTimeout(
      () => {
        this.#timer = null;
        if (this.#disposed || this.#blocked || !this.hasUnacknowledgedWork) {
          return;
        }
        const current = this.#scheduler.now();
        const quiet =
          this.#lastEdit === null ||
          current - this.#lastEdit >= this.#debounceMs;
        const maxed =
          this.#dirtySince !== null &&
          current - this.#dirtySince >= this.#maxWaitMs;
        if (quiet || maxed) {
          void this.#runSave();
        } else {
          this.#schedule();
        }
      },
      Math.min(quietRemaining, maxRemaining),
    );
  }

  #runSave(): Promise<SaveCoordinatorResult<T>> {
    if (this.#inFlight) return this.#inFlight;
    if (this.#disposed || this.#blocked || !this.hasUnacknowledgedWork) {
      return Promise.resolve({
        status: "success",
        canonical: this.#acknowledged,
      });
    }
    const candidate = this.#candidate;
    const revision = this.#revision;
    const requestId = {};
    const requestEpoch = this.#requestEpoch;
    this.#activeRequestId = requestId;
    this.#setStatus("saving");
    const request = this.#save({ candidate, revision, requestId })
      .catch((error): SaveCoordinatorResult<T> => ({
        status: "error",
        message:
          error instanceof Error && error.message
            ? error.message
            : "The Page could not be saved. Try again.",
      }))
      .then((result) => {
        if (this.#disposed || requestEpoch !== this.#requestEpoch) {
          if (this.#inFlight === request) {
            this.#inFlight = null;
            if (this.#activeRequestId === requestId) {
              this.#activeRequestId = null;
            }
          }
          return {
            canonical: this.#acknowledged,
            status: "success",
          } satisfies SaveCoordinatorResult<T>;
        }
        if (result.status !== "success") {
          this.#blocked = result.status;
          this.#setStatus(result.status);
          if (this.#inFlight === request) {
            this.#inFlight = null;
            if (this.#activeRequestId === requestId) {
              this.#activeRequestId = null;
            }
          }
          return result;
        }
        this.#acknowledged = result.canonical;
        this.#acknowledgedRevision = revision;
        const changedWhileSaving =
          revision !== this.#revision ||
          !this.#equals(this.#candidate, candidate);
        const candidateStillDiffers = !this.#equals(
          this.#candidate,
          result.canonical,
        );
        if (changedWhileSaving && candidateStillDiffers) {
          // Start a fresh quiet/max-wait window for the newest candidate. If
          // the original first-dirty timestamp were retained, a slow request
          // could trigger an immediate second write before the owner pauses.
          const newestEdit = this.#lastEdit ?? this.#scheduler.now();
          this.#dirtySince = newestEdit;
          this.#lastEdit = newestEdit;
          this.#setStatus("unsaved");
          this.#schedule();
        } else {
          this.#candidate = result.canonical;
          this.#dirtySince = null;
          this.#lastEdit = null;
          this.#setStatus("saved");
        }
        // Clear the in-flight marker before resolving the public request.
        // Callers may immediately undo a failed candidate or enqueue a new
        // candidate from the acknowledgement continuation; leaving this
        // marker for a separate finally microtask makes that synchronous
        // recovery look like a still-running save.
        if (this.#inFlight === request) {
          this.#inFlight = null;
          if (this.#activeRequestId === requestId) {
            this.#activeRequestId = null;
          }
        }
        return result;
      });
    this.#inFlight = request;
    return request;
  }
}
