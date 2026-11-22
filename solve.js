// csv-fast: a faster drop-in for make.fun's csv-reader 1.0.0.
//
// Same answers, less CPU. The reference builds every field one character at
// a time; this reader takes each field as a slice of the input instead, and
// closes quoted fields with indexOf rather than a per-character walk. The
// reading policy is csv-reader's own, from the competition rules:
//
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record (a line holding only stray CRs is no record either, though its
//     stray_cr errors stay);
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it one quote, each CRLF or lone CR inside it read
//     as LF; what follows its closing quote, up to the next comma or line
//     break, is appended as it stands (quote_junk, when the field ends); a
//     quote that never closes is a literal character and the text after it
//     is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (short_row, with fields: its count) or cut (long_row, with
//     extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record
//     starts on, row its record's index in rows (null for the header), in
//     the order met, a record's short_row or long_row when it ends.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Deterministic: the same input always gives the same answer.

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text. */
const AT_COMMA = 0;
const AT_BREAK = 1;
const AT_END = 2;

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const wantHeader = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let lineNo = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recLine = 1;
  let recRow = null;

  // How the last field ended, and how many characters the last bare scan kept.
  let endKind = AT_END;
  let kept = 0;

  function mark(code) {
    errors.push({ code, line: recLine, row: recRow });
  }

  // Reads a bare (unquoted) field from pos, starting from `seed` ('' for a
  // fresh field, '"' when re-reading after an unterminated quote). Stops at a
  // comma, a line break, or the end of the text; a CR not followed by LF is
  // dropped (stray_cr) and the field goes on past it. Sets endKind and kept.
  // The field is built from slices of the input, never one character at a
  // time: the scan only finds where the next delimiter is.
  function scanBare(seed) {
    let value = seed;
    kept = 0;
    let seg = pos;
    for (;;) {
      let p = pos;
      while (p < n) {
        const c = text.charCodeAt(p);
        if (c === 44 || c === 10 || c === 13) break;
        p += 1;
      }
      if (p >= n) {
        value += text.slice(seg);
        kept += n - seg;
        pos = n;
        endKind = AT_END;
        return value;
      }
      const c = text.charCodeAt(p);
      if (c === 44) {
        value += text.slice(seg, p);
        kept += p - seg;
        pos = p + 1;
        endKind = AT_COMMA;
        return value;
      }
      if (c === 10) {
        value += text.slice(seg, p);
        kept += p - seg;
        pos = p + 1;
        lineNo += 1;
        endKind = AT_BREAK;
        return value;
      }
      // A CR: CRLF ends the record, a lone CR is dropped and the field goes on.
      if (text.charCodeAt(p + 1) === 10) {
        value += text.slice(seg, p);
        kept += p - seg;
        pos = p + 2;
        lineNo += 1;
        endKind = AT_BREAK;
        return value;
      }
      mark('stray_cr');
      value += text.slice(seg, p);
      kept += p - seg;
      pos = p + 1;
      seg = pos;
    }
  }

  // The quoted segment [a, b): as one slice when it holds no CR or LF, else
  // with every CRLF or lone CR read as one LF, each counted as a line.
  function takeQuoted(a, b) {
    const lf = text.indexOf('\n', a);
    const cr = text.indexOf('\r', a);
    if ((lf === -1 || lf >= b) && (cr === -1 || cr >= b)) return text.slice(a, b);
    let out = '';
    let s = a;
    for (let i = a; i < b; i += 1) {
      const c = text.charCodeAt(i);
      if (c === 13) {
        out += text.slice(s, i) + '\n';
        lineNo += 1;
        if (text.charCodeAt(i + 1) === 10) i += 1;
        s = i + 1;
      } else if (c === 10) {
        out += text.slice(s, i) + '\n';
        lineNo += 1;
        s = i + 1;
      }
    }
    return out + text.slice(s, b);
  }

  // Reads a quoted field whose opening quote is at pos. Sets endKind.
  function scanQuoted() {
    const openPos = pos;
    const openLine = lineNo;
    let value = '';
    let seg = pos + 1;
    let from = pos + 1;
    for (;;) {
      const q = text.indexOf('"', from);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted, from the opening line.
        pos = openPos + 1;
        lineNo = openLine;
        mark('unterminated_quote');
        return scanBare('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one literal quote, and the field goes on.
        value += takeQuoted(seg, q) + '"';
        seg = q + 2;
        from = q + 2;
        continue;
      }
      value += takeQuoted(seg, q);
      pos = q + 1;
      break;
    }
    if (pos >= n) {
      endKind = AT_END;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      endKind = AT_COMMA;
      return value;
    }
    if (c === 10) {
      pos += 1;
      lineNo += 1;
      endKind = AT_BREAK;
      return value;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      lineNo += 1;
      endKind = AT_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break (quote_junk when anything was appended).
    const junk = scanBare(value);
    if (kept > 0) mark('quote_junk');
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        lineNo += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        lineNo += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recLine = lineNo;
    recRow = wantHeader && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    do {
      if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        fields.push(scanQuoted());
      } else {
        lastQuoted = false;
        fields.push(scanBare(''));
      }
    } while (endKind === AT_COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (wantHeader && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: wantHeader ? (columns ?? []) : null, rows, errors };
}
