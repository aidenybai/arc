//// Filesystem primitives as opt-in host functions.
////
//// Embedder surface (like `arc/net`): synchronous wrappers over the Erlang
//// `file` module, exposed for build tooling and static file serving. File
//// contents use the latin1 byte-string bridge described in `arc/net` — one
//// JS char = one byte, so binary files round-trip.
////
////     const source = Arc.readFile("src/app.ts"); // throws on error
////     Arc.writeFile("dist/app.js", output);
////     const names = Arc.readDir("src");           // string[]
////     Arc.exists("gleam.toml");                   // boolean

import arc/vm/builtins/common
import arc/vm/state.{type HostFn, type State, State}
import arc/vm/value.{type JsValue, JsBool, JsObject, JsString, JsUndefined}
import gleam/list

// -- FFI -----------------------------------------------------------------------

@external(erlang, "arc_fs_ffi", "read_file")
fn ffi_read_file(path: String) -> Result(String, String)

@external(erlang, "arc_fs_ffi", "write_file")
fn ffi_write_file(path: String, data: String) -> Result(Nil, String)

@external(erlang, "arc_fs_ffi", "list_dir")
fn ffi_list_dir(path: String) -> Result(List(String), String)

@external(erlang, "arc_fs_ffi", "exists")
fn ffi_exists(path: String) -> Bool

// -- namespace -----------------------------------------------------------------

/// The filesystem host functions, for concatenation onto the `Arc`
/// namespace via `engine.define_namespace`.
pub fn namespace() -> List(#(String, Int, HostFn)) {
  [
    #("readFile", 1, read_file),
    #("writeFile", 2, write_file),
    #("readDir", 1, read_dir),
    #("exists", 1, exists),
  ]
}

// -- host functions ------------------------------------------------------------

/// `Arc.readFile(path)` — file contents as a latin1 byte string. Throws on
/// error (missing file, permission).
fn read_file(
  args: List(JsValue),
  _this: JsValue,
  state: State,
) -> #(State, Result(JsValue, JsValue)) {
  case args {
    [JsString(path), ..] ->
      case ffi_read_file(path) {
        Ok(data) -> #(state, Ok(JsString(data)))
        Error(reason) ->
          state.type_error(state, "Arc.readFile: " <> path <> ": " <> reason)
      }
    _ -> state.type_error(state, "Arc.readFile: expected a path string")
  }
}

/// `Arc.writeFile(path, data)` — write a latin1 byte string. Throws on
/// error.
fn write_file(
  args: List(JsValue),
  _this: JsValue,
  state: State,
) -> #(State, Result(JsValue, JsValue)) {
  case args {
    [JsString(path), JsString(data), ..] ->
      case ffi_write_file(path, data) {
        Ok(Nil) -> #(state, Ok(JsUndefined))
        Error(reason) ->
          state.type_error(state, "Arc.writeFile: " <> path <> ": " <> reason)
      }
    _ ->
      state.type_error(
        state,
        "Arc.writeFile: expected (path: string, data: string)",
      )
  }
}

/// `Arc.readDir(path)` — sorted array of entry names. Throws on error.
fn read_dir(
  args: List(JsValue),
  _this: JsValue,
  state: State,
) -> #(State, Result(JsValue, JsValue)) {
  case args {
    [JsString(path), ..] ->
      case ffi_list_dir(path) {
        Ok(names) -> {
          let #(heap, arr_ref) =
            common.alloc_array(
              state.heap,
              list.map(names, JsString),
              state.builtins.array.prototype,
            )
          #(State(..state, heap:), Ok(JsObject(arr_ref)))
        }
        Error(reason) ->
          state.type_error(state, "Arc.readDir: " <> path <> ": " <> reason)
      }
    _ -> state.type_error(state, "Arc.readDir: expected a path string")
  }
}

/// `Arc.exists(path)` — true when a file or directory exists at the path.
fn exists(
  args: List(JsValue),
  _this: JsValue,
  state: State,
) -> #(State, Result(JsValue, JsValue)) {
  case args {
    [JsString(path), ..] -> #(state, Ok(JsBool(ffi_exists(path))))
    _ -> state.type_error(state, "Arc.exists: expected a path string")
  }
}
