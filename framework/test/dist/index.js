// Test entry point. Build with `gleam run -- --event-loop framework/tools/build.js`
// then run with `gleam run -- --event-loop framework/test/dist/index.js`.

   

import { run } from "./harness.js";
import "./volt.test.js";

async function main()  {
  const summary = await run();
  Arc.log("");
  Arc.log(summary.passed + " passed, " + summary.failed + " failed");
  for (const failure of summary.failures) {
    Arc.log("  " + failure);
  }
  const verdict = summary.failed === 0 ? "VOLT TESTS PASSED" : "VOLT TESTS FAILED";
  Arc.log(verdict);
  Arc.writeFile(
    "framework/test/dist/.last-run.json",
    JSON.stringify(summary),
  );
}

main();
