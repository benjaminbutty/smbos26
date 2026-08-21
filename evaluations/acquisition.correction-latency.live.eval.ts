import {
  runLiveAcquisitionCorrectionLatencyDiagnostic,
  type AcquisitionCorrectionLatencyDiagnosticCandidate,
} from "../src/ai/evaluation/acquisition/correction-latency-diagnostic-live";

const candidate = process.env.ACQUISITION_LATENCY_CANDIDATE as
  AcquisitionCorrectionLatencyDiagnosticCandidate | undefined;
if (candidate !== "luna_max_fast" && candidate !== "sol_medium") {
  throw new Error(
    "ACQUISITION_LATENCY_CANDIDATE must be luna_max_fast or sol_medium.",
  );
}

const result = await runLiveAcquisitionCorrectionLatencyDiagnostic(
  {
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    RUN_LIVE_OPENAI_ACQUISITION_CORRECTION_LATENCY:
      process.env.RUN_LIVE_OPENAI_ACQUISITION_CORRECTION_LATENCY,
  },
  candidate,
);
if (!result.ran) {
  console.log("Live acquisition correction latency diagnostic not run.");
}
