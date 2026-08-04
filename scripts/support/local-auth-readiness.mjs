import console from "node:console";
import { setTimeout as wait } from "node:timers/promises";
import { URL } from "node:url";

export const LOCAL_AUTH_READINESS_TIMEOUT_MS = 60_000;
export const LOCAL_AUTH_READINESS_INITIAL_DELAY_MS = 250;
export const LOCAL_AUTH_READINESS_MAX_DELAY_MS = 5_000;

const retryableStatuses = new Set([429, 500, 502, 503, 504]);
const retryableCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
]);
const safeContainerStates = new Set([
  "created",
  "dead",
  "exited",
  "paused",
  "removing",
  "restarting",
  "running",
]);
const safeHealthStates = new Set(["healthy", "none", "starting", "unhealthy"]);
const localComponents = Object.freeze([
  {
    key: "auth",
    container: "supabase_auth_smbos26",
  },
  {
    key: "gateway",
    container: "supabase_kong_smbos26",
  },
  {
    key: "database",
    container: "supabase_db_smbos26",
  },
]);

function checkedPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function errorCandidates(error) {
  const candidates = [];
  const pending = [error];
  const seen = new Set();

  while (pending.length > 0) {
    const candidate = pending.shift();
    if (
      (typeof candidate !== "object" && typeof candidate !== "function") ||
      candidate === null ||
      seen.has(candidate)
    ) {
      continue;
    }

    seen.add(candidate);
    candidates.push(candidate);
    if (candidate.error) {
      pending.push(candidate.error);
    }
    if (candidate.cause) {
      pending.push(candidate.cause);
    }
  }

  return candidates;
}

function normalizeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : null;
}

function readinessReason(error) {
  for (const candidate of errorCandidates(error)) {
    const status = normalizeHttpStatus(
      candidate.status ?? candidate.statusCode,
    );
    if (status !== null) {
      return {
        retryable: retryableStatuses.has(status),
        status,
        type: "http",
      };
    }

    if (retryableCodes.has(candidate.code)) {
      return { retryable: true, status: null, type: "network" };
    }

    if (candidate.name === "AbortError" || candidate.name === "TimeoutError") {
      return { retryable: true, status: null, type: "timeout" };
    }
  }

  return { retryable: false, status: null, type: "unknown" };
}

function safeStatus(value) {
  return normalizeHttpStatus(value) ?? "none";
}

function writeReadinessEvent(logger, level, event) {
  const method = logger?.[level] ?? logger?.log;
  if (typeof method !== "function") {
    return;
  }
  method.call(
    logger,
    `Local Auth readiness attempt=${event.attempt} status=${safeStatus(event.status)} delay_ms=${event.delayMs} code=${event.code}`,
  );
}

export class LocalAuthReadinessError extends Error {
  constructor({ attempt, code, reason = "unknown", status = null }) {
    super(
      `Local Auth readiness failed attempt=${attempt} status=${safeStatus(status)} code=${code}`,
    );
    this.name = "LocalAuthReadinessError";
    this.attempt = attempt;
    this.code = code;
    this.reason = reason;
    this.status = normalizeHttpStatus(status);
  }
}

function asReadinessError(error, fallbackCode = "unknown_failure") {
  if (error instanceof LocalAuthReadinessError) {
    return error;
  }
  const reason = readinessReason(error);
  return new LocalAuthReadinessError({
    attempt: 0,
    code: fallbackCode,
    reason: reason.type,
    status: reason.status,
  });
}

function resultReason(result) {
  if (result?.ok === true) {
    return null;
  }
  return readinessReason(result);
}

export function createLocalAuthAdminProbe({
  apiUrl,
  fetchImpl = globalThis.fetch,
  serviceRoleKey,
}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError(
      "Local Auth readiness requires a fetch implementation.",
    );
  }

  const endpoint = new URL("/auth/v1/admin/users", apiUrl);
  endpoint.searchParams.set("page", "1");
  endpoint.searchParams.set("per_page", "1");

  return async ({ signal }) => {
    const response = await fetchImpl(endpoint, {
      headers: {
        accept: "application/json",
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
      method: "GET",
      redirect: "error",
      signal,
    });
    await response.body?.cancel();
    return { ok: response.ok, status: response.status };
  };
}

