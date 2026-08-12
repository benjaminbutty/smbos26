import { runLiveAcquisitionGate } from "../src/ai/evaluation/acquisition/live";

const result = await runLiveAcquisitionGate("qualification", {
  AI_PROVIDER: process.env.AI_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  RUN_LIVE_OPENAI_ACQUISITION_QUALIFICATION:
    process.env.RUN_LIVE_OPENAI_ACQUISITION_QUALIFICATION,
});
if (!result.ran) console.log("Live acquisition qualification not run.");
else if (!result.passed) process.exitCode = 1;
