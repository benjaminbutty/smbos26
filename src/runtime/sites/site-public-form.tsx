"use client";

import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import { z } from "zod";

import type { SitePublicFormAction } from "../../core/sites/schemas";
import {
  sitePublicUploadCapabilitySchema,
  sitePublicUploadLimits,
} from "../../core/sites/upload-protocol";

type Answers = Record<string, unknown>;

type UploadCapability = z.infer<typeof sitePublicUploadCapabilitySchema>;

type SelectedUploadFile = {
  questionKey: string;
  fileOrdinal: number;
  file: File;
  signature: string;
};

type UploadManifestFile = {
  questionKey: string;
  fileOrdinal: number;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  signature: string;
};

type UploadManifest = {
  attemptId: string;
  files: UploadManifestFile[];
  capabilities: UploadCapability[];
  uploadedGrantIds: string[];
  finalizedGrantIds: string[];
};

const uploadManifestSchema = z
  .object({
    attemptId: z.uuid(),
    files: z
      .array(
        z
          .object({
            questionKey: z.string().min(1).max(80),
            fileOrdinal: z.number().int().min(1).max(5),
            name: z.string().max(255),
            size: z.number().int().positive(),
            type: z.string().max(120),
            lastModified: z.number().int().nonnegative(),
            signature: z.string().regex(/^[^\n]{1,500}$/),
          })
          .strict(),
      )
      .max(sitePublicUploadLimits.maxFilesPerSubmission),
    capabilities: z
      .array(sitePublicUploadCapabilitySchema)
      .max(sitePublicUploadLimits.maxFilesPerSubmission),
    uploadedGrantIds: z
      .array(z.uuid())
      .max(sitePublicUploadLimits.maxFilesPerSubmission),
    finalizedGrantIds: z
      .array(z.uuid())
      .max(sitePublicUploadLimits.maxFilesPerSubmission),
  })
  .strict();

class PublicUploadClientError extends Error {
  readonly canStartNewAttempt: boolean;

  constructor(message: string, canStartNewAttempt = false) {
    super(message);
    this.name = "PublicUploadClientError";
    this.canStartNewAttempt = canStartNewAttempt;
  }
}

function isVisible(
  question: SitePublicFormAction["questions"][number],
  answers: Answers,
): boolean {
  const condition = question.visible_when;
  if (!condition) return true;
  const source = answers[condition.field];
  if (!answerPresent(source)) return false;
  if (condition.operator === "includes") {
    return Array.isArray(source) && source.includes(condition.value);
  }
  return condition.operator === "equals"
    ? source === condition.value
    : source !== condition.value;
}

function visibleQuestionsForAnswers(
  action: SitePublicFormAction,
  answers: Answers,
): SitePublicFormAction["questions"] {
  const visible: SitePublicFormAction["questions"] = [];
  const visibleAnswers: Answers = {};
  for (const question of action.questions) {
    if (!isVisible(question, visibleAnswers)) continue;
    visible.push(question);
    if (answerPresent(answers[question.key])) {
      visibleAnswers[question.key] = answers[question.key];
    }
  }
  return visible;
}

function answerPresent(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof FileList !== "undefined" && value instanceof FileList) {
    return value.length > 0;
  }
  return !Array.isArray(value) || value.length > 0;
}

function inputType(fieldType: string): string {
  if (fieldType === "email") return "email";
  if (fieldType === "phone") return "tel";
  if (fieldType === "url") return "url";
  if (fieldType === "number" || fieldType === "currency") return "number";
  if (fieldType === "date") return "date";
  if (fieldType === "datetime") return "datetime-local";
  return "text";
}

function filesFromAnswer(value: unknown): File[] {
  if (typeof FileList !== "undefined" && value instanceof FileList) {
    return Array.from(value);
  }
  if (typeof File !== "undefined" && Array.isArray(value)) {
    return value.filter((item): item is File => item instanceof File);
  }
  return [];
}

function attemptStorageKey(
  businessSlug: string,
  pageSlug: string,
  action: SitePublicFormAction,
): string {
  return `smbos:site-form-attempt:${businessSlug}:${pageSlug}:${action.action_key}:${action.release_token}`;
}

function readStoredAttempt(storageKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(storageKey);
    return value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
      ? value
      : null;
  } catch {
    return null;
  }
}

function uploadManifestStorageKey(storageKey: string): string {
  return `${storageKey}:manifest`;
}

