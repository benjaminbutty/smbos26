import { runLiveBuilderEvaluation } from "../src/ai/evaluation/live";

try {
  const result = await runLiveBuilderEvaluation({
    RUN_LIVE_OPENAI_EVAL: process.env.RUN_LIVE_OPENAI_EVAL,
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });
  if (!result.ran) {
    console.log("Live builder planning evaluation not run.");
  } else if (!result.passed) {
    process.exitCode = 1;
  }
} catch {
  console.log(
    JSON.stringify({
      scenario_id: "preorder_phone_optional",
      error_code: "ai_execution_failed",
    }),
  );
  process.exitCode = 1;
}
