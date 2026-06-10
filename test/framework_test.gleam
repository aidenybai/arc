//// Integration test for the Volt framework (framework/): runs the framework
//// test suite on the engine with the beam event loop and the net/fs host
//// functions, then asserts every test passed via the summary the suite
//// writes to framework/test/dist/.last-run.json.

import arc/beam
import arc/engine
import arc/fs
import arc/internal/path
import arc/net
import gleam/list
import gleam/result
import gleam/string
import simplifile

const entry = "framework/test/dist/index.js"

const summary_path = "framework/test/dist/.last-run.json"

fn resolve_and_load_dep(
  raw_specifier: String,
  parent_specifier: String,
) -> Result(#(String, String), String) {
  let resolved = path.resolve_specifier(raw_specifier, parent_specifier)
  use source <- result.map(
    simplifile.read(resolved)
    |> result.map_error(fn(err) {
      "file not found: " <> resolved <> " (" <> string.inspect(err) <> ")"
    }),
  )
  #(resolved, source)
}

pub fn volt_framework_suite_test() {
  let assert Ok(source) = simplifile.read(entry)
  let _ = simplifile.delete(summary_path)
  let eng =
    engine.define_namespace(
      engine.new(),
      "Arc",
      list.flatten([beam.namespace(), net.namespace(), fs.namespace()]),
    )
  let assert Ok(_) =
    engine.eval_module_prepared_with(
      eng,
      entry,
      source,
      resolve_and_load_dep,
      beam.install_atomics_capabilities,
      beam.run,
    )
  let assert Ok(summary) = simplifile.read(summary_path)
  assert string.contains(summary, "\"failed\":0")
}
