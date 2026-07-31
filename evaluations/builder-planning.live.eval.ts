import { runLiveBuilderEvaluation } from "../src/ai/evaluation/live";
import { builderEvaluationTopLevelFailureSchema } from "../src/ai/evaluation/schemas";

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
    JSON.stringify(
      builderEvaluationTopLevelFailureSchema.parse({
        evaluation_error_code: "evaluation_setup_failed",
      }),
    ),
  );
  process.exitCode = 1;
}
