// Type stripper for Volt's TypeScript sources. Plain JavaScript so it runs
// directly on the arc runtime (which executes JS, not TS).
//
// This is a lexer-driven stripper for the *erasable* subset of TypeScript,
// in the spirit of ts-blank-space and Node's --experimental-strip-types:
// every removed construct is replaced by nothing, never rewritten, so the
// emitted JavaScript is the source minus types.
//
// Supported (the subset Volt's sources are written in):
//   - `interface X { ... }` and `export interface ...` declarations
//   - `type X = ...` and `export type ...` aliases
//   - `import type ... from "..."` / `export type { ... }`
//   - parameter, variable, class field and return type annotations `: T`
//   - optional markers `a?: T` and definite assignment `a!: T`
//   - non-null assertions `expr!`
//   - `as T` casts
//   - declaration-site generics `function f<T>(...)`, `class C<T>`,
//     method generics `m<T>(...)`
//   - `implements ...` clauses
//   - `declare ...` statements
//
// Not supported (do not use in framework sources): enums, namespaces,
// parameter properties, call-site generics `f<T>()`, `satisfies`,
// inline `import { type X }` specifiers, decorators.

const PUNCT = [
  ">>>=", "===", "!==", "**=", "<<=", ">>=", ">>>", "...", "=>", "==", "!=",
  "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=",
  "%=", "&=", "|=", "^=", "**", "<<", ">>", "&&=", "||=", "??=",
];

const KEYWORDS_BEFORE_REGEX = [
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await",
];

function isIdStart(ch) {
  return /[A-Za-z_$]/.test(ch);
}

function isIdChar(ch) {
  return /[A-Za-z0-9_$]/.test(ch);
}

// Tokenize source into { kind, text, start, end } where kind is one of
// "id", "num", "str", "template", "regex", "punct", "comment", "ws".
function tokenize(src) {
  const tokens = [];
  let i = 0;
  let prevSig = null; // previous significant token (not ws/comment)

  function push(kind, start, end) {
    const tok = { kind, text: src.slice(start, end), start, end };
    tokens.push(tok);
    if (kind !== "ws" && kind !== "comment") prevSig = tok;
    return tok;
  }

  function regexAllowed() {
    if (!prevSig) return true;
    if (prevSig.kind === "punct") {
      return ![")", "]", "}"].includes(prevSig.text) || prevSig.text === "}";
    }
    if (prevSig.kind === "id") return KEYWORDS_BEFORE_REGEX.includes(prevSig.text);
    return false;
  }

  while (i < src.length) {
    const ch = src[i];
    const start = i;

    if (/\s/.test(ch)) {
      while (i < src.length && /\s/.test(src[i])) i++;
      push("ws", start, i);
      continue;
    }

    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      push("comment", start, i);
      continue;
    }

    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i = Math.min(i + 2, src.length);
      push("comment", start, i);
      continue;
    }

    if (ch === '"' || ch === "'") {
      i++;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      push("str", start, i);
      continue;
    }

    if (ch === "`") {
      // Template literal; ${ } expressions are tokenized as part of the
      // template (annotations never appear inside templates in our sources).
      i++;
      let depth = 0;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          depth++;
          i += 2;
          continue;
        }
        if (src[i] === "}" && depth > 0) {
          depth--;
          i++;
          continue;
        }
        if (src[i] === "`" && depth === 0) {
          i++;
          break;
        }
        i++;
      }
      push("template", start, i);
      continue;
    }

    if (ch === "/" && regexAllowed()) {
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) break;
        else if (src[i] === "\n") break;
        i++;
      }
      i++;
      while (i < src.length && isIdChar(src[i])) i++; // flags
      push("regex", start, i);
      continue;
    }

    if (isIdStart(ch)) {
      while (i < src.length && isIdChar(src[i])) i++;
      push("id", start, i);
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1]))) {
      while (i < src.length && /[0-9a-fA-FxXoObBeE_.+-]/.test(src[i])) {
        // stop +- unless after exponent marker
        if ((src[i] === "+" || src[i] === "-") && !/[eE]/.test(src[i - 1])) break;
        i++;
      }
      push("num", start, i);
      continue;
    }

    let matched = null;
    for (const p of PUNCT) {
      if (src.startsWith(p, i)) {
        matched = p;
        break;
      }
    }
    if (matched) {
      i += matched.length;
    } else {
      i++;
    }
    push("punct", start, i);
  }

  return tokens;
}

