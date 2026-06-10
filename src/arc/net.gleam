//// TCP socket primitives as opt-in host functions, driven by the
//// `arc/beam` mailbox macrotask loop.
////
//// Arc core has no I/O. This module is embedder surface (like `arc/beam`):
//// it exposes sockets as Erlang processes wrapped in Pid objects, and every
//// async operation hands out a Promise via `host.suspend` that the socket's
//// owner process settles by sending `SettlePromise` to this VM process's
//// mailbox — the same protocol `setTimeout` uses, so `beam.run` drives it
//// with no extra plumbing.
////
//// Byte bridge: socket data crosses as JS strings whose char codes are all
//// bytes (0–255, latin1). Text protocols can use them directly; binary
//// protocols index with `charCodeAt`. Writing a string containing a char
//// code above 255 settles `false` — UTF-8 encode first.
////
////     const listener = Arc.listen(8080);
////     const conn = await Arc.accept(listener);   // Pid | null
////     const chunk = await Arc.read(conn);        // string | null (closed)
////     await Arc.write(conn, "hello");            // boolean
////     Arc.close(conn);

import arc/host
import arc/vm/builtins/process_objects
import arc/vm/heap
import arc/vm/state.{type Heap, type HostFn, type State, State}
import arc/vm/value.{
  type JsValue, type Ref, Finite, JsNumber, JsObject, JsString, JsUndefined,
}
import gleam/option.{type Option, None, Some}

// -- FFI -----------------------------------------------------------------------

@external(erlang, "arc_net_ffi", "listen")
fn ffi_listen(port: Int) -> Result(value.ErlangPid, String)

@external(erlang, "arc_net_ffi", "accept")
fn ffi_accept(listener: value.ErlangPid, ticket: Ref) -> Nil

@external(erlang, "arc_net_ffi", "connect")
fn ffi_connect(host: String, port: Int, ticket: Ref) -> Nil

@external(erlang, "arc_net_ffi", "read")
fn ffi_read(conn: value.ErlangPid, ticket: Ref) -> Nil

@external(erlang, "arc_net_ffi", "write")
fn ffi_write(conn: value.ErlangPid, ticket: Ref, data: String) -> Nil

@external(erlang, "arc_net_ffi", "close")
fn ffi_close(sock: value.ErlangPid) -> Nil

@external(erlang, "arc_net_ffi", "ws_accept_key")
fn ffi_ws_accept_key(key: String) -> String

@external(erlang, "arc_net_ffi", "peer_name")
fn ffi_peer_name(conn: value.ErlangPid, ticket: Ref) -> Nil

@external(erlang, "arc_net_ffi", "sock_name")
fn ffi_sock_name(listener: value.ErlangPid, ticket: Ref) -> Nil

// -- namespace -----------------------------------------------------------------

/// The socket host functions, for concatenation onto the `Arc` namespace
/// (or any other) via `engine.define_namespace`.
pub fn namespace() -> List(#(String, Int, HostFn)) {
  [
    #("listen", 1, listen),
    #("accept", 1, accept),
    #("connect", 2, connect),
    #("read", 1, read),
    #("write", 2, write),
    #("close", 1, close),
    #("wsAcceptKey", 1, ws_accept_key),
    #("peerName", 1, peer_name),
    #("listenerPort", 1, listener_port),
  ]
}

// -- helpers -------------------------------------------------------------------

fn pid_arg(state: State, args: List(JsValue)) -> Option(value.ErlangPid) {
  case args {
    [JsObject(ref), ..] -> heap.read_pid(state.heap, ref)
    _ -> None
  }
}

/// Suspend and hand the ticket to an FFI request sender; the socket process
/// (or its relay) settles it.
fn suspend_with(
  state: State,
  pid: value.ErlangPid,
  kick_off: fn(value.ErlangPid, Ref) -> Nil,
) -> #(State, Result(JsValue, JsValue)) {
  let #(state, promise, ticket) = host.suspend(state)
  kick_off(pid, ticket)
  #(state, Ok(promise))
}

// -- host functions ------------------------------------------------------------

/// `Arc.listen(port)` — open a TCP listener, returning its Pid. Throws on
/// failure (port in use, permission). Port 0 picks a free port; read it
/// back with `Arc.listenerPort(listener)`.
fn listen(
  args: List(JsValue),
  _this: JsValue,
  state: State,
) -> #(State, Result(JsValue, JsValue)) {
  let port = case args {
    [JsNumber(Finite(n)), ..] -> Some(value.float_to_int(n))
    _ -> None
  }
  case port {
    None -> state.type_error(state, "Arc.listen: port must be a number")
    Some(port) ->
      case ffi_listen(port) {
        Error(reason) ->
          state.type_error(state, "Arc.listen failed: " <> reason)
        Ok(pid) -> {
          let #(heap, pid_val) = alloc_pid(state, pid)
          #(State(..state, heap:), Ok(pid_val))
        }
      }
  }
}

