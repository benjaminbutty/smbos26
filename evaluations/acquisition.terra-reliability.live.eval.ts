import { runLiveAcquisitionGate } from "../src/ai/evaluation/acquisition/live";

const result = await runLiveAcquisitionGate("reliability", {
  AI_PROVIDER: process.env.AI_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  RUN_LIVE_OPENAI_ACQUISITION_RELIABILITY:
    process.env.RUN_LIVE_OPENAI_ACQUISITION_RELIABILITY,
});
if (!result.ran) console.log("Live acquisition reliability not run.");
else if (!result.passed) process.exitCode = 1;
