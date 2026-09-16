"use client";

import type { ChangeEvent, FormEvent, ReactNode } from "react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";

import type { SitePublicFormAction } from "../../core/sites/schemas";
import {
  sitePublicUploadCapabilitySchema,
  sitePublicUploadLimits,
} from "../../core/sites/upload-protocol";

type Answers = Record<string, unknown>;

const subscribeToHydration = (): (() => void) => () => {};
const getClientHydrationSnapshot = (): boolean => true;
const getServerHydrationSnapshot = (): boolean => false;

type RecoveryMode = "expired" | "conflict" | "stale" | "unavailable" | null;

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
  readonly recoveryMode: "expired" | "conflict" | "stale" | null;

  constructor(
    message: string,
    _canStartNewAttempt = false,
    recoveryMode: "expired" | "conflict" | "stale" | null = _canStartNewAttempt
      ? "conflict"
      : null,
  ) {
    super(message);
    this.name = "PublicUploadClientError";
    this.recoveryMode = recoveryMode;
  }
}

type StoredAnswer = {
  fieldType: string;
  value: string | number | boolean | string[];
};

function compatibleAnswersStorageKey(
  businessSlug: string,
  actionKey: string,
): string {
  return `smbos:site-form-answers:${businessSlug}:${actionKey}`;
}

function latestReviewStorageKey(
  businessSlug: string,
  actionKey: string,
): string {
  return `smbos:site-form-review:${businessSlug}:${actionKey}`;
}

function isStoredAnswer(value: unknown): value is StoredAnswer {
  if (typeof value !== "object" || value === null || !("fieldType" in value)) {
    return false;
  }
  const candidate = value as { fieldType?: unknown; value?: unknown };
  if (typeof candidate.fieldType !== "string") return false;
  if (
    typeof candidate.value === "string" ||
    typeof candidate.value === "boolean" ||
    (typeof candidate.value === "number" && Number.isFinite(candidate.value))
  ) {
    return true;
  }
  return (
    Array.isArray(candidate.value) &&
    candidate.value.every((item) => typeof item === "string")
  );
}

function readCompatibleAnswers(
  storageKey: string,
  action: SitePublicFormAction,
): Answers {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw || raw.length > 65536) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const questions = new Map(
      action.questions.map((question) => [question.key, question]),
    );
    const restored: Answers = {};
    for (const [key, value] of Object.entries(parsed)) {
      const question = questions.get(key);
      if (
        !question ||
        question.field_type === "file" ||
        !isStoredAnswer(value) ||
        value.fieldType !== question.field_type ||
        questionValidationError(question, value.value) !== null
      ) {
        continue;
      }
      restored[key] = value.value;
    }
    return restored;
  } catch {
    return {};
  }
}

function writeCompatibleAnswers(
  storageKey: string,
  action: SitePublicFormAction,
  answers: Answers,
): void {
  if (typeof window === "undefined") return;
  const stored = Object.fromEntries(
    action.questions.flatMap((question) => {
      if (question.field_type === "file") return [];
      const value = answers[question.key];
      if (
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)) ||
        (Array.isArray(value) &&
          value.every((item) => typeof item === "string"))
      ) {
        return [[question.key, { fieldType: question.field_type, value }]];
      }
      return [];
    }),
  );
  try {
    const encoded = JSON.stringify(stored);
    if (new TextEncoder().encode(encoded).byteLength > 65536) {
      window.sessionStorage.removeItem(storageKey);
      return;
    }
    window.sessionStorage.setItem(storageKey, encoded);
  } catch {
    // The in-memory answers remain available when session storage is unavailable.
  }
}

function removeStoredCompatibleAnswers(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // A completed or reviewed response does not need durable answer state.
  }
}

function readPendingLatestReview(storageKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(storageKey);
    return value && /^s_[a-f0-9]{64}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function setPendingLatestReview(
  storageKey: string,
  releaseToken: string,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey, releaseToken);
  } catch {
    // The in-memory review state still blocks a fresh submission.
  }
}

function clearPendingLatestReview(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // The in-memory review state is authoritative for this mounted Form.
  }
}

function questionInputId(actionKey: string, questionKey: string): string {
  return `site-form-${actionKey}-${questionKey}`;
}

function questionErrorId(actionKey: string, questionKey: string): string {
  return `${questionInputId(actionKey, questionKey)}-error`;
}

