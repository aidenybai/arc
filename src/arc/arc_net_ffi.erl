-module(arc_net_ffi).
-export([listen/1, accept/2, connect/3, read/2, write/3, close/1,
         ws_accept_key/1, peer_name/2, sock_name/2]).

%% TCP embedder layer for `src/arc/net.gleam` — the socket counterpart of
%% arc_beam_ffi.erl. Every socket is its own Erlang process that owns one
%% gen_tcp socket; the JS side holds the process's pid (as a PidObject) and
%% talks to it through the suspend/settle protocol of beam.run: async
%% operations send `{settle_promise, Ticket, {ok, PortableMessage}}` back to
%% the VM process's mailbox.
%%
%% Byte bridge: JS strings cross the boundary as UTF-8 Gleam strings whose
%% code points are all =< 255, i.e. latin1-encoded byte buffers. Inbound
%% socket bytes are widened latin1->utf8; outbound strings are narrowed
%% utf8->latin1. This keeps arbitrary binary data representable as ordinary
%% JS strings (one char = one byte).

-define(WS_MAGIC, <<"258EAFA5-E914-47DA-95CA-C5AB0DC85B11">>).

%% -- PortableMessage constructors (mirror arc/vm/value.gleam) ----------------

pm(Root) -> {portable_message, Root, #{}}.
pm_pid(Pid) -> {portable_message, {pv_ref, 0}, #{0 => {pr_pid, Pid}}}.
pm_string(Bin) -> pm({pv_string, Bin}).
pm_bool(B) -> pm({pv_bool, B}).
pm_null() -> pm(pv_null).

settle(ReplyTo, Ticket, Pm) ->
    ReplyTo ! {settle_promise, Ticket, {ok, Pm}},
    nil.

reject(ReplyTo, Ticket, Pm) ->
    ReplyTo ! {settle_promise, Ticket, {error, Pm}},
    nil.

bytes_to_string(Bytes) ->
    unicode:characters_to_binary(Bytes, latin1, utf8).

string_to_bytes(Str) ->
    unicode:characters_to_binary(Str, utf8, latin1).

%% -- listen -------------------------------------------------------------------

%% Open a listening socket owned by a fresh listener process. Synchronous:
%% returns {ok, Pid} or {error, ReasonString} to the calling host function.
listen(Port) ->
    Caller = self(),
    Ref = make_ref(),
    Pid = spawn(fun() ->
        case gen_tcp:listen(Port, [binary, {active, false}, {reuseaddr, true},
                                   {nodelay, true}, {backlog, 128}]) of
            {ok, LSock} ->
                Caller ! {Ref, ok},
                listener_loop(LSock);
            {error, Reason} ->
                Caller ! {Ref, {error, Reason}}
        end
    end),
    receive
        {Ref, ok} -> {ok, Pid};
        {Ref, {error, Reason}} ->
            {error, iolist_to_binary(io_lib:format("~p", [Reason]))}
    after 5000 ->
        exit(Pid, kill),
        {error, <<"listen timed out">>}
    end.

listener_loop(LSock) ->
    receive
        {accept, ReplyTo, Ticket} ->
            spawn(fun() -> acceptor(LSock, ReplyTo, Ticket) end),
            listener_loop(LSock);
        {port, ReplyTo, Ticket} ->
            Port = case inet:port(LSock) of
                {ok, P} -> {pv_number, {finite, float(P)}};
                {error, _} -> pv_null
            end,
            settle(ReplyTo, Ticket, pm(Port)),
            listener_loop(LSock);
        {close, _From} ->
            gen_tcp:close(LSock)
    end.

acceptor(LSock, ReplyTo, Ticket) ->
    case gen_tcp:accept(LSock) of
        {ok, Sock} ->
            ok = inet:setopts(Sock, [{active, true}]),
            settle(ReplyTo, Ticket, pm_pid(self())),
            conn_loop(Sock, <<>>, queue:new(), false);
        {error, _Reason} ->
            %% Listener closed (or accept failed): resolve with null so
            %% `while (conn = await Arc.accept(l))` loops terminate.
            settle(ReplyTo, Ticket, pm_null())
    end.

%% -- connect ------------------------------------------------------------------

%% Async connect: settles the ticket with a conn pid, or rejects with a
%% reason string.
connect(Host, Port, Ticket) ->
    ReplyTo = self(),
    spawn(fun() ->
        HostStr = unicode:characters_to_list(Host),
        case gen_tcp:connect(HostStr, Port,
                             [binary, {active, true}, {nodelay, true}],
                             10000) of
            {ok, Sock} ->
                settle(ReplyTo, Ticket, pm_pid(self())),
                conn_loop(Sock, <<>>, queue:new(), false);
            {error, Reason} ->
                Msg = io_lib:format("connect to ~s:~b failed: ~p",
                                    [HostStr, Port, Reason]),
                reject(ReplyTo, Ticket, pm_string(iolist_to_binary(Msg)))
        end
    end),
    nil.

%% -- connection owner process --------------------------------------------------

%% One process per connection, socket in active mode. Incoming bytes are
%% buffered; pending reads are settled FIFO, each receiving the whole
%% buffer as one chunk. Writes settle true/false. On close (either side),
%% pending and future reads settle null.
conn_loop(Sock, Buffer, Pending, Closed) ->
    receive
        {tcp, Sock, Data} ->
            flush(Sock, <<Buffer/binary, Data/binary>>, Pending, Closed);
        {tcp_closed, Sock} ->
            drain_null(Pending),
            closing(Sock, Buffer);
        {tcp_error, Sock, _Reason} ->
            drain_null(Pending),
            closing(Sock, Buffer);
        {read, ReplyTo, Ticket} ->
            flush(Sock, Buffer, queue:in({ReplyTo, Ticket}, Pending), Closed);
        {write, ReplyTo, Ticket, Bytes} ->
            Ok = case Closed of
                true -> false;
                false -> gen_tcp:send(Sock, Bytes) =:= ok
            end,
            settle(ReplyTo, Ticket, pm_bool(Ok)),
            conn_loop(Sock, Buffer, Pending, Closed);
        {peer, ReplyTo, Ticket} ->
            settle(ReplyTo, Ticket, pm_string(format_peer(Sock))),
            conn_loop(Sock, Buffer, Pending, Closed);
        {close, _From} ->
            gen_tcp:close(Sock),
            drain_null(Pending)
    end.

%% Remote peer closed but buffered bytes may still be unread: serve
%% remaining reads from the buffer, then null, until the buffer is empty.
closing(_Sock, <<>>) ->
    ok;
closing(Sock, Buffer) ->
    receive
        {read, ReplyTo, Ticket} ->
            settle(ReplyTo, Ticket, pm_string(bytes_to_string(Buffer))),
            closing(Sock, <<>>);
        {write, ReplyTo, Ticket, _Bytes} ->
            settle(ReplyTo, Ticket, pm_bool(false)),
            closing(Sock, Buffer);
        {peer, ReplyTo, Ticket} ->
            settle(ReplyTo, Ticket, pm_string(format_peer(Sock))),
            closing(Sock, Buffer);
        {close, _From} ->
            ok
    end.

flush(Sock, <<>>, Pending, Closed) ->
    conn_loop(Sock, <<>>, Pending, Closed);
flush(Sock, Buffer, Pending, Closed) ->
    case queue:out(Pending) of
        {empty, _} ->
            conn_loop(Sock, Buffer, Pending, Closed);
        {{value, {ReplyTo, Ticket}}, Rest} ->
            settle(ReplyTo, Ticket, pm_string(bytes_to_string(Buffer))),
            conn_loop(Sock, <<>>, Rest, Closed)
    end.

drain_null(Pending) ->
    case queue:out(Pending) of
        {empty, _} -> ok;
        {{value, {ReplyTo, Ticket}}, Rest} ->
            settle(ReplyTo, Ticket, pm_null()),
            drain_null(Rest)
    end.

format_peer(Sock) ->
    case inet:peername(Sock) of
        {ok, {Addr, Port}} ->
            iolist_to_binary(io_lib:format("~s:~b", [inet:ntoa(Addr), Port]));
        {error, _} ->
            <<"unknown">>
    end.

%% -- request senders (called from the VM process) ------------------------------

%% Each async request goes through a relay process that monitors the socket
%% owner: if the owner is already dead (socket fully closed), the relay
%% settles the ticket itself so the VM's event loop never hangs on a
%% promise nobody will resolve.
accept(Listener, Ticket) ->
    relay(Listener, Ticket, fun(Relay) -> {accept, Relay, Ticket} end,
          fun() -> pm_null() end).

read(Conn, Ticket) ->
    relay(Conn, Ticket, fun(Relay) -> {read, Relay, Ticket} end,
          fun() -> pm_null() end).

write(Conn, Ticket, Data) ->
    case string_to_bytes(Data) of
        Bytes when is_binary(Bytes) ->
            relay(Conn, Ticket, fun(Relay) -> {write, Relay, Ticket, Bytes} end,
                  fun() -> pm_bool(false) end);
        _ ->
            %% Code points above 255 — not a byte string. Settle false.
            self() ! {settle_promise, Ticket, {ok, pm_bool(false)}},
            nil
    end.

relay(Target, Ticket, MakeMsg, OnDead) ->
    Vm = self(),
    spawn(fun() ->
        Mon = erlang:monitor(process, Target),
        Target ! MakeMsg(self()),
        receive
            {settle_promise, _, _} = Msg ->
                erlang:demonitor(Mon, [flush]),
                Vm ! Msg;
            {'DOWN', Mon, process, Target, _Reason} ->
                Vm ! {settle_promise, Ticket, {ok, OnDead()}}
        end
    end),
    nil.

close(SockPid) ->
    SockPid ! {close, self()},
    nil.

%% -- websocket handshake -------------------------------------------------------

%% RFC 6455 §4.2.2: base64(sha1(Sec-WebSocket-Key ++ magic GUID)).
ws_accept_key(Key) ->
    base64:encode(crypto:hash(sha, <<Key/binary, ?WS_MAGIC/binary>>)).

%% -- introspection --------------------------------------------------------------

%% Async: settles with "ip:port" of the remote peer.
peer_name(Conn, Ticket) ->
    relay(Conn, Ticket, fun(Relay) -> {peer, Relay, Ticket} end,
          fun() -> pm_string(<<"unknown">>) end).

%% Async: settles with the local port number of a listener (for port 0).
sock_name(Listener, Ticket) ->
    relay(Listener, Ticket, fun(Relay) -> {port, Relay, Ticket} end,
          fun() -> pm_null() end).
