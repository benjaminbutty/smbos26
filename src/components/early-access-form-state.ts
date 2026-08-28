export type EarlyAccessFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

export const EARLY_ACCESS_INITIAL_STATE: EarlyAccessFormState = {
  status: "idle",
};