function readStoredUploadManifest(storageKey: string): UploadManifest | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = uploadManifestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const manifest = parsed.data;
    const grantIds = manifest.capabilities.map(
      (capability) => capability.grant_id,
    );
    if (
      new Set(grantIds).size !== grantIds.length ||
      manifest.uploadedGrantIds.some(
        (grantId) => !grantIds.includes(grantId),
      ) ||
      manifest.finalizedGrantIds.some((grantId) => !grantIds.includes(grantId))
    ) {
      return null;
    }
    return manifest;
  } catch {
    return null;
  }
}

function writeStoredUploadManifest(
  storageKey: string,
  manifest: UploadManifest,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(manifest));
  } catch {
    // The in-memory manifest still protects the active response attempt.
  }
}

function removeStoredUploadManifest(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // A completed response does not need durable client state.
  }
}

function uploadFileKey(questionKey: string, fileOrdinal: number): string {
  return `${questionKey}:${fileOrdinal}`;
}

function expectedUploadMimeTypes(kind: "image" | "pdf"): readonly string[] {
  return kind === "pdf"
    ? ["application/pdf"]
    : ["image/jpeg", "image/png", "image/webp"];
}

function uploadMaximumBytes(kind: "image" | "pdf"): number {
  return kind === "pdf"
    ? sitePublicUploadLimits.maxPdfBytes
    : sitePublicUploadLimits.maxImageBytes;
}

