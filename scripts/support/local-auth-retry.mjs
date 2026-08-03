import console from "node:console";
import { setTimeout as wait } from "node:timers/promises";

export const LOCAL_AUTH_RETRY_DELAYS_MS = Object.freeze([
  250, 500, 1000, 2000, 4000,
]);

const retryableStatuses = new Set([429, 502, 503, 504]);
const retryableCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
]);

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

function retryReason(error) {
  for (const candidate of errorCandidates(error)) {
    const status = Number(candidate.status ?? candidate.statusCode);
    if (retryableStatuses.has(status)) {
      return { key: "status", value: status };
    }

    if (retryableCodes.has(candidate.code)) {
      return { key: "code", value: candidate.code };
    }

    if (
      candidate.name === "AuthRetryableFetchError" ||
      candidate.constructor?.name === "AuthRetryableFetchError"
    ) {
      return { key: "code", value: "AuthRetryableFetchError" };
    }
  }

  return null;
}

export function isRetryableLocalAuthError(error) {
  return retryReason(error) !== null;
}

function checkedRetryDelays(retryDelaysMs) {
  if (
    !Array.isArray(retryDelaysMs) ||
    retryDelaysMs.length > LOCAL_AUTH_RETRY_DELAYS_MS.length ||
    retryDelaysMs.some(
      (delay) =>
        !Number.isFinite(delay) || delay < 0 || !Number.isInteger(delay),
    )
  ) {
    throw new TypeError(
      "Local Auth retry delays must contain at most five non-negative integer values.",
    );
  }

  return [...retryDelaysMs];
}

function resultError(result) {
  if (
    result !== null &&
    typeof result === "object" &&
    "error" in result &&
    result.error
  ) {
    return result.error;
  }
  return null;
}

function logRetry({ label, attempt, maxAttempts, error, delay }) {
  const reason = retryReason(error);
  console.warn(
    `Local Auth retry label="${label}" attempt=${attempt}/${maxAttempts} ${reason.key}=${reason.value} delay_ms=${delay}`,
  );
}

export async function runLocalAuthOperationWithRetry({
  label,
  operation,
  sleep = wait,
  retryDelaysMs = LOCAL_AUTH_RETRY_DELAYS_MS,
}) {
  const delays = checkedRetryDelays(retryDelaysMs);
  const maxAttempts = delays.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await operation();
      const error = resultError(result);
      if (
        !error ||
        !isRetryableLocalAuthError(error) ||
        attempt === maxAttempts
      ) {
        return result;
      }

      const delay = delays[attempt - 1];
      logRetry({
        label,
        attempt: attempt + 1,
        maxAttempts,
        error,
        delay,
      });
      await sleep(delay);
    } catch (error) {
      if (!isRetryableLocalAuthError(error) || attempt === maxAttempts) {
        throw error;
      }

      const delay = delays[attempt - 1];
      logRetry({
        label,
        attempt: attempt + 1,
        maxAttempts,
        error,
        delay,
      });
      await sleep(delay);
    }
  }

  throw new Error("Local Auth retry loop ended unexpectedly.");
}

function requireAuthData(result, message) {
  if (result?.error || result?.data === null || result?.data === undefined) {
    throw result?.error ?? new Error(message);
  }
  return result.data;
}

async function listLocalUsers({ authAdmin, sleep, retryDelaysMs }) {
  return requireAuthData(
    await runLocalAuthOperationWithRetry({
      label: "list users",
      operation: () => authAdmin.listUsers({ page: 1, perPage: 1000 }),
      sleep,
      retryDelaysMs,
    }),
    "Could not inspect local demo users.",
  ).users;
}

async function updateLocalUser({
  authAdmin,
  userId,
  password,
  sleep,
  retryDelaysMs,
}) {
  return requireAuthData(
    await runLocalAuthOperationWithRetry({
      label: "update user",
      operation: () =>
        authAdmin.updateUserById(userId, {
          password,
          email_confirm: true,
        }),
      sleep,
      retryDelaysMs,
    }),
    "Could not refresh local demo user.",
  ).user;
}

export async function upsertLocalAuthUser({
  authAdmin,
  email,
  password,
  sleep = wait,
  retryDelaysMs = LOCAL_AUTH_RETRY_DELAYS_MS,
}) {
  const delays = checkedRetryDelays(retryDelaysMs);
  const users = await listLocalUsers({
    authAdmin,
    sleep,
    retryDelaysMs: delays,
  });
  const existing = users.find((user) => user.email === email);
  if (existing) {
    return updateLocalUser({
      authAdmin,
      userId: existing.id,
      password,
      sleep,
      retryDelaysMs: delays,
    });
  }

  const maxAttempts = delays.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let createResult;
    let createError;
    try {
      createResult = await authAdmin.createUser({
        email,
        password,
        email_confirm: true,
      });
      createError = resultError(createResult);
    } catch (error) {
      createError = error;
    }

    if (!createError) {
      return requireAuthData(createResult, "Could not create local demo user.")
        .user;
    }
    if (!isRetryableLocalAuthError(createError) || attempt === maxAttempts) {
      throw createError;
    }

    const delay = delays[attempt - 1];
    logRetry({
      label: "create user",
      attempt: attempt + 1,
      maxAttempts,
      error: createError,
      delay,
    });
    await sleep(delay);

    const reconciledUsers = await listLocalUsers({
      authAdmin,
      sleep,
      retryDelaysMs: delays,
    });
    const reconciled = reconciledUsers.find((user) => user.email === email);
    if (reconciled) {
      return updateLocalUser({
        authAdmin,
        userId: reconciled.id,
        password,
        sleep,
        retryDelaysMs: delays,
      });
    }
  }

  throw new Error("Local Auth user reconciliation ended unexpectedly.");
}