fn alloc_pid(state: State, pid: value.ErlangPid) -> #(Heap, JsValue) {
  process_objects.alloc_pid_object(
    state.heap,
    state.builtins.object.prototype,
    state.builtins.function.prototype,
    pid,
  )
}

/// `Arc.accept(listener)` — Promise of the next connection's Pid, or null
/// once the listener is closed.
fn accept(
  args: List(JsValue),
  _this: JsValue,
  state: State,
) -> #(State, Result(JsValue, JsValue)) {
  case pid_arg(state, args) {
    None -> state.type_error(state, "Arc.accept: expected a listener Pid")
    Some(pid) -> suspend_with(state, pid, ffi_accept)
  }
}

/// `Arc.connect(host, port)` — Promise of a connection Pid; rejects with a
/// reason string when the connection fails.
fn connect(
  args: List(JsValue),
  _this: JsValue,
  state: State,
) -> #(State, Result(JsValue, JsValue)) {
  case args {
    [JsString(host), JsNumber(Finite(n)), ..] -> {
      let port = value.float_to_int(n)
      let #(state, promise, ticket) = host.suspend(state)
      ffi_connect(host, port, ticket)
      #(state, Ok(promise))
    }
    _ ->
      state.type_error(
        state,
        "Arc.connect: expected (host: string, port: number)",
      )
  }
}

/// `Arc.read(conn)` — Promise of the next chunk of bytes as a latin1
/// string, or null once the peer has closed and the buffer is drained.
fn read(
  args: List(JsValue),
  _this: JsValue,
  state: State,
) -> #(State, Result(JsValue, JsValue)) {
  case pid_arg(state, args) {
    None -> state.type_error(state, "Arc.read: expected a connection Pid")
    Some(pid) -> suspend_with(state, pid, ffi_read)
  }
}

/// `Arc.write(conn, data)` — Promise of true when the bytes were handed to
/// the kernel, false when the connection is closed (or data isn't a byte
/// string).
fn write(
  args: List(JsValue),
  _this: JsValue,
  state: State,
) -> #(State, Result(JsValue, JsValue)) {
  let data = case args {
    [_, JsString(data), ..] -> Some(data)
    _ -> None
  }
  case pid_arg(state, args), data {
    Some(pid), Some(data) ->
      suspend_with(state, pid, fn(pid, ticket) { ffi_write(pid, ticket, data) })
    _, _ ->
      state.type_error(state, "Arc.write: expected (conn: Pid, data: string)")
  }
}

/// `Arc.close(sock)` — close a listener or connection. Fire-and-forget.
fn close(
  args: List(JsValue),
  _this: JsValue,
  state: State,
) -> #(State, Result(JsValue, JsValue)) {
  case pid_arg(state, args) {
    None -> state.type_error(state, "Arc.close: expected a socket Pid")
    Some(pid) -> {
      ffi_close(pid)
      #(state, Ok(JsUndefined))
    }
  }
}

/// `Arc.wsAcceptKey(key)` — RFC 6455 Sec-WebSocket-Accept for a
/// Sec-WebSocket-Key: base64(sha1(key + magic GUID)).
fn ws_accept_key(
  args: List(JsValue),
  _this: JsValue,
  state: State,
) -> #(State, Result(JsValue, JsValue)) {
  case args {
    [JsString(key), ..] -> #(state, Ok(JsString(ffi_ws_accept_key(key))))
    _ -> state.type_error(state, "Arc.wsAcceptKey: expected a string")
  }
}

/// `Arc.peerName(conn)` — Promise of the remote peer as "ip:port".
fn peer_name(
  args: List(JsValue),
  _this: JsValue,
  state: State,
) -> #(State, Result(JsValue, JsValue)) {
  case pid_arg(state, args) {
    None -> state.type_error(state, "Arc.peerName: expected a connection Pid")
    Some(pid) -> suspend_with(state, pid, ffi_peer_name)
  }
}

/// `Arc.listenerPort(listener)` — Promise of the listener's local port
/// (useful after `Arc.listen(0)`).
fn listener_port(
  args: List(JsValue),
  _this: JsValue,
  state: State,
) -> #(State, Result(JsValue, JsValue)) {
  case pid_arg(state, args) {
    None -> state.type_error(state, "Arc.listenerPort: expected a listener Pid")
    Some(pid) -> suspend_with(state, pid, ffi_sock_name)
  }
}
