-module(arc_fs_ffi).
-export([read_file/1, write_file/2, list_dir/1, exists/1]).

%% Filesystem embedder layer for `src/arc/fs.gleam`. Same byte bridge as
%% arc_net_ffi: file contents cross the boundary as latin1 byte strings
%% widened to UTF-8 Gleam strings (one JS char = one byte).

read_file(Path) ->
    case file:read_file(Path) of
        {ok, Bytes} ->
            {ok, unicode:characters_to_binary(Bytes, latin1, utf8)};
        {error, Reason} ->
            {error, atom_to_binary(Reason, utf8)}
    end.

write_file(Path, Data) ->
    case unicode:characters_to_binary(Data, utf8, latin1) of
        Bytes when is_binary(Bytes) ->
            case file:write_file(Path, Bytes) of
                ok -> {ok, nil};
                {error, Reason} -> {error, atom_to_binary(Reason, utf8)}
            end;
        _ ->
            {error, <<"data contains char codes above 255">>}
    end.

list_dir(Path) ->
    case file:list_dir(Path) of
        {ok, Names} ->
            {ok, [unicode:characters_to_binary(N) || N <- lists:sort(Names)]};
        {error, Reason} ->
            {error, atom_to_binary(Reason, utf8)}
    end.

exists(Path) ->
    filelib:is_file(Path).