function questionValidationError(
  question: SitePublicFormAction["questions"][number],
  value: unknown,
  options: Readonly<{ allowRetainedFile?: boolean }> = {},
): string | null {
  if (!answerPresent(value)) {
    if (question.field_type === "file" && options.allowRetainedFile) {
      return null;
    }
    return question.required ? `${question.label} is required.` : null;
  }
  switch (question.field_type) {
    case "short_text":
    case "long_text":
    case "email":
    case "phone":
    case "url":
    case "date":
    case "datetime":
      return typeof value === "string" ? null : `${question.label} needs text.`;
    case "number":
    case "currency":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `${question.label} needs a number.`;
    case "boolean":
      return typeof value === "boolean"
        ? null
        : `${question.label} needs Yes or No.`;
    case "select":
    case "status":
      return typeof value === "string" &&
        (question.options ?? []).includes(value)
        ? null
        : `${question.label} needs one of the available options.`;
    case "multi_select":
      return Array.isArray(value) &&
        value.every(
          (item) =>
            typeof item === "string" && (question.options ?? []).includes(item),
        )
        ? null
        : `${question.label} needs one or more available options.`;
    case "file":
      return filesFromAnswer(value).length > 0
        ? null
        : question.required
          ? `${question.label} is required.`
          : null;
    default:
      return null;
  }
}

function compatibleAnswersForAction(
  previousAction: SitePublicFormAction,
  nextAction: SitePublicFormAction,
  answers: Answers,
): Answers {
  const previousQuestions = new Map(
    previousAction.questions.map((question) => [question.key, question]),
  );
  const compatible: Answers = {};
  for (const question of nextAction.questions) {
    if (question.field_type === "file") continue;
    const previousQuestion = previousQuestions.get(question.key);
    const value = answers[question.key];
    if (
      !previousQuestion ||
      previousQuestion.field_type !== question.field_type ||
      !answerPresent(value) ||
      questionValidationError(question, value) !== null
    ) {
      continue;
    }
    compatible[question.key] = value;
  }
  return compatible;
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

function fileInputChangeStorageKey(storageKey: string): string {
  return `${storageKey}:file-input-changed`;
}

function readStoredFileInputChanged(storageKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

function writeStoredFileInputChanged(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey, "1");
  } catch {
    // The in-memory marker still protects this mounted response attempt.
  }
}

function clearStoredFileInputChanged(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // A cleared attempt does not need durable file-input state.
  }
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