async function fileSignature(file: File): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new PublicUploadClientError(
      "This browser cannot securely prepare the selected file. Try another browser.",
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(await file.arrayBuffer()),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${file.name}\0${file.size}\0${file.type}\0${file.lastModified}\0${hash}`;
}

async function selectedUploadFiles(
  questions: SitePublicFormAction["questions"],
  answers: Answers,
): Promise<SelectedUploadFile[]> {
  const selected: SelectedUploadFile[] = [];
  for (const question of questions) {
    if (question.field_type !== "file") continue;
    const files = filesFromAnswer(answers[question.key]);
    const maximumFiles = question.upload_count ?? 1;
    if (files.length > maximumFiles) {
      throw new PublicUploadClientError(
        `${question.label} accepts up to ${maximumFiles} file${maximumFiles === 1 ? "" : "s"}.`,
      );
    }
    const kind = question.upload_kind ?? "image";
    const allowedMimeTypes = expectedUploadMimeTypes(kind);
    const maximumBytes = uploadMaximumBytes(kind);
    for (const [index, file] of files.entries()) {
      const mimeType = file.type.trim().toLowerCase();
      if (!file.size || file.size > maximumBytes) {
        const maximumMegabytes = Math.round(maximumBytes / (1024 * 1024));
        throw new PublicUploadClientError(
          `${file.name || "This file"} is too large. Choose a file up to ${maximumMegabytes} MB.`,
        );
      }
      if (mimeType && !allowedMimeTypes.includes(mimeType)) {
        throw new PublicUploadClientError(
          `${file.name || "This file"} is not a supported ${kind} file.`,
        );
      }
      selected.push({
        questionKey: question.key,
        fileOrdinal: index + 1,
        file,
        signature: await fileSignature(file),
      });
    }
  }
  if (selected.length > sitePublicUploadLimits.maxFilesPerSubmission) {
    throw new PublicUploadClientError(
      `Choose at most ${sitePublicUploadLimits.maxFilesPerSubmission} files.`,
    );
  }
  return selected;
}

function manifestFiles(selected: SelectedUploadFile[]): UploadManifestFile[] {
  return selected.map(({ file, fileOrdinal, questionKey, signature }) => ({
    fileOrdinal,
    lastModified: file.lastModified,
    name: file.name,
    questionKey,
    signature,
    size: file.size,
    type: file.type,
  }));
}

function manifestMatchesSelected(
  manifest: UploadManifest,
  selected: SelectedUploadFile[],
): boolean {
  const stored = new Map(
    manifest.files.map((file) => [
      uploadFileKey(file.questionKey, file.fileOrdinal),
      file,
    ]),
  );
  if (stored.size !== selected.length) return false;
  return selected.every((item) => {
    const file = stored.get(uploadFileKey(item.questionKey, item.fileOrdinal));
    return Boolean(
      file &&
      file.name === item.file.name &&
      file.size === item.file.size &&
      file.type === item.file.type &&
      file.lastModified === item.file.lastModified &&
      file.signature === item.signature,
    );
  });
}

function configuredStorageOrigin(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return null;
  }
}

function assertConfiguredUploadUrl(uploadUrl: string): void {
  let target: URL;
  try {
    target = new URL(uploadUrl);
  } catch {
    throw new PublicUploadClientError("The file upload capability is invalid.");
  }
  const origin = configuredStorageOrigin();
  if (
    !origin ||
    target.origin !== origin ||
    target.protocol !== new URL(origin).protocol ||
    target.username ||
    target.password ||
    target.hash ||
    !target.pathname.startsWith("/storage/v1/")
  ) {
    throw new PublicUploadClientError("The file upload capability is invalid.");
  }
}

async function fetchWithStorageDeadline(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, sitePublicUploadLimits.storageCallTimeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch {
    throw new PublicUploadClientError(
      timedOut
        ? "The file service did not respond in time. Try sending again."
        : "The file could not be transferred. Check your connection and try again.",
    );
  } finally {
    window.clearTimeout(timer);
  }
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function responseCode(result: unknown): string | null {
  if (
    typeof result === "object" &&
    result !== null &&
    "code" in result &&
    typeof result.code === "string"
  ) {
    return result.code;
  }
  return null;
}

function responseIsOk(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    result.ok === true
  );
}

function uploadResponseError(
  response: Response,
  result: unknown,
): PublicUploadClientError {
  const code = responseCode(result);
  if (
    response.status === 404 ||
    response.status === 410 ||
    code === "site_upload_expired" ||
    code === "site_upload_not_found"
  ) {
    return new PublicUploadClientError(
      "This response attempt has expired. Start a new response attempt.",
      true,
    );
  }
  if (response.status === 429) {
    return new PublicUploadClientError(
      "Too many file requests. Wait a moment and try again.",
    );
  }
  if (response.status === 409 && code === "site_upload_quota_exceeded") {
    return new PublicUploadClientError(
      "There is not enough upload space for these files. Try smaller files.",
    );
  }
  return new PublicUploadClientError(
    "The files could not be prepared. Check your files and try again.",
  );
}

function orderedCapabilities(
  capabilities: UploadCapability[],
  selected: SelectedUploadFile[],
): UploadCapability[] {
  const byFile = new Map(
    capabilities.map((capability) => [
      uploadFileKey(capability.question_key, capability.file_ordinal),
      capability,
    ]),
  );
  if (
    byFile.size !== capabilities.length ||
    capabilities.length !== selected.length
  ) {
    throw new PublicUploadClientError(
      "The file upload capability is incomplete.",
    );
  }
  const ordered = selected.map((item) =>
    byFile.get(uploadFileKey(item.questionKey, item.fileOrdinal)),
  );
  if (ordered.some((capability) => !capability)) {
    throw new PublicUploadClientError(
      "The file upload capability is incomplete.",
    );
  }
  return ordered as UploadCapability[];
}

function publicFormEndpoint(
  businessSlug: string,
  pageSlug: string,
  action: SitePublicFormAction,
): string {
  return `/api/public/sites/${encodeURIComponent(businessSlug)}/${encodeURIComponent(
    pageSlug,
  )}/${encodeURIComponent(action.action_key)}`;
}

export function SitePublicForm({
  action,
  businessSlug,
  pageSlug,
  preview = false,
}: Readonly<{
  action: SitePublicFormAction;
  businessSlug: string;
  pageSlug: string;
  preview?: boolean;
}>): ReactNode {
  const storageKey = attemptStorageKey(businessSlug, pageSlug, action);
  const manifestStorageKey = uploadManifestStorageKey(storageKey);
  const [answers, setAnswers] = useState<Answers>({});
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [canStartNewAttempt, setCanStartNewAttempt] = useState(false);
  const [idempotencyToken, setIdempotencyToken] = useState<string | null>(() =>
    readStoredAttempt(storageKey),
  );
  const [uploadManifest, setUploadManifest] = useState<UploadManifest | null>(
    () => {
      const token = readStoredAttempt(storageKey);
      const manifest = readStoredUploadManifest(manifestStorageKey);
      return token && manifest?.attemptId === token ? manifest : null;
    },
  );
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const visibleQuestions = useMemo(
    () => visibleQuestionsForAnswers(action, answers),
    [action, answers],
  );

  function saveUploadManifest(next: UploadManifest | null): void {
    setUploadManifest(next);
    if (next) {
      writeStoredUploadManifest(manifestStorageKey, next);
    } else {
      removeStoredUploadManifest(manifestStorageKey);
    }
  }

  function setAnswer(key: string, value: unknown): void {
    setAnswers((current) => ({ ...current, [key]: value }));
  }

  function handleChoiceChange(
    event: ChangeEvent<HTMLSelectElement>,
    key: string,
    multiple: boolean,
  ): void {
    if (multiple) {
      setAnswer(
        key,
        Array.from(event.target.selectedOptions, (option) => option.value),
      );
      return;
    }
    setAnswer(key, event.target.value);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (preview || status === "submitting") return;
    for (const question of visibleQuestions) {
      if (question.required && !answerPresent(answers[question.key])) {
        setStatus("error");
        setMessage(`${question.label} is required.`);
        return;
      }
    }
    setStatus("submitting");
    setMessage(null);
    setCanStartNewAttempt(false);
    try {
      const selected = await selectedUploadFiles(visibleQuestions, answers);
      const token = idempotencyToken ?? crypto.randomUUID();
      if (!idempotencyToken) {
        setIdempotencyToken(token);
        try {
          window.sessionStorage.setItem(storageKey, token);
        } catch {
          // The in-memory token still protects retries when session storage is unavailable.
        }
      }

      let manifest = uploadManifest;
      if (manifest && manifest.attemptId !== token) {
        throw new PublicUploadClientError(
          "These files belong to a different response attempt. Start a new response attempt.",
          true,
        );
      }
      if (
        manifest &&
        selected.length > 0 &&
        !manifestMatchesSelected(manifest, selected)
      ) {
        throw new PublicUploadClientError(
          "The selected files changed. Start a new response attempt before sending them.",
          true,
        );
      }
      if (manifest && manifest.files.length > 0) {
        const visibleFileKeys = new Set(
          visibleQuestions
            .filter((question) => question.field_type === "file")
            .map((question) => question.key),
        );
        if (
          manifest.files.some((file) => !visibleFileKeys.has(file.questionKey))
        ) {
          throw new PublicUploadClientError(
            "A previously selected file is no longer visible in these answers. Start a new response attempt.",
            true,
          );
        }
      }
      if (manifest && selected.length === 0 && manifest.files.length > 0) {
        const allFinalized = manifest.capabilities.every((capability) =>
          manifest?.finalizedGrantIds.includes(capability.grant_id),
        );
        if (!allFinalized) {
          throw new PublicUploadClientError(
            "Re-select the files for this response attempt, or start a new response attempt.",
            true,
          );
        }
      }

      if (selected.length > 0 && !manifest) {
        setMessage("Preparing files…");
        const issueResponse = await fetchWithStorageDeadline(
          `${publicFormEndpoint(businessSlug, pageSlug, action)}/uploads`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              releaseToken: action.release_token,
              submissionAttemptId: token,
              files: Array.from(
                selected.reduce(
                  (counts, file) =>
                    counts.set(
                      file.questionKey,
                      (counts.get(file.questionKey) ?? 0) + 1,
                    ),
                  new Map<string, number>(),
                ),
                ([questionKey, count]) => ({ questionKey, count }),
              ),
            }),
          },
        );
        const issueResult = await responseBody(issueResponse);
        if (!issueResponse.ok) {
          throw uploadResponseError(issueResponse, issueResult);
        }
        const issueCapabilities =
          typeof issueResult === "object" &&
          issueResult !== null &&
          "capabilities" in issueResult
            ? issueResult.capabilities
            : null;
        const parsedCapabilities = z
          .array(sitePublicUploadCapabilitySchema)
          .max(sitePublicUploadLimits.maxFilesPerSubmission)
          .safeParse(issueCapabilities);
        if (!responseIsOk(issueResult) || !parsedCapabilities.success) {
          throw new PublicUploadClientError(
            "The file upload capability is incomplete. Try again.",
          );
        }
        manifest = {
          attemptId: token,
          capabilities: orderedCapabilities(parsedCapabilities.data, selected),
          files: manifestFiles(selected),
          finalizedGrantIds: [],
          uploadedGrantIds: [],
        };
        saveUploadManifest(manifest);
      }

      if (manifest && selected.length > 0) {
        const capabilities = orderedCapabilities(
          manifest.capabilities,
          selected,
        );
        for (const [index, capability] of capabilities.entries()) {
          if (!manifest.uploadedGrantIds.includes(capability.grant_id)) {
            if (Date.parse(capability.expires_at) <= Date.now()) {
              throw new PublicUploadClientError(
                "This response attempt has expired. Start a new response attempt.",
                true,
              );
            }
            const selectedFile = selected[index];
            if (!selectedFile) {
              throw new PublicUploadClientError(
                "The file upload capability is incomplete.",
              );
            }
            assertConfiguredUploadUrl(capability.upload_url);
            setMessage(`Uploading file ${index + 1} of ${selected.length}…`);
            const uploadResponse = await fetchWithStorageDeadline(
              capability.upload_url,
              {
                method: "PUT",
                headers: {
                  "content-type":
                    selectedFile.file.type || "application/octet-stream",
                },
                body: selectedFile.file,
              },
            );
            if (!uploadResponse.ok && uploadResponse.status !== 409) {
              const uploadResult = await responseBody(uploadResponse);
              throw uploadResponseError(uploadResponse, uploadResult);
            }
            manifest = {
              ...manifest,
              uploadedGrantIds: [
                ...manifest.uploadedGrantIds,
                capability.grant_id,
              ],
            };
            saveUploadManifest(manifest);
          }
          if (!manifest.finalizedGrantIds.includes(capability.grant_id)) {
            setMessage(`Checking file ${index + 1} of ${selected.length}…`);
            const finalizeResponse = await fetchWithStorageDeadline(
              `${publicFormEndpoint(businessSlug, pageSlug, action)}/uploads/${encodeURIComponent(
                capability.grant_id,
              )}/finalize`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  releaseToken: action.release_token,
                  submissionAttemptId: token,
                }),
              },
            );
            const finalizeResult = await responseBody(finalizeResponse);
            if (!finalizeResponse.ok) {
              throw uploadResponseError(finalizeResponse, finalizeResult);
            }
            if (!responseIsOk(finalizeResult)) {
              throw new PublicUploadClientError(
                "The selected file could not be checked. Try again.",
              );
            }
            manifest = {
              ...manifest,
              finalizedGrantIds: [
                ...manifest.finalizedGrantIds,
                capability.grant_id,
              ],
            };
            saveUploadManifest(manifest);
          }
        }
      }

      const submittedAnswers = Object.fromEntries(
        visibleQuestions.flatMap((question) => {
          const value = answers[question.key];
          return question.field_type !== "file" && answerPresent(value)
            ? [[question.key, value]]
            : [];
        }),
      );
      const response = await fetch(
        publicFormEndpoint(businessSlug, pageSlug, action),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            releaseToken: action.release_token,
            idempotencyToken: token,
            submissionAttemptId: token,
            answers: submittedAnswers,
            grantIds:
              manifest?.capabilities.map((capability) => capability.grant_id) ??
              [],
          }),
        },
      );
      const result: unknown = await responseBody(response);
      if (!response.ok) {
        const detail =
          typeof result === "object" && result !== null && "message" in result
            ? String(result.message)
            : "This Form could not be sent. Review your answers and try again.";
        setStatus("error");
        setMessage(detail);
        setCanStartNewAttempt(
          response.status === 404 ||
            (typeof result === "object" &&
              result !== null &&
              "code" in result &&
              (result.code === "idempotency_conflict" ||
                result.code === "action_unavailable" ||
                result.code === "not_found")),
        );
        return;
      }
      const reference =
        typeof result === "object" &&
        result !== null &&
        "publicReference" in result
          ? String(result.publicReference)
          : null;
      setStatus("success");
      setCanStartNewAttempt(false);
      removeStoredUploadManifest(manifestStorageKey);
      try {
        window.sessionStorage.removeItem(storageKey);
      } catch {
        // A completed response does not need durable client state.
      }
      setUploadManifest(null);
      setIdempotencyToken(null);
      setMessage(
        reference
          ? `Thanks. Your reference is ${reference}.`
          : "Thanks. Your response was sent.",
      );
    } catch (error) {
      if (error instanceof PublicUploadClientError) {
        setStatus("error");
        setMessage(error.message);
        setCanStartNewAttempt(error.canStartNewAttempt);
        return;
      }
      setStatus("error");
      setMessage(
        "This Form could not be sent. Check your connection and try again.",
      );
    }
  }

  return (
    <section className="site-public-form" aria-label={action.form_name}>
      <h2>{action.form_name}</h2>
      {preview ? (
        <p className="muted">Preview only. Responses are disabled.</p>
      ) : null}
      {status === "success" ? (
        <p role="status">{message}</p>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={status === "submitting"}>
            {visibleQuestions.map((question) => {
              const value = answers[question.key];
              const inputId = `site-form-${action.action_key}-${question.key}`;
              const helpId = `${inputId}-help`;
              const describedBy = question.help_text ? helpId : undefined;
              return (
                <div
                  className="form-field"
                  key={
                    question.field_type === "file"
                      ? `${question.key}:${fileInputVersion}`
                      : question.key
                  }
                >
                  <label htmlFor={inputId}>
                    <span>
                      {question.label}
                      {question.required ? (
                        <span aria-label="required" className="required-mark">
                          *
                        </span>
                      ) : null}
                    </span>
                  </label>
                  {question.field_type === "long_text" ? (
                    <textarea
                      aria-describedby={describedBy}
                      id={inputId}
                      onChange={(event) =>
                        setAnswer(question.key, event.target.value)
                      }
                      value={typeof value === "string" ? value : ""}
                    />
                  ) : question.field_type === "boolean" ? (
                    <select
                      aria-describedby={describedBy}
                      id={inputId}
                      onChange={(event) =>
                        setAnswer(
                          question.key,
                          event.target.value === ""
                            ? undefined
                            : event.target.value === "true",
                        )
                      }
                      value={typeof value === "boolean" ? String(value) : ""}
                    >
                      <option value="">Choose Yes or No</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : question.field_type === "select" ||
                    question.field_type === "status" ? (
                    <select
                      aria-describedby={describedBy}
                      id={inputId}
                      onChange={(event) =>
                        handleChoiceChange(event, question.key, false)
                      }
                      value={typeof value === "string" ? value : ""}
                    >
                      <option value="">Choose an option</option>
                      {(question.options ?? []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : question.field_type === "multi_select" ? (
                    <select
                      aria-describedby={describedBy}
                      id={inputId}
                      multiple
                      onChange={(event) =>
                        handleChoiceChange(event, question.key, true)
                      }
                      value={Array.isArray(value) ? value.map(String) : []}
                    >
                      {(question.options ?? []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : question.field_type === "file" ? (
                    <input
                      aria-describedby={describedBy}
                      id={inputId}
                      accept={
                        question.upload_kind === "pdf"
                          ? "application/pdf"
                          : "image/jpeg,image/png,image/webp"
                      }
                      multiple={Boolean((question.upload_count ?? 1) > 1)}
                      onChange={(event) =>
                        setAnswer(
                          question.key,
                          event.target.files?.length
                            ? event.target.files
                            : undefined,
                        )
                      }
                      type="file"
                    />
                  ) : (
                    <input
                      aria-describedby={describedBy}
                      id={inputId}
                      onChange={(event) =>
                        setAnswer(
                          question.key,
                          question.field_type === "number" ||
                            question.field_type === "currency"
                            ? event.target.value === ""
                              ? undefined
                              : Number(event.target.value)
                            : event.target.value,
                        )
                      }
                      type={inputType(question.field_type)}
                      value={
                        value === undefined || value === null
                          ? ""
                          : String(value)
                      }
                    />
                  )}
                  {question.help_text ? (
                    <p className="field-help" id={helpId}>
                      {question.help_text}
                    </p>
                  ) : null}
                </div>
              );
            })}
            {message ? <p role="alert">{message}</p> : null}
            {canStartNewAttempt ? (
              <button
                onClick={() => {
                  try {
                    window.sessionStorage.removeItem(storageKey);
                  } catch {
                    // The next attempt can still use a fresh in-memory token.
                  }
                  removeStoredUploadManifest(manifestStorageKey);
                  setIdempotencyToken(null);
                  setUploadManifest(null);
                  setAnswers((current) => {
                    const next = { ...current };
                    for (const question of action.questions) {
                      if (question.field_type === "file") {
                        delete next[question.key];
                      }
                    }
                    return next;
                  });
                  setFileInputVersion((current) => current + 1);
                  setStatus("idle");
                  setMessage(null);
                  setCanStartNewAttempt(false);
                }}
                type="button"
              >
                Start a new response attempt
              </button>
            ) : null}
            <button disabled={preview || status === "submitting"} type="submit">
              {preview
                ? "Disabled in preview"
                : status === "submitting"
                  ? "Sending…"
                  : (action.submit_label ?? "Send response")}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
