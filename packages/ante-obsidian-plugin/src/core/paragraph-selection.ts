export interface LineReader {
  getLine(line: number): string;
  lineCount(): number;
}

export interface ParagraphSelectionSnapshot {
  text: string;
  from: { line: number; ch: number };
  to: { line: number; ch: number };
}

export const buildParagraphSelection = (
  editor: LineReader,
  lineNumber: number,
  matchStart: number,
): ParagraphSelectionSnapshot | null => {
  let start = lineNumber;
  let end = lineNumber;

  while (start > 0 && editor.getLine(start - 1).trim()) {
    start -= 1;
  }
  while (end < editor.lineCount() - 1 && editor.getLine(end + 1).trim()) {
    end += 1;
  }

  const lines: string[] = [];
  for (let line = start; line <= end; line += 1) {
    const current = editor.getLine(line);
    if (line === lineNumber) {
      lines.push(current.slice(0, matchStart).trimEnd());
      continue;
    }
    lines.push(current);
  }

  const text = lines.join("\n");
  if (!text.trim()) {
    return null;
  }

  return {
    text,
    from: { line: start, ch: 0 },
    to: {
      line: lineNumber,
      ch: editor.getLine(lineNumber).slice(0, matchStart).trimEnd().length,
    },
  };
};
