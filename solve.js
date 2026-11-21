// csv-reader-fast: a faster drop-in for csv-reader 1.0.0 (make.fun's reference CSV reader).
//
// run(input) returns, for {text, header}, exactly the answer csv-reader 1.0.0 returns:
// {columns, rows, errors}. The reading policy, in brief: a U+FEFF at the very start is
// dropped; a record ends at LF or CRLF and a line left with no characters is no record;
// outside quotes a CR not followed by LF is dropped (stray_cr); a field that opens with a
// quote runs to the next quote that is not doubled ("" inside it is one quote, each CRLF
// or lone CR inside it reads as LF); what follows its closing quote, up to the next comma
// or line break, is appended as it stands (quote_junk, when the field ends); a quote that
// never closes is a literal character and the text after it is read again as unquoted
// (unterminated_quote); a quote inside an unquoted field is a literal character. columns
// is the first record when header is true, else null; rows holds the records after it,
// each padded with "" (short_row, with fields: its count) or cut (long_row, with extra:
// the cut fields) to the first record's width. Each error is {code, line, row}, in the
// order met. Peak memory is not scored; CPU time is.
//
// Speed comes from never building a field one character at a time: fields are taken as
// slices of the input wherever the policy allows it, and the input is scanned once, left
// to right, with a tight char-code loop that only stops at a delimiter. A field is only
// rebuilt character by character when it actually holds a stray CR (unquoted) or a CR
// inside quotes, both rare in drawn files.

/** How a field ended: 0 at a comma (the record goes on), 1 at a line break, 2 at the end. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: header).
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not
  // followed by LF is dropped (stray_cr). Returns [value, ended, added]; `added` counts
  // the characters kept during this read. Only the quote-junk path uses this helper; the
  // plain-field path below inlines the same scan so it pays no call or array per field.
  function readUnquoted(value) {
    let added = 0;
    let start = pos;
    let i = pos;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44) { // ,
        value += text.slice(start, i);
        added += i - start;
        pos = i + 1;
        return [value, COMMA, added];
      }
      if (c === 10) { // LF
        value += text.slice(start, i);
        added += i - start;
        pos = i + 1;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      if (c === 13) { // CR
        if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
          value += text.slice(start, i);
          added += i - start;
          pos = i + 2;
          line += 1;
          return [value, LINE_BREAK, added];
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        value += text.slice(start, i);
        added += i - start;
        i += 1;
        start = i;
        continue;
      }
      i += 1;
    }
    value += text.slice(start, n);
    added += n - start;
    pos = n;
    return [value, END, added];
  }

  // A quoted segment [start, end) with each CRLF or lone CR in it read as one LF.
  // Only called when the segment is known to hold a CR.
  function convertSegment(start, end) {
    let out = '';
    let s = start;
    let i = start;
    while (i < end) {
      if (text.charCodeAt(i) === 13) {
        out += text.slice(s, i) + '\n';
        i += (i + 1 < end && text.charCodeAt(i + 1) === 10) ? 2 : 1;
        s = i;
      } else {
        i += 1;
      }
    }
    return out + text.slice(s, end);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended = END;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (!quoted) {
        // Unquoted field, inlined: scan to the next comma or line break and take
        // the field as one slice; only a stray CR rebuilds it from segments.
        let v = '';
        let start = pos;
        let i = pos;
        let fieldValue = '';
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === 44) { // ,
            fieldValue = v + text.slice(start, i);
            pos = i + 1;
            ended = COMMA;
            break;
          }
          if (c === 10) { // LF
            fieldValue = v + text.slice(start, i);
            pos = i + 1;
            line += 1;
            ended = LINE_BREAK;
            break;
          }
          if (c === 13) { // CR
            if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
              fieldValue = v + text.slice(start, i);
              pos = i + 2;
              line += 1;
              ended = LINE_BREAK;
              break;
            }
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            v += text.slice(start, i);
            i += 1;
            start = i;
            continue;
          }
          i += 1;
        }
        if (i >= n) {
          fieldValue = v + text.slice(start, n);
          pos = n;
          ended = END;
        }
        fields.push(fieldValue);
        continue;
      }
      // A quoted field: scan its content for the next quote, counting the line
      // breaks inside it (CRLF and lone CR each one line) and noting a CR, which
      // is the only thing that keeps the content from being one plain slice.
      const open = pos;
      const openLine = line;
      let value = '';
      let seg = pos + 1;
      let closedAt = -1;
      let fieldValue = '';
      while (true) {
        const j = text.indexOf('"', seg);
        if (j === -1) {
          // The quote never closes: it is a literal character, and the text after
          // it is read again as unquoted.
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          pos = open + 1;
          const r = readUnquoted('"');
          fieldValue = r[0];
          ended = r[1];
          break;
        }
        const segStr = text.slice(seg, j);
        if (segStr.indexOf('\n') === -1 && segStr.indexOf('\r') === -1) {
          value += segStr;
        } else {
          // The segment holds line breaks: count them (CRLF and lone CR each
          // one line) and read each CRLF or lone CR as one LF.
          let segLines = 0;
          let k = seg;
          let out = '';
          let s = seg;
          while (k < j) {
            const c = text.charCodeAt(k);
            if (c === 10) { segLines += 1; k += 1; }
            else if (c === 13) {
              segLines += 1;
              out += text.slice(s, k) + '\n';
              k += (k + 1 < j && text.charCodeAt(k + 1) === 10) ? 2 : 1;
              s = k;
            } else k += 1;
          }
          value += out + text.slice(s, j);
          line += segLines;
        }
        if (j + 1 < n && text.charCodeAt(j + 1) === 34) {
          // A doubled quote is one quote, and the field goes on.
          value += '"';
          seg = j + 2;
          continue;
        }
        closedAt = j;
        break;
      }
      if (closedAt >= 0) {
        pos = closedAt + 1;
        if (pos >= n) {
          fieldValue = value;
          ended = END;
        } else {
          const c = text.charCodeAt(pos);
          if (c === 44) {
            pos += 1;
            fieldValue = value;
            ended = COMMA;
          } else if (c === 10) {
            pos += 1;
            line += 1;
            fieldValue = value;
            ended = LINE_BREAK;
          } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
            pos += 2;
            line += 1;
            fieldValue = value;
            ended = LINE_BREAK;
          } else {
            // What follows the closing quote is appended as it stands, up to the
            // next comma or line break.
            const r = readUnquoted(value);
            if (r[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            fieldValue = r[0];
            ended = r[1];
          }
        }
      }
      fields.push(fieldValue);
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
