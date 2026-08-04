import { afterEach, describe, expect, it, vi } from "vitest";

interface ReadinessError extends Error {
  attempt: number;
  code: string;
  reason: string;
  status: number | null;
}

interface ReadinessModule {
  LOCAL_AUTH_READINESS_INITIAL_DELAY_MS: number;
  LOCAL_AUTH_READINESS_MAX_DELAY_MS: number;
  LOCAL_AUTH_READINESS_TIMEOUT_MS: number;
  LocalAuthReadinessError: new (args: {
    attempt: number;
    code: string;
    reason?: string;
    status?: number | null;
  }) => ReadinessError;
  createLocalAuthAdminProbe: (args: {
    apiUrl: string;
    fetchImpl: (
      input: URL,
      init: { headers: Record<string, string>; signal: AbortSignal },
    ) => Promise<{
      body: { cancel: () => Promise<void> } | null;
      ok: boolean;
      status: number;
    }>;
    serviceRoleKey: string;
  }) => (args: { signal: AbortSignal }) => Promise<{
    ok: boolean;
    status: number;
  }>;
  classifyLocalSupabaseFailure: (args: {
    error: Partial<ReadinessError>;
    snapshots?: Record<string, { health?: string; state?: string }>;
  }) => string;
  formatLocalSupabaseDiagnostics: (args: {
    error: Partial<ReadinessError>;
    snapshots?: Record<string, { health?: string; state?: string }>;
  }) => string[];
  runLocalAuthReadinessBoundary: (args: {
    diagnose?: (error: ReadinessError, context: { cycle: number }) => unknown;
    logger?: Logger;
    recover?: () => unknown | Promise<unknown>;
    waitForReady: () => unknown | Promise<unknown>;
  }) => Promise<unknown>;
  waitForLocalAuthReadiness: (args: {
    initialDelayMs?: number;
    logger?: Logger;
    maxDelayMs?: number;
    now?: () => number;
    probe: (args: { signal: AbortSignal }) => unknown | Promise<unknown>;
    sleep?: (delay: number) => unknown | Promise<unknown>;
    timeoutMs?: number;
  }) => Promise<{ attempt: number; status: number }>;
}

interface Logger {
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
}

const helperModulePath: string = "../scripts/support/local-auth-readiness.mjs";
const {
  LOCAL_AUTH_READINESS_INITIAL_DELAY_MS,
  LOCAL_AUTH_READINESS_MAX_DELAY_MS,
  LOCAL_AUTH_READINESS_TIMEOUT_MS,
  LocalAuthReadinessError,
  classifyLocalSupabaseFailure,
  createLocalAuthAdminProbe,
  formatLocalSupabaseDiagnostics,
  runLocalAuthReadinessBoundary,
  waitForLocalAuthReadiness,
} = (await import(helperModulePath)) as ReadinessModule;

