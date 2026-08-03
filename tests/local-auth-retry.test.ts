import console from "node:console";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface RetryArguments {
  label: string;
  operation: () => unknown | Promise<unknown>;
  sleep?: (delay: number) => unknown | Promise<unknown>;
  retryDelaysMs?: number[];
}

interface UpsertArguments {
  authAdmin: {
    listUsers: (options: {
      page: number;
      perPage: number;
    }) => unknown | Promise<unknown>;
    updateUserById: (
      userId: string,
      attributes: { password: string; email_confirm: boolean },
    ) => unknown | Promise<unknown>;
    createUser: (attributes: {
      email: string;
      password: string;
      email_confirm: boolean;
    }) => unknown | Promise<unknown>;
  };
  email: string;
  password: string;
  sleep?: (delay: number) => unknown | Promise<unknown>;
  retryDelaysMs?: number[];
}

interface LocalAuthRetryModule {
  LOCAL_AUTH_RETRY_DELAYS_MS: readonly number[];
  isRetryableLocalAuthError: (error: unknown) => boolean;
  runLocalAuthOperationWithRetry: (args: RetryArguments) => Promise<unknown>;
  upsertLocalAuthUser: (args: UpsertArguments) => Promise<unknown>;
}

const helperModulePath: string = "../scripts/support/local-auth-retry.mjs";
const {
  LOCAL_AUTH_RETRY_DELAYS_MS,
  isRetryableLocalAuthError,
  runLocalAuthOperationWithRetry,
  upsertLocalAuthUser,
} = (await import(helperModulePath)) as LocalAuthRetryModule;

const noSleep = vi.fn(async (delay: number) => {
  void delay;
});
const password = "test-password-that-must-not-be-logged";

function authError(properties: Record<string, unknown>) {
  return Object.assign(new Error("private response body"), properties);
}

function success<T>(data: T) {
  return { data, error: null };
}

function failure(error: unknown) {
  return { data: null, error };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  noSleep.mockClear();
});

describe("isRetryableLocalAuthError", () => {
  it.each([429, 502, 503, 504])(
    "accepts transient HTTP status %s",
    (status) => {
      expect(isRetryableLocalAuthError(authError({ status }))).toBe(true);
    },
  );

  it.each(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE"])(
    "accepts transient network code %s",
    (code) => {
      expect(isRetryableLocalAuthError(authError({ code }))).toBe(true);
    },
  );

  it("accepts AuthRetryableFetchError and nested causes", () => {
    expect(
      isRetryableLocalAuthError(authError({ name: "AuthRetryableFetchError" })),
    ).toBe(true);
    expect(
      isRetryableLocalAuthError({ cause: authError({ statusCode: "502" }) }),
    ).toBe(true);
  });

  it.each([400, 401, 403, 404])(
    "rejects permanent HTTP status %s",
    (status) => {
      expect(isRetryableLocalAuthError(authError({ status }))).toBe(false);
    },
  );

  it("rejects validation, credential, permission, duplicate, and programming errors", () => {
    for (const error of [
      authError({ name: "AuthApiError", status: 422 }),
      authError({ code: "invalid_credentials" }),
      authError({ code: "permission_denied" }),
      authError({ code: "user_already_exists" }),
      new TypeError("programming error"),
    ]) {
      expect(isRetryableLocalAuthError(error)).toBe(false);
    }
  });
});