// Strip TypeScript types from source, returning plain JavaScript.
export function strip(src) {
  const tokens = tokenize(src).filter((t) => t.kind !== "ws" && t.kind !== "comment");
  const drop = new Set(); // indices into `tokens` to omit
  const dropRange = (a, b) => {
    for (let k = a; k <= b; k++) drop.add(k);
  };

  const sig = tokens;
  const text = (k) => (sig[k] ? sig[k].text : "");
  const kind = (k) => (sig[k] ? sig[k].kind : "");

  // Skip a balanced type expression starting at index k, stopping at any of
  // `stops` (punct text) at angle/paren/brace/bracket depth 0. Returns the
  // index of the stop token (not consumed).
  function skipType(k, stops) {
    let depth = 0;
    // A `{` in type-expecting position (start, or after | & => < ( , : ;)
    // opens an object type literal; after a complete type it's the stop
    // (e.g. a function body following a return annotation).
    let expecting = true;
    while (k < sig.length) {
      const t = text(k);
      if (depth === 0 && t === "{" && !expecting && stops.includes("{")) return k;
      if (depth === 0 && t !== "{" && stops.includes(t)) return k;
      if (t === "<" || t === "(" || t === "[" || t === "{") {
        depth++;
        expecting = true;
      } else if (t === ">" || t === ")" || t === "]" || t === "}") {
        if (depth === 0) return k;
        depth--;
        expecting = false;
      } else if (t === ">>" || t === ">>>") {
        // closing nested generics
        depth -= t.length;
        if (depth < 0) return k;
        expecting = false;
      } else if (["|", "&", "=>", ",", ":", ";", "extends", "keyof", "typeof", "readonly", "?"].includes(t)) {
        expecting = true;
      } else {
        expecting = false;
      }
      k++;
    }
    return k;
  }

  // Skip balanced brackets starting at an opener token; returns index of
  // the matching closer.
  function skipBalanced(k) {
    const open = text(k);
    const close = { "{": "}", "(": ")", "<": ">", "[": "]" }[open];
    let depth = 0;
    for (; k < sig.length; k++) {
      const t = text(k);
      if (t === open) depth++;
      else if (t === close) {
        depth--;
        if (depth === 0) return k;
      } else if (close === ">" && (t === ">>" || t === ">>>")) {
        depth -= t.length;
        if (depth <= 0) return k;
      }
    }
    return k;
  }

  // Context stack for brackets: "object" | "block" | "paren" | "bracket"
  // | "class" | "ternary" markers are tracked separately.
  const ctx = [];
  const top = () => ctx[ctx.length - 1] || "block";
  let ternary = []; // pending ? count per context depth
  const tdepth = () => ternary[ternary.length - 1] || 0;

  let classHead = false; // between `class` keyword and its body `{`
  let pendingCase = false; // inside a `case ...:` clause head

  for (let k = 0; k < sig.length; k++) {
    if (drop.has(k)) continue;
    const t = text(k);
    const kd = kind(k);

    // ---- whole-statement TS constructs ----
    if (kd === "id" && (t === "interface" || t === "type" || t === "declare")) {
      const isDecl =
        t === "interface"
          ? kind(k + 1) === "id"
          : t === "type"
            ? (kind(k + 1) === "id" &&
                (text(k + 2) === "=" || text(k + 2) === "<")) ||
              (text(k - 1) === "export" && text(k + 1) === "{")
            : true;
      const prevT = k > 0 ? text(k - 1) : "";
      const stmtStart =
        k === 0 || [";", "}", "{"].includes(prevT) || prevT === "export";
      if (isDecl && stmtStart) {
        let end = k;
        if (t === "interface") {
          while (end < sig.length && text(end) !== "{") end++;
          end = skipBalanced(end);
        } else {
          // type alias / declare: skip to `;` honoring nesting
          end = skipType(k + 1, [";"]);
          if (text(end) !== ";") end--;
        }
        let from = k;
        if (prevT === "export") from = k - 1;
        dropRange(from, end);
        continue;
      }
    }

    if (kd === "id" && t === "import" && text(k + 1) === "type") {
      let end = k;
      while (end < sig.length && text(end) !== ";") end++;
      dropRange(k, end);
      continue;
    }

    if (kd === "id" && t === "implements" && classHead) {
      let end = k;
      while (end < sig.length && text(end) !== "{") end++;
      dropRange(k, end - 1);
      continue;
    }

    // ---- as-casts ----
    if (kd === "id" && t === "as" && k > 0) {
      const p = sig[k - 1];
      const exprBefore =
        p.kind === "id" || p.kind === "num" || p.kind === "str" ||
        p.kind === "template" || [")", "]", "}"].includes(p.text);
      if (exprBefore) {
        const end = skipType(k + 1, [",", ";", ")", "]", "}", "=", "=>", ":", "?"]);
        dropRange(k, end - 1);
        continue;
      }
    }

    // ---- class heads & generics ----
    if (kd === "id" && t === "class") {
      classHead = true;
    }

    if (t === "<" && kd === "punct" && k > 0 && kind(k - 1) === "id") {
      const prev2 = text(k - 2);
      const isDeclGenerics =
        prev2 === "function" ||
        prev2 === "class" ||
        // method head inside class/object: `name<T>(`
        ((top() === "class" || top() === "object") &&
          [";", ",", "{", "}"].includes(text(k - 2)));
      if (isDeclGenerics) {
        const end = skipBalanced(k);
        dropRange(k, end);
        continue;
      }
    }

    // ---- bracket context tracking ----
    if (t === "{") {
      let kindCtx = "block";
      if (classHead) {
        kindCtx = "class";
        classHead = false;
      } else {
        const p = k > 0 ? sig[k - 1] : null;
        const objBefore =
          p &&
          ((p.kind === "punct" &&
            ["(", ",", "=", "[", ":", "?", "!", "&&", "||", "??",
              "+", "-", "*", "/"].includes(p.text)) ||
            (p.kind === "id" && ["return", "in", "of", "typeof"].includes(p.text)));
        if (objBefore) kindCtx = "object";
      }
      ctx.push(kindCtx);
      ternary.push(0);
      continue;
    }
    if (t === "(" || t === "[") {
      ctx.push(t === "(" ? "paren" : "bracket");
      ternary.push(0);
      continue;
    }
    if (t === "}" || t === ")" || t === "]") {
      ctx.pop();
      ternary.pop();
      continue;
    }

    if (t === "?" && ![":", ")", ","].includes(text(k + 1))) {
      ternary[ternary.length - 1] = tdepth() + 1;
    }

    if (kd === "id" && t === "case") pendingCase = true;

    // ---- optional / definite-assignment markers ----
    if (t === "?" && text(k + 1) === ":") {
      // optional marker `a?: T` (annotation handled next loop iteration)
      drop.add(k);
      continue;
    }
    if (t === "?" && (text(k + 1) === ")" || text(k + 1) === ",") &&
        (top() === "paren" || top() === "class")) {
      drop.add(k); // optional param without annotation `a?)`
      continue;
    }
    if (t === "!" && k > 0) {
      const p = sig[k - 1];
      const postfix =
        (p.kind === "id" && !KEYWORDS_BEFORE_REGEX.includes(p.text)) ||
        p.kind === "num" || p.kind === "str" || [")", "]"].includes(p.text);
      const nx = text(k + 1);
      if (postfix && nx !== "=" && nx !== "==" && nx !== "===") {
        drop.add(k); // non-null assertion
        continue;
      }
    }

    // ---- type annotations ----
    if (t === ":") {
      if (pendingCase) {
        pendingCase = false;
        continue;
      }
      if (tdepth() > 0) {
        ternary[ternary.length - 1] = tdepth() - 1;
        continue; // ternary's colon
      }
      const c = top();
      if (c === "object") continue; // property colon
      const p = k > 0 ? sig[k - 1] : null;
      if (!p) continue;
      const afterParams = p.text === ")";
      const afterName = p.kind === "id" || p.text === "]" || p.text === "?";
      if (!afterParams && !afterName) continue;
      // In blocks, only annotate declarations (`let x:`/`const x:`) and
      // return types (`):`); a bare `ident :` in a block is a label.
      if (c === "block" && !afterParams) {
        const declKw = text(k - 2);
        if (!["let", "const", "var"].includes(declKw)) continue;
      }
      // For return annotations (`):`) a depth-0 `=>` is the arrow body
      // marker, so stop there; for name annotations a depth-0 `=>` is part
      // of a function type and must be skipped.
      const stops = afterParams
        ? [",", ";", ")", "]", "}", "=", "=>", "{"]
        : [",", ";", ")", "]", "}", "=", "{"];
      const end = skipType(k + 1, stops);
      dropRange(k, end - 1);
      continue;
    }
  }

  // Re-emit: walk original token list (with ws/comments) and skip dropped
  // significant tokens. Map significant index back via identity.
  const keepStarts = new Set();
  sig.forEach((tok, idx) => {
    if (!drop.has(idx)) keepStarts.add(tok.start);
  });
  const all = tokenize(src);
  let out = "";
  for (const tok of all) {
    if (tok.kind === "ws" || tok.kind === "comment") {
      out += tok.text;
    } else if (keepStarts.has(tok.start)) {
      out += tok.text;
    }
  }
  return out;
}