function createLogger(): Logger {
  return {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function returnedFailure(status: number, privateBody = "private body") {
  return { ok: false, privateBody, status };
}

function readinessError(
  code = "deadline_exceeded",
  reason = "http",
  status: number | null = 502,
) {
  return new LocalAuthReadinessError({ attempt: 4, code, reason, status });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("waitForLocalAuthReadiness", () => {
  it("uses the bounded production deadline and backoff limits", () => {
    expect(LOCAL_AUTH_READINESS_TIMEOUT_MS).toBe(60_000);
    expect(LOCAL_AUTH_READINESS_INITIAL_DELAY_MS).toBe(250);
    expect(LOCAL_AUTH_READINESS_MAX_DELAY_MS).toBe(5_000);
  });

  it("returns immediately after a successful minimal probe", async () => {
    const logger = createLogger();
    const probe = vi.fn(async () => ({ ok: true, status: 200 }));
    const sleep = vi.fn();

    await expect(
      waitForLocalAuthReadiness({ logger, probe, sleep }),
    ).resolves.toEqual({ attempt: 1, status: 200 });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "Local Auth readiness attempt=1 status=200 delay_ms=0 code=ready",
    );
  });

  it("probes only one Auth admin user and never reads the response body", async () => {
    const cancel = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(
      async (
        input: URL,
        init: { headers: Record<string, string>; signal: AbortSignal },
      ) => {
        void input;
        void init;
        return {
          body: { cancel },
          ok: true,
          status: 200,
        };
      },
    );
    const probe = createLocalAuthAdminProbe({
      apiUrl: "http://127.0.0.1:55321",
      fetchImpl,
      serviceRoleKey: "local-test-key",
    });

    await expect(
      probe({ signal: globalThis.AbortSignal.timeout(1_000) }),
    ).resolves.toEqual({ ok: true, status: 200 });
    const [endpoint, request] = fetchImpl.mock.calls[0]!;
    expect(endpoint.pathname).toBe("/auth/v1/admin/users");
    expect(endpoint.searchParams.get("page")).toBe("1");
    expect(endpoint.searchParams.get("per_page")).toBe("1");
    expect(request.headers).toMatchObject({ accept: "application/json" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 502 and then succeeds", async () => {
    let time = 0;
    const logger = createLogger();
    const probe = vi
      .fn()
      .mockResolvedValueOnce(returnedFailure(502))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const sleep = vi.fn(async (delay: number) => {
      time += delay;
    });

    await expect(
      waitForLocalAuthReadiness({
        logger,
        now: () => time,
        probe,
        sleep,
      }),
    ).resolves.toEqual({ attempt: 2, status: 200 });
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("uses bounded exponential delays capped at five seconds", async () => {
    let time = 0;
    const delays: number[] = [];
    const probe = vi
      .fn()
      .mockResolvedValueOnce(returnedFailure(502))
      .mockResolvedValueOnce(returnedFailure(502))
      .mockResolvedValueOnce(returnedFailure(503))
      .mockResolvedValueOnce(returnedFailure(504))
      .mockResolvedValueOnce(returnedFailure(500))
      .mockResolvedValueOnce(returnedFailure(502))
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await waitForLocalAuthReadiness({
      logger: createLogger(),
      now: () => time,
      probe,
      sleep: async (delay) => {
        delays.push(delay);
        time += delay;
      },
    });

    expect(delays).toEqual([250, 500, 1_000, 2_000, 4_000, 5_000]);
  });

  it("fails immediately for a non-retryable response", async () => {
    const logger = createLogger();
    const probe = vi.fn(async () => returnedFailure(401));
    const sleep = vi.fn();

    await expect(
      waitForLocalAuthReadiness({ logger, probe, sleep }),
    ).rejects.toMatchObject({
      attempt: 1,
      code: "non_retryable_failure",
      status: 401,
    });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("enforces the hard deadline and truncates the final delay", async () => {
    let time = 0;
    const delays: number[] = [];

    await expect(
      waitForLocalAuthReadiness({
        logger: createLogger(),
        maxDelayMs: 1_000,
        now: () => time,
        probe: async () => returnedFailure(502),
        sleep: async (delay) => {
          delays.push(delay);
          time += delay;
        },
        timeoutMs: 1_100,
      }),
    ).rejects.toMatchObject({ code: "deadline_exceeded", status: 502 });
    expect(delays).toEqual([250, 500, 350]);
    expect(time).toBe(1_100);
  });

  it("logs no response body, key, token, email, URL, or raw error", async () => {
    let time = 0;
    const logger = createLogger();
    const secretValues = [
      "private response body",
      "service-role-key",
      "private@example.test",
      "http://127.0.0.1/private",
      "database-password",
    ];
    const probe = vi.fn(async () => ({
      cause: new Error(secretValues.join(" ")),
      email: secretValues[2],
      key: secretValues[1],
      ok: false,
      privateBody: secretValues[0],
      status: 502,
      url: secretValues[3],
    }));

    await expect(
      waitForLocalAuthReadiness({
        logger,
        now: () => time,
        probe,
        sleep: async (delay) => {
          time += delay;
        },
        timeoutMs: 250,
      }),
    ).rejects.toMatchObject({ code: "deadline_exceeded" });

    const output = Object.values(logger)
      .flatMap((method) => method.mock.calls.flat())
      .join(" ");
    for (const secret of secretValues) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("status=502");
    expect(output).toContain("code=deadline_exceeded");
  });
});

describe("safe local Supabase diagnostics", () => {
  it.each([
    [
      "database_unavailable",
      { database: { health: "unhealthy", state: "running" } },
    ],
    [
      "auth_container_unhealthy",
      { auth: { health: "unhealthy", state: "running" } },
    ],
    [
      "api_gateway_unavailable",
      { gateway: { health: "none", state: "exited" } },
    ],
    ["unknown_local_supabase_failure", {}],
  ])("classifies %s", (expected, snapshots) => {
    expect(
      classifyLocalSupabaseFailure({
        error: readinessError(),
        snapshots,
      }),
    ).toBe(expected);
  });

  it("normalizes untrusted diagnostic fields without leaking them", () => {
    const secret =
      "service-role-key private@example.test response-body database-password";
    const lines = formatLocalSupabaseDiagnostics({
      error: readinessError(),
      snapshots: {
        auth: { health: secret, state: secret },
        database: { health: secret, state: secret },
        gateway: { health: secret, state: secret },
      },
    });
    const output = lines.join("\n");

    expect(output).not.toContain(secret);
    expect(output).toContain(
      "classification=unknown_local_supabase_failure readiness_code=deadline_exceeded status=502",
    );
    expect(lines).toHaveLength(4);
  });
});

describe("runLocalAuthReadinessBoundary", () => {
  it("allows at most one explicitly configured recovery cycle", async () => {
    const firstError = readinessError();
    const finalError = readinessError();
    const waitForReady = vi
      .fn()
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(finalError);
    const recover = vi.fn(async () => undefined);
    const diagnose = vi.fn(async () => undefined);

    await expect(
      runLocalAuthReadinessBoundary({
        diagnose,
        logger: createLogger(),
        recover,
        waitForReady,
      }),
    ).rejects.toBe(finalError);
    expect(waitForReady).toHaveBeenCalledTimes(2);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(diagnose).toHaveBeenNthCalledWith(1, firstError, { cycle: 1 });
    expect(diagnose).toHaveBeenNthCalledWith(2, finalError, { cycle: 2 });
  });

  it("does not recover a non-retryable failure", async () => {
    const error = readinessError("non_retryable_failure", "http", 401);
    const recover = vi.fn();

    await expect(
      runLocalAuthReadinessBoundary({
        recover,
        waitForReady: async () => {
          throw error;
        },
      }),
    ).rejects.toBe(error);
    expect(recover).not.toHaveBeenCalled();
  });
});