describe("runLocalAuthOperationWithRetry", () => {
  it("uses the exact bounded production schedule", () => {
    expect(LOCAL_AUTH_RETRY_DELAYS_MS).toEqual([250, 500, 1000, 2000, 4000]);
    expect(Object.isFrozen(LOCAL_AUTH_RETRY_DELAYS_MS)).toBe(true);
  });

  it("does not sleep after immediate success", async () => {
    const operation = vi.fn(async () => success({ ok: true }));

    await expect(
      runLocalAuthOperationWithRetry({
        label: "list users",
        operation,
        sleep: noSleep,
      }),
    ).resolves.toEqual(success({ ok: true }));
    expect(operation).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it("retries thrown and returned transient failures", async () => {
    const thrownOperation = vi
      .fn()
      .mockRejectedValueOnce(authError({ status: 502 }))
      .mockResolvedValueOnce(success({ ok: true }));
    const returnedOperation = vi
      .fn()
      .mockResolvedValueOnce(failure(authError({ status: 503 })))
      .mockResolvedValueOnce(success({ ok: true }));

    await runLocalAuthOperationWithRetry({
      label: "list users",
      operation: thrownOperation,
      sleep: noSleep,
    });
    await runLocalAuthOperationWithRetry({
      label: "update user",
      operation: returnedOperation,
      sleep: noSleep,
    });

    expect(thrownOperation).toHaveBeenCalledTimes(2);
    expect(returnedOperation).toHaveBeenCalledTimes(2);
    expect(noSleep).toHaveBeenNthCalledWith(1, 250);
    expect(noSleep).toHaveBeenNthCalledWith(2, 250);
  });

  it("stops immediately for a non-retryable result", async () => {
    const result = failure(authError({ status: 401 }));
    const operation = vi.fn(async () => result);

    await expect(
      runLocalAuthOperationWithRetry({
        label: "list users",
        operation,
        sleep: noSleep,
      }),
    ).resolves.toBe(result);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it("stops immediately for a non-retryable thrown error", async () => {
    const error = authError({ status: 403 });
    const operation = vi.fn(async () => {
      throw error;
    });

    await expect(
      runLocalAuthOperationWithRetry({
        label: "list users",
        operation,
        sleep: noSleep,
      }),
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it("makes at most six attempts and preserves the final thrown error", async () => {
    const errors = Array.from({ length: 6 }, (_, index) =>
      authError({ status: 502, marker: index }),
    );
    const operation = vi.fn(async () => {
      const error = errors[operation.mock.calls.length - 1];
      throw error;
    });

    await expect(
      runLocalAuthOperationWithRetry({
        label: "list users",
        operation,
        sleep: noSleep,
      }),
    ).rejects.toBe(errors[5]);
    expect(operation).toHaveBeenCalledTimes(6);
    expect(noSleep.mock.calls.map(([delay]) => delay)).toEqual([
      250, 500, 1000, 2000, 4000,
    ]);
  });

  it("preserves the final returned result after exhaustion", async () => {
    const results = Array.from({ length: 6 }, (_, index) =>
      failure(authError({ status: 504, marker: index })),
    );
    const operation = vi.fn(
      async () => results[operation.mock.calls.length - 1],
    );

    await expect(
      runLocalAuthOperationWithRetry({
        label: "list users",
        operation,
        sleep: noSleep,
      }),
    ).resolves.toBe(results[5]);
  });

  it("logs only the safe retry fields", async () => {
    const warning = vi.mocked(console.warn);
    const operation = vi
      .fn()
      .mockResolvedValueOnce(
        failure(
          authError({
            status: 502,
            url: "http://127.0.0.1/private",
            password,
            email: "private@example.test",
          }),
        ),
      )
      .mockResolvedValueOnce(success({ ok: true }));

    await runLocalAuthOperationWithRetry({
      label: "list users",
      operation,
      sleep: noSleep,
    });

    expect(warning).toHaveBeenCalledWith(
      'Local Auth retry label="list users" attempt=2/6 status=502 delay_ms=250',
    );
    const logged = warning.mock.calls.flat().join(" ");
    expect(logged).not.toContain("private response body");
    expect(logged).not.toContain("127.0.0.1");
    expect(logged).not.toContain(password);
    expect(logged).not.toContain("private@example.test");
  });
});

describe("upsertLocalAuthUser", () => {
  it("updates an existing exact-email user with retry protection", async () => {
    const user = { id: "owner-id", email: "owner@example.test" };
    const updated = { ...user, refreshed: true };
    const authAdmin = {
      listUsers: vi.fn(async () => success({ users: [user] })),
      updateUserById: vi
        .fn()
        .mockResolvedValueOnce(failure(authError({ code: "ECONNRESET" })))
        .mockResolvedValueOnce(success({ user: updated })),
      createUser: vi.fn(),
    };

    await expect(
      upsertLocalAuthUser({
        authAdmin,
        email: user.email,
        password,
        sleep: noSleep,
      }),
    ).resolves.toBe(updated);
    expect(authAdmin.updateUserById).toHaveBeenCalledWith(user.id, {
      password,
      email_confirm: true,
    });
    expect(authAdmin.createUser).not.toHaveBeenCalled();
  });

  it("creates a missing user once", async () => {
    const user = { id: "owner-id", email: "owner@example.test" };
    const authAdmin = {
      listUsers: vi.fn(async () => success({ users: [] })),
      updateUserById: vi.fn(),
      createUser: vi.fn(async () => success({ user })),
    };

    await expect(
      upsertLocalAuthUser({
        authAdmin,
        email: user.email,
        password,
        sleep: noSleep,
      }),
    ).resolves.toBe(user);
    expect(authAdmin.createUser).toHaveBeenCalledTimes(1);
  });

  it("recovers when the initial list operation is transiently unavailable", async () => {
    const user = { id: "owner-id", email: "owner@example.test" };
    const authAdmin = {
      listUsers: vi
        .fn()
        .mockResolvedValueOnce(failure(authError({ status: 502 })))
        .mockResolvedValueOnce(success({ users: [user] })),
      updateUserById: vi.fn(async () => success({ user })),
      createUser: vi.fn(),
    };

    await upsertLocalAuthUser({
      authAdmin,
      email: user.email,
      password,
      sleep: noSleep,
    });

    expect(authAdmin.listUsers).toHaveBeenCalledTimes(2);
    expect(authAdmin.updateUserById).toHaveBeenCalledTimes(1);
    expect(authAdmin.createUser).not.toHaveBeenCalled();
  });

  it("reconciles a retryable create failure before attempting another create", async () => {
    const user = { id: "owner-id", email: "owner@example.test" };
    let users: (typeof user)[] = [];
    const authAdmin = {
      listUsers: vi.fn(async () => success({ users })),
      updateUserById: vi.fn(async () => success({ user })),
      createUser: vi.fn(async () => {
        users = [user];
        return failure(authError({ name: "AuthRetryableFetchError" }));
      }),
    };

    await expect(
      upsertLocalAuthUser({
        authAdmin,
        email: user.email,
        password,
        sleep: noSleep,
      }),
    ).resolves.toBe(user);
    expect(authAdmin.createUser).toHaveBeenCalledTimes(1);
    expect(authAdmin.listUsers).toHaveBeenCalledTimes(2);
    expect(authAdmin.updateUserById).toHaveBeenCalledWith(user.id, {
      password,
      email_confirm: true,
    });
  });

  it("permits another create only after reconciliation confirms the email is absent", async () => {
    const user = { id: "owner-id", email: "owner@example.test" };
    const authAdmin = {
      listUsers: vi.fn(async () =>
        success({ users: [{ id: "other-id", email: "other@example.test" }] }),
      ),
      updateUserById: vi.fn(),
      createUser: vi
        .fn()
        .mockResolvedValueOnce(failure(authError({ status: 502 })))
        .mockResolvedValueOnce(success({ user })),
    };

    await expect(
      upsertLocalAuthUser({
        authAdmin,
        email: user.email,
        password,
        sleep: noSleep,
      }),
    ).resolves.toBe(user);
    expect(authAdmin.listUsers).toHaveBeenCalledTimes(2);
    expect(authAdmin.createUser).toHaveBeenCalledTimes(2);
  });

  it("bounds create and reconciliation attempts and preserves the final error", async () => {
    const errors = Array.from({ length: 6 }, (_, index) =>
      authError({ status: 502, marker: index }),
    );
    const authAdmin = {
      listUsers: vi.fn(async () => success({ users: [] })),
      updateUserById: vi.fn(),
      createUser: vi.fn(async () =>
        failure(errors[authAdmin.createUser.mock.calls.length - 1]),
      ),
    };

    await expect(
      upsertLocalAuthUser({
        authAdmin,
        email: "owner@example.test",
        password,
        sleep: noSleep,
      }),
    ).rejects.toBe(errors[5]);
    expect(authAdmin.createUser).toHaveBeenCalledTimes(6);
    expect(authAdmin.listUsers).toHaveBeenCalledTimes(6);
    expect(noSleep.mock.calls.map(([delay]) => delay)).toEqual([
      250, 500, 1000, 2000, 4000,
    ]);
  });

  it("does not reconcile or retry a non-retryable duplicate error", async () => {
    const duplicate = authError({ status: 422, code: "user_already_exists" });
    const authAdmin = {
      listUsers: vi.fn(async () => success({ users: [] })),
      updateUserById: vi.fn(),
      createUser: vi.fn(async () => failure(duplicate)),
    };

    await expect(
      upsertLocalAuthUser({
        authAdmin,
        email: "owner@example.test",
        password,
        sleep: noSleep,
      }),
    ).rejects.toBe(duplicate);
    expect(authAdmin.listUsers).toHaveBeenCalledTimes(1);
    expect(authAdmin.createUser).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it("keeps owner and staff Auth operations sequential in the seed", async () => {
    let active = 0;
    let maximumActive = 0;
    const tracked = async <T>(value: T) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return value;
    };
    const authAdmin = {
      listUsers: vi.fn(async () => tracked(success({ users: [] }))),
      updateUserById: vi.fn(),
      createUser: vi.fn(async ({ email }: { email: string }) =>
        tracked(success({ user: { id: email, email } })),
      ),
    };

    await upsertLocalAuthUser({
      authAdmin,
      email: "owner@example.test",
      password,
      sleep: noSleep,
    });
    await upsertLocalAuthUser({
      authAdmin,
      email: "staff@example.test",
      password,
      sleep: noSleep,
    });

    expect(maximumActive).toBe(1);
    const seedSource = readFileSync(
      join(process.cwd(), "scripts", "demo-seed.mjs"),
      "utf8",
    );
    expect(seedSource).toContain(
      "const ownerUser = await upsertLocalUser(admin, ownerEmail);",
    );
    expect(seedSource).toContain(
      "const staffUser = await upsertLocalUser(admin, staffEmail);",
    );
  });
});
