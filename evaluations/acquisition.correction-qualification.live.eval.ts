import { runLiveAcquisitionCorrectionQualification } from "../src/ai/evaluation/acquisition/correction-qualification-live";

const result = await runLiveAcquisitionCorrectionQualification({
  AI_PROVIDER: process.env.AI_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  RUN_LIVE_OPENAI_ACQUISITION_CORRECTION_QUALIFICATION:
    process.env.RUN_LIVE_OPENAI_ACQUISITION_CORRECTION_QUALIFICATION,
});
if (!result.ran) {
  console.log("Live acquisition correction qualification not run.");
} else if (!result.passed) {
  process.exitCode = 1;
}
