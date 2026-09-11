import { describe, expect, it } from "vitest";

import {
  SerialSaveCoordinator,
  type SaveCoordinatorScheduler,
} from "../src/runtime/page-editor/save-coordinator";

class Clock implements SaveCoordinatorScheduler {
  time = 0;
  private nextHandle = 1;
  private timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delay: number): number {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.time + delay, callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(milliseconds: number): void {
    const target = this.time + milliseconds;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort(([, left], [, right]) => left.at - right.at)[0];
      if (!due) break;
      this.time = due[1].at;
      this.timers.delete(due[0]);
      due[1].callback();
    }
    this.time = target;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("SerialSaveCoordinator", () => {
  it("waits for quiet time and restarts the debounce after every edit", async () => {
    const clock = new Clock();
    const saves: number[] = [];
    const coordinator = new SerialSaveCoordinator<number>({
      initialValue: 0,
      scheduler: clock,
      save: async ({ candidate }) => {
        saves.push(candidate);
        return { canonical: candidate, status: "success" };
      },
    });

    coordinator.update(1);
    clock.advance(1_000);
    coordinator.update(2);
    clock.advance(499);
    await Promise.resolve();
    expect(saves).toEqual([]);
    clock.advance(1_001);
    await Promise.resolve();
    await Promise.resolve();
    expect(saves).toEqual([2]);
    expect(coordinator.state.status).toBe("saved");
  });

  it("checkpoints continuous edits at the maximum wait", async () => {
    const clock = new Clock();
    const saves: number[] = [];
    const coordinator = new SerialSaveCoordinator<number>({
      initialValue: 0,
      scheduler: clock,
      save: async ({ candidate }) => {
        saves.push(candidate);
        return { canonical: candidate, status: "success" };
      },
    });

    coordinator.update(1);
    for (let index = 0; index < 9; index += 1) {
      clock.advance(1_000);
      coordinator.update(index + 2);
    }
    clock.advance(1_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(saves).toEqual([10]);
  });

  it("never overlaps writes and drains a revision queued during a save", async () => {
    const clock = new Clock();
    const first = deferred<{
      canonical: number;
      status: "success";
    }>();
    const requests: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const coordinator = new SerialSaveCoordinator<number>({
      initialValue: 0,
      scheduler: clock,
      save: async ({ candidate }) => {
        requests.push(candidate);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (candidate === 1) {
          const result = await first.promise;
          active -= 1;
          return result;
        }
        active -= 1;
        return { canonical: candidate, status: "success" };
      },
    });

    coordinator.update(1);
    clock.advance(2_000);
    coordinator.update(2);
    coordinator.update(3);
    first.resolve({ canonical: 1, status: "success" });
    await coordinator.flush();
    expect(requests).toEqual([1, 3]);
    expect(maximumActive).toBe(1);
    expect(coordinator.state.status).toBe("saved");
  });

  it("drains a delayed acknowledgement before immediate navigation", async () => {
    const first = deferred<{
      canonical: number;
      status: "success";
    }>();
    const requests: number[] = [];
    const coordinator = new SerialSaveCoordinator<number>({
      initialValue: 0,
      save: async ({ candidate }) => {
        requests.push(candidate);
        if (candidate === 1) return first.promise;
        return { canonical: candidate, status: "success" };
      },
    });

    coordinator.update(1);
    const navigationFlush = coordinator.flush();
    await Promise.resolve();
    expect(coordinator.inFlight).toBe(true);

    // An owner can edit again while the navigation save is waiting. The
    // flush must persist that newest candidate before it permits navigation.
    coordinator.update(2);
    first.resolve({ canonical: 1, status: "success" });
    await navigationFlush;

    expect(requests).toEqual([1, 2]);
    expect(coordinator.hasUnacknowledgedWork).toBe(false);
    expect(coordinator.state.status).toBe("saved");
  });

  it("starts a new quiet window after a slow acknowledgement", async () => {
    const clock = new Clock();
    const first = deferred<{
      canonical: number;
      status: "success";
    }>();
    const requests: number[] = [];
    const coordinator = new SerialSaveCoordinator<number>({
      initialValue: 0,
      scheduler: clock,
      save: async ({ candidate }) => {
        requests.push(candidate);
        if (candidate === 1) return first.promise;
        return { canonical: candidate, status: "success" };
      },
    });

    coordinator.update(1);
    clock.advance(1_500);
    await Promise.resolve();
    expect(coordinator.inFlight).toBe(true);

    clock.advance(2_000);
    coordinator.update(2);
    first.resolve({ canonical: 1, status: "success" });
    await Promise.resolve();
    await Promise.resolve();

    // The acknowledgement arrived while the second candidate was still
    // being typed. It must wait for that candidate's quiet period instead of
    // inheriting the original dirty timestamp.
    clock.advance(1_499);
    await Promise.resolve();
    expect(requests).toEqual([1]);
    clock.advance(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(requests).toEqual([1, 2]);
    expect(coordinator.state.status).toBe("saved");
  });

  it("treats an undo during an in-flight save as a clean acknowledgement", async () => {
    const clock = new Clock();
    const first = deferred<{
      canonical: number;
      status: "success";
    }>();
    const requests: number[] = [];
    const coordinator = new SerialSaveCoordinator<number>({
      initialValue: 0,
      scheduler: clock,
      save: async ({ candidate }) => {
        requests.push(candidate);
        return first.promise;
      },
    });

    coordinator.update(1);
    clock.advance(1_500);
    await Promise.resolve();
    expect(coordinator.inFlight).toBe(true);

    // A user can undo or otherwise return to the same semantic value while
    // the request is in flight. The revision changed, but there is no newer
    // candidate to persist after the acknowledgement.
    coordinator.update(1);
    first.resolve({ canonical: 1, status: "success" });
    await coordinator.flush();

    expect(requests).toEqual([1]);
    expect(coordinator.state.status).toBe("saved");
    expect(coordinator.hasUnacknowledgedWork).toBe(false);
  });

  it("suppresses semantic no-ops and requires deliberate retry after failure", async () => {
    const clock = new Clock();
    let attempts = 0;
    let fail = true;
    const coordinator = new SerialSaveCoordinator<{ text: string }>({
      equals: (left, right) => left.text === right.text,
      initialValue: { text: "same" },
      scheduler: clock,
      save: async ({ candidate }) => {
        attempts += 1;
        if (fail) return { message: "offline", status: "error" };
        return { canonical: candidate, status: "success" };
      },
    });

    coordinator.update({ text: "same" });
    clock.advance(2_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(attempts).toBe(0);

    coordinator.update({ text: "changed" });
    clock.advance(2_000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(attempts).toBe(1);
    expect(coordinator.state.status).toBe("error");
    coordinator.update({ text: "changed again" });
    clock.advance(2_000);
    await Promise.resolve();
    expect(attempts).toBe(1);
    fail = false;
    await coordinator.retry();
    expect(attempts).toBe(2);
    expect(coordinator.state.status).toBe("saved");
  });

  it("clears a failed save when undo returns to the acknowledged value", async () => {
    const clock = new Clock();
    let attempts = 0;
    const coordinator = new SerialSaveCoordinator<{ text: string }>({
      equals: (left, right) => left.text === right.text,
      initialValue: { text: "same" },
      scheduler: clock,
      save: async () => {
        attempts += 1;
        return { message: "offline", status: "error" };
      },
    });

    coordinator.update({ text: "changed" });
    clock.advance(2_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(coordinator.state.status).toBe("error");

    coordinator.update({ text: "same" });
    expect(attempts).toBe(1);
    expect(coordinator.state.status).toBe("saved");
    expect(coordinator.hasUnacknowledgedWork).toBe(false);
  });

  it("ignores a late response after conflict recovery changes the baseline", async () => {
    const clock = new Clock();
    const first = deferred<{
      canonical: number;
      status: "success";
    }>();
    const requests: number[] = [];
    const coordinator = new SerialSaveCoordinator<number>({
      initialValue: 0,
      scheduler: clock,
      save: async ({ candidate }) => {
        requests.push(candidate);
        if (candidate === 1) return first.promise;
        return { canonical: candidate, status: "success" };
      },
    });

    coordinator.update(1);
    clock.advance(2_000);
    await Promise.resolve();
    expect(coordinator.inFlight).toBe(true);

    coordinator.block("stale");
    first.resolve({ canonical: 1, status: "success" });
    await Promise.resolve();
    await Promise.resolve();
    expect(coordinator.state.status).toBe("stale");
    expect(coordinator.candidate).toBe(1);

    await coordinator.retry();
    expect(requests).toEqual([1, 1]);
    expect(coordinator.state.status).toBe("saved");
  });

  it("automatically resumes one stale candidate after an unrelated head rebase", async () => {
    const clock = new Clock();
    const first = deferred<{
      message: string;
      status: "stale";
    }>();
    const requests: number[] = [];
    const coordinator = new SerialSaveCoordinator<number>({
      initialValue: 0,
      scheduler: clock,
      save: async ({ candidate }) => {
        requests.push(candidate);
        if (requests.length === 1) return first.promise;
        return { canonical: candidate, status: "success" };
      },
    });

    coordinator.update(1);
    clock.advance(2_000);
    await Promise.resolve();
    expect(coordinator.state.status).toBe("saving");

    first.resolve({ message: "workspace head moved", status: "stale" });
    await coordinator.flush();
    expect(coordinator.state.status).toBe("stale");

    coordinator.rebase();
    expect(coordinator.state.status).toBe("unsaved");
    clock.advance(1_500);
    await Promise.resolve();
    await Promise.resolve();
    expect(requests).toEqual([1, 1]);
    expect(coordinator.state.status).toBe("saved");
  });
});