function retainedFilesForQuestion(
  manifest: UploadManifest | null,
  questionKey: string,
): UploadManifestFile[] {
  if (!manifest) return [];
  const files = manifest.files.filter(
    (file) => file.questionKey === questionKey,
  );
  if (files.length === 0) return [];
  const finalizedGrantIds = new Set(manifest.finalizedGrantIds);
  const allFinalized = files.every((file) => {
    const capability = manifest.capabilities.find(
      (candidate) =>
        candidate.question_key === file.questionKey &&
        candidate.file_ordinal === file.fileOrdinal,
    );
    return Boolean(capability && finalizedGrantIds.has(capability.grant_id));
  });
  return allFinalized ? files : [];
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
  if (code === "site_upload_unavailable") {
    return new PublicUploadClientError(
      "The file upload is no longer available. Review the latest Form before sending again.",
      false,
      "stale",
    );
  }
  if (code === "site_upload_expired" || response.status === 410) {
    return new PublicUploadClientError(
      "This response attempt has expired. Start a new response attempt.",
      true,
      "expired",
    );
  }
  if (code === "site_upload_not_found" || response.status === 404) {
    return new PublicUploadClientError(
      "The selected file could not be found. Start a new response attempt.",
      true,
      "conflict",
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
  const router = useRouter();
  const storageKey = attemptStorageKey(businessSlug, pageSlug, action);
  const manifestStorageKey = uploadManifestStorageKey(storageKey);
  const fileInputChangeKey = fileInputChangeStorageKey(storageKey);
  const answersStorageKey = compatibleAnswersStorageKey(
    businessSlug,
    action.action_key,
  );
  const reviewStorageKey = latestReviewStorageKey(
    businessSlug,
    action.action_key,
  );
  const [answers, setAnswers] = useState<Answers>({});
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [questionErrors, setQuestionErrors] = useState<Record<string, string>>(
    {},
  );
  const [showValidationSummary, setShowValidationSummary] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState<RecoveryMode>(null);
  const [reviewState, setReviewState] = useState<
    "none" | "refreshing" | "needs_ack"
  >("none");
  const [staleReleaseToken, setStaleReleaseToken] = useState<string | null>(
    null,
  );
  const previousAction = useRef(action);
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
  const [fileInputChanged, setFileInputChanged] = useState(() =>
    readStoredFileInputChanged(fileInputChangeKey),
  );
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const hasHydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const visibleQuestions = useMemo(
    () => visibleQuestionsForAnswers(action, answers),
    [action, answers],
  );

  useEffect(() => {
    const restoredAnswers = readCompatibleAnswers(answersStorageKey, action);
    const priorAction = previousAction.current;
    const actionChanged =
      priorAction.action_key === action.action_key &&
      priorAction.release_token !== action.release_token;
    const pendingReleaseToken = readPendingLatestReview(reviewStorageKey);
    const pendingNewAction =
      pendingReleaseToken !== null &&
      pendingReleaseToken !== action.release_token;
    if (
      (actionChanged || pendingNewAction) &&
      (staleReleaseToken || pendingReleaseToken) &&
      reviewState !== "needs_ack"
    ) {
      const previousActionForStorage =
        pendingNewAction && pendingReleaseToken
          ? { ...action, release_token: pendingReleaseToken }
          : priorAction;
      const oldStorageKey = attemptStorageKey(
        businessSlug,
        pageSlug,
        previousActionForStorage,
      );
      const oldManifestStorageKey = uploadManifestStorageKey(oldStorageKey);
      const oldFileInputChangeKey = fileInputChangeStorageKey(oldStorageKey);
      try {
        window.sessionStorage.removeItem(oldStorageKey);
      } catch {
        // The old token is also cleared from component state below.
      }
      removeStoredUploadManifest(oldManifestStorageKey);
      clearStoredFileInputChanged(oldFileInputChangeKey);
      setIdempotencyToken(null);
      setUploadManifest(null);
      setFileInputChanged(false);
      setFileInputVersion((current) => current + 1);
      setAnswers((current) =>
        compatibleAnswersForAction(priorAction, action, {
          ...restoredAnswers,
          ...current,
        }),
      );
      setRecoveryMode(null);
      setQuestionErrors({});
      setReviewState("needs_ack");
      setStatus("error");
      setMessage("The latest Form is ready. Review it before sending again.");
    } else if (Object.keys(restoredAnswers).length > 0) {
      setAnswers((current) =>
        Object.keys(current).length > 0 ? current : restoredAnswers,
      );
    }
    if (!actionChanged && pendingReleaseToken && reviewState === "none") {
      setStaleReleaseToken(pendingReleaseToken);
      setReviewState("refreshing");
      setRecoveryMode("stale");
      setStatus("error");
      setMessage("Review the latest Form before sending again.");
    }
    previousAction.current = action;
  }, [
    action,
    answersStorageKey,
    businessSlug,
    pageSlug,
    reviewStorageKey,
    reviewState,
    staleReleaseToken,
  ]);

  function saveUploadManifest(next: UploadManifest | null): void {
    setUploadManifest(next);
    if (next) {
      writeStoredUploadManifest(manifestStorageKey, next);
    } else {
      removeStoredUploadManifest(manifestStorageKey);
    }
  }

  function setAnswer(key: string, value: unknown): void {
    if (
      showValidationSummary &&
      questionErrors[key] &&
      Object.keys(questionErrors).length === 1
    ) {
      setShowValidationSummary(false);
      setMessage((current) =>
        current === "Please check the highlighted questions." ? null : current,
      );
    }
    setAnswers((current) => ({ ...current, [key]: value }));
    setQuestionErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function handleFileInputChange(
    key: string,
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    if (uploadManifest?.files.length) {
      setFileInputChanged(true);
      writeStoredFileInputChanged(fileInputChangeKey);
    }
    setAnswer(key, event.target.files?.length ? event.target.files : undefined);
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

  function reviewLatestForm(): void {
    writeCompatibleAnswers(answersStorageKey, action, answers);
    setPendingLatestReview(reviewStorageKey, action.release_token);
    setStaleReleaseToken(action.release_token);
    setReviewState("refreshing");
    setStatus("error");
    setMessage("Loading the latest Form. Review it before sending again.");
    router.refresh();
  }

  function acknowledgeLatestReview(): void {
    clearPendingLatestReview(reviewStorageKey);
    setStaleReleaseToken(null);
    setReviewState("none");
    setRecoveryMode(null);
    setStatus("idle");
    setMessage(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (preview || status === "submitting") return;
    if (reviewState !== "none") {
      setStatus("error");
      setMessage(
        reviewState === "needs_ack"
          ? "Review the latest Form before sending a new response."
          : "The latest Form is still loading. Review it before sending again.",
      );
      return;
    }
    if (recoveryMode === "stale" || recoveryMode === "unavailable") return;
    if (
      fileInputChanged &&
      uploadManifest?.files.length &&
      visibleQuestions
        .filter((question) => question.field_type === "file")
        .every(
          (question) => filesFromAnswer(answers[question.key]).length === 0,
        )
    ) {
      setQuestionErrors({});
      setShowValidationSummary(false);
      setStatus("error");
      setRecoveryMode("conflict");
      setMessage(
        "The selected files changed. Start a new response attempt before sending them.",
      );
      return;
    }
    const nextQuestionErrors: Record<string, string> = {};
    for (const question of visibleQuestions) {
      const error = questionValidationError(question, answers[question.key], {
        allowRetainedFile:
          !fileInputChanged &&
          question.field_type === "file" &&
          retainedFilesForQuestion(uploadManifest, question.key).length > 0,
      });
      if (error) nextQuestionErrors[question.key] = error;
    }
    setQuestionErrors(nextQuestionErrors);
    const firstInvalidQuestion = visibleQuestions.find(
      (question) => nextQuestionErrors[question.key],
    );
    if (firstInvalidQuestion) {
      setShowValidationSummary(true);
      setStatus("error");
      setMessage("Please check the highlighted questions.");
      window.requestAnimationFrame(() => {
        document
          .getElementById(
            questionInputId(action.action_key, firstInvalidQuestion.key),
          )
          ?.focus();
      });
      return;
    }
    setShowValidationSummary(false);
    const submittedAnswers = Object.fromEntries(
      visibleQuestions.flatMap((question) => {
        const value = answers[question.key];
        return question.field_type !== "file" && answerPresent(value)
          ? [[question.key, value]]
          : [];
      }),
    );
    writeCompatibleAnswers(answersStorageKey, action, submittedAnswers);
    setStatus("submitting");
    setMessage(null);
    setRecoveryMode(null);
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
                "expired",
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
        const code = responseCode(result);
        const nextRecoveryMode: RecoveryMode =
          code === "action_unavailable"
            ? "stale"
            : code === "not_found" || response.status === 404
              ? "unavailable"
              : code === "idempotency_conflict"
                ? "conflict"
                : null;
        const detail =
          typeof result === "object" && result !== null && "message" in result
            ? String(result.message)
            : nextRecoveryMode === "stale"
              ? "This response version is no longer current. Review the latest Form before sending again."
              : nextRecoveryMode === "unavailable"
                ? "This Form is no longer available."
                : "This Form could not be sent. Review your answers and try again.";
        if (nextRecoveryMode === "stale") {
          writeCompatibleAnswers(answersStorageKey, action, answers);
          setPendingLatestReview(reviewStorageKey, action.release_token);
          setStaleReleaseToken(action.release_token);
          setReviewState("refreshing");
        }
        setStatus("error");
        setMessage(detail);
        setRecoveryMode(nextRecoveryMode);
        return;
      }
      const reference =
        typeof result === "object" &&
        result !== null &&
        "publicReference" in result
          ? String(result.publicReference)
          : null;
      setStatus("success");
      setRecoveryMode(null);
      setQuestionErrors({});
      setShowValidationSummary(false);
      removeStoredCompatibleAnswers(answersStorageKey);
      clearPendingLatestReview(reviewStorageKey);
      removeStoredUploadManifest(manifestStorageKey);
      clearStoredFileInputChanged(fileInputChangeKey);
      try {
        window.sessionStorage.removeItem(storageKey);
      } catch {
        // A completed response does not need durable client state.
      }
      setUploadManifest(null);
      setIdempotencyToken(null);
      setFileInputChanged(false);
      setMessage(
        reference
          ? `Thanks. Your reference is ${reference}.`
          : "Thanks. Your response was sent.",
      );
    } catch (error) {
      if (error instanceof PublicUploadClientError) {
        if (error.recoveryMode === "stale") {
          writeCompatibleAnswers(answersStorageKey, action, answers);
          setPendingLatestReview(reviewStorageKey, action.release_token);
          setStaleReleaseToken(action.release_token);
          setReviewState("refreshing");
        }
        setStatus("error");
        setMessage(error.message);
        setRecoveryMode(error.recoveryMode);
        return;
      }
      setStatus("error");
      setRecoveryMode(null);
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
          <fieldset
            disabled={status === "submitting" || recoveryMode === "unavailable"}
          >
            {visibleQuestions.map((question) => {
              const value = answers[question.key];
              const inputId = questionInputId(action.action_key, question.key);
              const helpId = `${inputId}-help`;
              const error = questionErrors[question.key];
              const errorId = questionErrorId(action.action_key, question.key);
              const retainedFiles =
                hasHydrated &&
                !fileInputChanged &&
                question.field_type === "file"
                  ? retainedFilesForQuestion(uploadManifest, question.key)
                  : [];
              const retainedId =
                retainedFiles.length > 0 ? `${inputId}-retained` : null;
              const describedBy =
                [
                  question.help_text ? helpId : null,
                  error ? errorId : null,
                  retainedId,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined;
              const inputAria = {
                "aria-describedby": describedBy,
                "aria-invalid": error ? true : undefined,
                "aria-required": question.required ? true : undefined,
              };
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
                    {question.label}
                    {question.required ? (
                      <span aria-hidden="true" className="required-mark">
                        *
                      </span>
                    ) : null}
                  </label>
                  {question.field_type === "long_text" ? (
                    <textarea
                      {...inputAria}
                      id={inputId}
                      onChange={(event) =>
                        setAnswer(question.key, event.target.value)
                      }
                      value={typeof value === "string" ? value : ""}
                    />
                  ) : question.field_type === "boolean" ? (
                    <select
                      {...inputAria}
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
                      {...inputAria}
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
                      {...inputAria}
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
                      {...inputAria}
                      id={inputId}
                      accept={
                        question.upload_kind === "pdf"
                          ? "application/pdf"
                          : "image/jpeg,image/png,image/webp"
                      }
                      multiple={Boolean((question.upload_count ?? 1) > 1)}
                      onChange={(event) =>
                        handleFileInputChange(question.key, event)
                      }
                      type="file"
                    />
                  ) : (
                    <input
                      {...inputAria}
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
                      step={
                        question.field_type === "number" ||
                        question.field_type === "currency"
                          ? "any"
                          : undefined
                      }
                      type={inputType(question.field_type)}
                      value={
                        value === undefined || value === null
                          ? ""
                          : String(value)
                      }
                    />
                  )}
                  {retainedFiles.length > 0 ? (
                    <p className="field-help" id={retainedId ?? undefined}>
                      Retained for retry:{" "}
                      {retainedFiles.map((file) => file.name).join(", ")}. These
                      files will be included in this response.
                    </p>
                  ) : null}
                  {question.help_text ? (
                    <p className="field-help" id={helpId}>
                      {question.help_text}
                    </p>
                  ) : null}
                  {error ? (
                    <p className="field-help" id={errorId} role="alert">
                      {error}
                    </p>
                  ) : null}
                </div>
              );
            })}
            {message ? <p role="alert">{message}</p> : null}
            {reviewState === "refreshing" && recoveryMode === "stale" ? (
              <button onClick={reviewLatestForm} type="button">
                Review latest Form
              </button>
            ) : null}
            {reviewState === "needs_ack" ? (
              <div className="field-help" role="status">
                <p>
                  The latest version is ready. Review the questions before
                  sending.
                </p>
                <button onClick={acknowledgeLatestReview} type="button">
                  I’ve reviewed the latest Form
                </button>
              </div>
            ) : null}
            {recoveryMode === "expired" || recoveryMode === "conflict" ? (
              <button
                onClick={() => {
                  try {
                    window.sessionStorage.removeItem(storageKey);
                  } catch {
                    // The next attempt can still use a fresh in-memory token.
                  }
                  removeStoredUploadManifest(manifestStorageKey);
                  clearStoredFileInputChanged(fileInputChangeKey);
                  setIdempotencyToken(null);
                  setUploadManifest(null);
                  setFileInputChanged(false);
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
                  setRecoveryMode(null);
                  setQuestionErrors({});
                  setShowValidationSummary(false);
                }}
                type="button"
              >
                Start a new response attempt
              </button>
            ) : null}
            <button
              disabled={
                preview ||
                status === "submitting" ||
                reviewState !== "none" ||
                recoveryMode === "unavailable"
              }
              type="submit"
            >
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