export async function waitForLocalAuthReadiness({
  initialDelayMs = LOCAL_AUTH_READINESS_INITIAL_DELAY_MS,
  logger = console,
  maxDelayMs = LOCAL_AUTH_READINESS_MAX_DELAY_MS,
  now = Date.now,
  probe,
  sleep = wait,
  timeoutMs = LOCAL_AUTH_READINESS_TIMEOUT_MS,
}) {
  const checkedTimeout = checkedPositiveInteger(timeoutMs, "Readiness timeout");
  const checkedInitialDelay = checkedPositiveInteger(
    initialDelayMs,
    "Initial readiness delay",
  );
  const checkedMaxDelay = checkedPositiveInteger(
    maxDelayMs,
    "Maximum readiness delay",
  );
  if (checkedInitialDelay > checkedMaxDelay) {
    throw new TypeError(
      "Initial readiness delay must not exceed the maximum delay.",
    );
  }
  if (typeof probe !== "function") {
    throw new TypeError("Local Auth readiness requires a probe operation.");
  }

  const deadline = now() + checkedTimeout;
  let attempt = 0;
  let lastReason = { retryable: true, status: null, type: "unknown" };

  while (now() < deadline) {
    attempt += 1;
    const remainingMs = Math.max(1, deadline - now());
    let reason;

    try {
      const result = await probe({
        signal: globalThis.AbortSignal.timeout(remainingMs),
      });
      reason = resultReason(result);
      if (reason === null) {
        writeReadinessEvent(logger, "info", {
          attempt,
          code: "ready",
          delayMs: 0,
          status: result.status ?? 200,
        });
        return { attempt, status: normalizeHttpStatus(result.status) ?? 200 };
      }
    } catch (error) {
      reason = readinessReason(error);
    }

    lastReason = reason;
    if (!reason.retryable) {
      writeReadinessEvent(logger, "error", {
        attempt,
        code: "non_retryable_failure",
        delayMs: 0,
        status: reason.status,
      });
      throw new LocalAuthReadinessError({
        attempt,
        code: "non_retryable_failure",
        reason: reason.type,
        status: reason.status,
      });
    }

    const remainingAfterProbeMs = deadline - now();
    if (remainingAfterProbeMs <= 0) {
      break;
    }
    const exponentialDelay = Math.min(
      checkedMaxDelay,
      checkedInitialDelay * 2 ** (attempt - 1),
    );
    const delayMs = Math.min(exponentialDelay, remainingAfterProbeMs);
    writeReadinessEvent(logger, "warn", {
      attempt,
      code: "retrying",
      delayMs,
      status: reason.status,
    });
    await sleep(delayMs);
  }

  writeReadinessEvent(logger, "error", {
    attempt,
    code: "deadline_exceeded",
    delayMs: 0,
    status: lastReason.status,
  });
  throw new LocalAuthReadinessError({
    attempt,
    code: "deadline_exceeded",
    reason: lastReason.type,
    status: lastReason.status,
  });
}

function normalizedContainerState(value) {
  return safeContainerStates.has(value) ? value : "unknown";
}

function normalizedHealthState(value) {
  return safeHealthStates.has(value) ? value : "unknown";
}

function isUnhealthy(snapshot) {
  if (!snapshot) {
    return false;
  }
  const state = normalizedContainerState(snapshot.state);
  const health = normalizedHealthState(snapshot.health);
  return (state !== "running" && state !== "unknown") || health === "unhealthy";
}

export function classifyLocalSupabaseFailure({ error, snapshots = {} }) {
  if (isUnhealthy(snapshots.database)) {
    return "database_unavailable";
  }
  if (isUnhealthy(snapshots.auth)) {
    return "auth_container_unhealthy";
  }
  if (isUnhealthy(snapshots.gateway) || error?.reason === "network") {
    return "api_gateway_unavailable";
  }
  return "unknown_local_supabase_failure";
}

export function formatLocalSupabaseDiagnostics({ error, snapshots = {} }) {
  const safeError = asReadinessError(error);
  const lines = localComponents.map(({ container, key }) => {
    const snapshot = snapshots[key];
    return `Local Supabase diagnostic component=${key} container=${container} state=${normalizedContainerState(snapshot?.state)} health=${normalizedHealthState(snapshot?.health)}`;
  });
  lines.push(
    `Local Supabase diagnostic classification=${classifyLocalSupabaseFailure({ error: safeError, snapshots })} readiness_code=${safeError.code} status=${safeStatus(safeError.status)}`,
  );
  return lines;
}

export async function runLocalAuthReadinessBoundary({
  diagnose,
  logger = console,
  recover,
  waitForReady,
}) {
  if (typeof waitForReady !== "function") {
    throw new TypeError("A local Auth readiness check is required.");
  }

  try {
    return await waitForReady();
  } catch (error) {
    const firstError = asReadinessError(error);
    await diagnose?.(firstError, { cycle: 1 });
    if (
      typeof recover !== "function" ||
      firstError.code !== "deadline_exceeded"
    ) {
      throw firstError;
    }

    writeReadinessEvent(logger, "warn", {
      attempt: firstError.attempt,
      code: "recovery_started",
      delayMs: 0,
      status: firstError.status,
    });
    try {
      await recover();
    } catch (error) {
      const recoveryError = asReadinessError(error, "recovery_failed");
      await diagnose?.(recoveryError, { cycle: 2 });
      throw recoveryError;
    }

    try {
      return await waitForReady();
    } catch (error) {
      const finalError = asReadinessError(error);
      await diagnose?.(finalError, { cycle: 2 });
      throw finalError;
    }
  }
}
