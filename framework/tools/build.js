// Build Volt: strip types from framework/src/*.ts into framework/lib/*.js
// and framework/test/*.test.ts into framework/test/dist/*.test.js.
//
// Runs on arc itself:
//
//   gleam run -- --event-loop framework/tools/build.js

import { strip } from "./strip.js";

const ROOT = "framework";

function buildDir(srcDir, outDir) {
  const names = Arc.readDir(srcDir);
  let count = 0;
  for (const name of names) {
    if (!name.endsWith(".ts")) continue;
    const source = Arc.readFile(srcDir + "/" + name);
    const out = strip(source);
    const outName = name.slice(0, -3) + ".js";
    Arc.writeFile(outDir + "/" + outName, out);
    count++;
  }
  return count;
}

const libCount = buildDir(ROOT + "/src", ROOT + "/lib");
Arc.log("built " + libCount + " modules into " + ROOT + "/lib");

if (Arc.exists(ROOT + "/test")) {
  const testCount = buildDir(ROOT + "/test", ROOT + "/test/dist");
  Arc.log("built " + testCount + " test modules into " + ROOT + "/test/dist");
}
