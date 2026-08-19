import { runLiveAcquisitionProductReliability } from "../src/ai/evaluation/acquisition/product-reliability-live";

const result = await runLiveAcquisitionProductReliability({
  AI_PROVIDER: process.env.AI_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  RUN_LIVE_OPENAI_ACQUISITION_PRODUCT_RELIABILITY:
    process.env.RUN_LIVE_OPENAI_ACQUISITION_PRODUCT_RELIABILITY,
});

if (!result.ran) {
  console.log("Live acquisition product-reliability corpus not run.");
} else if (!result.passed) {
  process.exitCode = 1;
}
