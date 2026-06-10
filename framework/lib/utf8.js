// UTF-8 <-> byte-string codecs.
//
// Arc's socket bridge represents raw bytes as JS strings whose char codes
// are all 0-255 ("byte strings"). WebSocket text payloads are UTF-8 on the
// wire, so JS strings must be encoded to byte strings before framing and
// decoded after unframing.

export function utf8Encode(str )  {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const low = str.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      out += String.fromCharCode(code);
    } else if (code < 0x800) {
      out += String.fromCharCode(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out += String.fromCharCode(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      out += String.fromCharCode(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return out;
}

export function utf8Decode(bytes )  {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes.charCodeAt(i);
    let code = 0;
    if (b0 < 0x80) {
      code = b0;
      i += 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      code = ((b0 & 0x1f) << 6) | (bytes.charCodeAt(i + 1) & 0x3f);
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      code =
        ((b0 & 0x0f) << 12) |
        ((bytes.charCodeAt(i + 1) & 0x3f) << 6) |
        (bytes.charCodeAt(i + 2) & 0x3f);
      i += 3;
    } else {
      code =
        ((b0 & 0x07) << 18) |
        ((bytes.charCodeAt(i + 1) & 0x3f) << 12) |
        ((bytes.charCodeAt(i + 2) & 0x3f) << 6) |
        (bytes.charCodeAt(i + 3) & 0x3f);
      i += 4;
    }
    if (code < 0x10000) {
      out += String.fromCharCode(code);
    } else {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    }
  }
  return out;
}
