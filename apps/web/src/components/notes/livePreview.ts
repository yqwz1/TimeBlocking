import { syntaxTree } from '@codemirror/language';
import { StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { NoteQueryResultDTO } from '@timeblock/shared';

const queryCache = new Map<string, Promise<NoteQueryResultDTO>>();

function fetchQueryResult(query: string): Promise<NoteQueryResultDTO> {
  const existing = queryCache.get(query);
  if (existing) return existing;
  const request = fetch('/api/notes/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  }).then(async (response) => {
    if (!response.ok) {
      const body = await response.json().catch(() => ({}) as { error?: string });
      throw new Error(body.error || 'Could not evaluate this query block.');
    }
    return response.json() as Promise<NoteQueryResultDTO>;
  });
  queryCache.set(query, request);
  return request;
}

class ListMarkerWidget extends WidgetType {
  constructor(private readonly marker: string) {
    super();
  }

  eq(other: ListMarkerWidget) {
    return other.marker === this.marker;
  }

  toDOM() {
    const marker = document.createElement('span');
    marker.className = 'sb-live-list-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = /^\d/.test(this.marker) ? this.marker : '\u2022';
    return marker;
  }
}

/** Renders portable Markdown horizontal rules as an actual divider in live preview. */
class HorizontalRuleWidget extends WidgetType {
  toDOM() {
    const rule = document.createElement('hr');
    rule.className = 'sb-live-horizontal-rule';
    rule.setAttribute('aria-hidden', 'true');
    return rule;
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly sourceFrom: number,
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget) {
    return other.checked === this.checked && other.sourceFrom === this.sourceFrom;
  }

  toDOM(view: EditorView) {
    const checkbox = document.createElement('input');
    checkbox.className = 'sb-live-task-checkbox';
    checkbox.type = 'checkbox';
    checkbox.checked = this.checked;
    checkbox.setAttribute('aria-label', this.checked ? 'Mark task incomplete' : 'Mark task complete');
    checkbox.addEventListener('mousedown', (event) => event.preventDefault());
    checkbox.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        changes: {
          from: this.sourceFrom + 1,
          to: this.sourceFrom + 2,
          insert: this.checked ? ' ' : 'x',
        },
      });
      view.focus();
    });
    return checkbox;
  }

  ignoreEvent() {
    return false;
  }
}

interface MarkdownTable {
  from: number;
  to: number;
  headers: string[];
  rows: string[][];
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

class MarkdownTableWidget extends WidgetType {
  constructor(private readonly table: MarkdownTable) {
    super();
  }

  eq(other: MarkdownTableWidget) {
    return JSON.stringify(other.table) === JSON.stringify(this.table);
  }

  toDOM(view: EditorView) {
    const host = document.createElement('div');
    host.className = 'sb-live-markdown-table-wrap';
    host.tabIndex = 0;
    host.setAttribute('role', 'button');
    host.setAttribute('aria-label', 'Markdown table. Click or press Enter to edit.');
    host.title = 'Click to edit table';

    const table = document.createElement('table');
    table.className = 'sb-live-markdown-table';
    const head = table.createTHead().insertRow();
    for (const value of this.table.headers) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = value;
      head.append(cell);
    }
    const body = table.createTBody();
    for (const row of this.table.rows) {
      const tr = body.insertRow();
      for (let index = 0; index < this.table.headers.length; index += 1) {
        const cell = tr.insertCell();
        cell.textContent = row[index] ?? '';
      }
    }
    host.append(table);

    const edit = () => {
      view.dispatch({ selection: { anchor: this.table.from }, scrollIntoView: true });
      view.focus();
    };
    host.addEventListener('click', edit);
    host.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        edit();
      }
    });
    return host;
  }

  ignoreEvent() {
    return false;
  }
}

class QueryBlockWidget extends WidgetType {
  constructor(private readonly query: string) {
    super();
  }

  eq(other: QueryBlockWidget) {
    return other.query === this.query;
  }

  toDOM() {
    const host = document.createElement('div');
    host.className = 'sb-live-query-block';
    const title = document.createElement('div');
    title.className = 'sb-live-query-title';
    title.textContent = `query ${this.query}`;
    const body = document.createElement('div');
    body.className = 'sb-live-query-body';
    body.textContent = 'Loading live results…';
    host.append(title, body);
    void fetchQueryResult(this.query)
      .then((result) => {
        body.replaceChildren();
        if (result.rows.length === 0) {
          body.textContent = 'No matches.';
          return;
        }
        if (result.resultKind === 'notes') {
          const list = document.createElement('div');
          list.className = 'sb-live-query-list';
          for (const row of result.rows) {
            if (row.kind !== 'note') continue;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'sb-live-query-item';
            button.dataset.queryNoteId = row.id;
            const left = document.createElement('strong');
            left.textContent = row.title;
            const right = document.createElement('span');
            right.textContent = row.folder || 'Vault root';
            button.append(left, right);
            list.append(button);
          }
          body.append(list);
          return;
        }
        const table = document.createElement('div');
        table.className = 'sb-live-query-table';
        for (const row of result.rows) {
          if (row.kind !== 'task') continue;
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'sb-live-query-task';
          item.dataset.queryNoteId = row.noteId;
          const label = document.createElement('span');
          label.textContent = `${row.completed ? '☑' : '☐'} ${row.text}`;
          const meta = document.createElement('small');
          meta.textContent = `${row.noteTitle}${row.due ? ` · ${row.due}` : ''}`;
          item.append(label, meta);
          table.append(item);
        }
        body.append(table);
      })
      .catch((error) => {
        body.textContent = error instanceof Error ? error.message : 'Could not evaluate this query block.';
      });
    return host;
  }
}

function buildDecorations(state: EditorView['state']): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const activeLines = new Set(state.selection.ranges.map((range) => state.doc.lineAt(range.head).number));
  const decoratedLines = new Set<string>();
  const codeLines = new Set<number>();

  const lineIsActive = (position: number) => activeLines.has(state.doc.lineAt(position).number);
  const addLineClass = (position: number, className: string) => {
    const line = state.doc.lineAt(position);
    const key = `${line.from}:${className}`;
    if (decoratedLines.has(key)) return;
    decoratedLines.add(key);
    decorations.push(Decoration.line({ class: className }).range(line.from));
  };
  const addClass = (from: number, to: number, className: string, attributes?: Record<string, string>) => {
    if (to > from) decorations.push(Decoration.mark({ class: className, attributes }).range(from, to));
  };
  const conceal = (from: number, to: number) => {
    if (to > from && !lineIsActive(from)) decorations.push(Decoration.replace({}).range(from, to));
  };

  syntaxTree(state).iterate({
    enter(node) {
      const heading = /^ATXHeading([1-6])$/.exec(node.name);
      if (heading) {
        const level = Number(heading[1]);
        const line = state.doc.lineAt(node.from);
        const match = /^(#{1,6})(\s+)/.exec(line.text);
        addLineClass(node.from, `sb-live-heading sb-live-heading-${level}`);
        if (match) {
          const contentFrom = line.from + match[0].length;
          addClass(contentFrom, node.to, 'sb-live-heading-text');
          conceal(line.from, contentFrom);
        }
        return;
      }

      if (node.name === 'StrongEmphasis' || node.name === 'Emphasis') {
        const markerSize = node.name === 'StrongEmphasis' ? 2 : 1;
        addClass(node.from + markerSize, node.to - markerSize, node.name === 'StrongEmphasis' ? 'sb-live-strong' : 'sb-live-emphasis');
        conceal(node.from, node.from + markerSize);
        conceal(node.to - markerSize, node.to);
        return;
      }

      if (node.name === 'InlineCode') {
        addClass(node.from + 1, node.to - 1, 'sb-live-inline-code');
        conceal(node.from, node.from + 1);
        conceal(node.to - 1, node.to);
        return;
      }

      if (node.name === 'Link') {
        const before = node.from > 0 ? state.sliceDoc(node.from - 1, node.from + 1) : '';
        const after = node.to < state.doc.length ? state.sliceDoc(node.to - 1, node.to + 1) : '';
        const isWikilink = before === '[[' && after === ']]';
        if (isWikilink) {
          const target = state.sliceDoc(node.from + 1, node.to - 1);
          addClass(node.from + 1, node.to - 1, 'sb-live-wikilink', {
            'data-wikilink-target': target,
            title: `${target} - Ctrl/Cmd click to open`,
          });
          conceal(node.from - 1, node.from + 1);
          conceal(node.to - 1, node.to + 1);
          return;
        }

        const source = state.sliceDoc(node.from, node.to);
        const external = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(source);
        if (external) {
          const labelFrom = node.from + 1;
          const labelTo = labelFrom + external[1].length;
          addClass(labelFrom, labelTo, 'sb-live-link', {
            'data-link-href': external[2],
            title: `${external[2]} - Ctrl/Cmd click to open`,
          });
          conceal(node.from, labelFrom);
          conceal(labelTo, node.to);
        }
        return;
      }

      if (node.name === 'ListItem') {
        addLineClass(node.from, 'sb-live-list-line');
        return;
      }

      if (node.name === 'ListMark') {
        if (!lineIsActive(node.from)) {
          const marker = state.sliceDoc(node.from, node.to);
          decorations.push(Decoration.replace({ widget: new ListMarkerWidget(marker) }).range(node.from, node.to));
        }
        return;
      }

      if (node.name === 'Blockquote') {
        let line = state.doc.lineAt(node.from);
        while (line.from <= node.to) {
          addLineClass(line.from, 'sb-live-blockquote');
          if (line.to >= node.to || line.number === state.doc.lines) break;
          line = state.doc.line(line.number + 1);
        }
        return;
      }

      if (node.name === 'QuoteMark') {
        conceal(node.from, Math.min(node.to + 1, state.doc.lineAt(node.from).to));
        return;
      }

      if (node.name === 'FencedCode') {
        let line = state.doc.lineAt(node.from);
        while (line.from <= node.to) {
          codeLines.add(line.number);
          const isStart = line.from === state.doc.lineAt(node.from).from;
          const isEnd = line.number === state.doc.lineAt(node.to).number;
          addLineClass(line.from, `sb-live-code-line${isStart ? ' sb-live-code-start' : ''}${isEnd ? ' sb-live-code-end' : ''}`);
          if (line.to >= node.to || line.number === state.doc.lines) break;
          line = state.doc.line(line.number + 1);
        }
        return;
      }

      if (node.name === 'CodeMark') {
        const line = state.doc.lineAt(node.from);
        if (line.text.trimStart().startsWith('```')) {
          addLineClass(node.from, 'sb-live-code-fence');
          conceal(line.from, line.to);
        }
      }
    },
  });

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (!line.text.trimStart().startsWith('```query')) continue;
    const startLine = lineNumber;
    const queryLines: string[] = [];
    let endLine = line;
    lineNumber += 1;
    while (lineNumber <= state.doc.lines) {
      const nextLine = state.doc.line(lineNumber);
      endLine = nextLine;
      if (nextLine.text.trim() === '```') break;
      queryLines.push(nextLine.text);
      lineNumber += 1;
    }
    const isActive = Array.from(activeLines).some((active) => active >= startLine && active <= endLine.number);
    if (isActive) continue;
    decorations.push(
      Decoration.replace({
        block: true,
        widget: new QueryBlockWidget(queryLines.join(' ').trim()),
      }).range(line.from, endLine.to),
    );
  }

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const task = /^(\s*[-+*]\s+)\[([ xX])\](?=\s)/.exec(line.text);
    if (task) {
      addLineClass(line.from, task[2].toLowerCase() === 'x' ? 'sb-live-task-line sb-live-task-done' : 'sb-live-task-line');
      if (!activeLines.has(lineNumber)) {
        const sourceFrom = line.from + task[1].length;
        decorations.push(
          Decoration.replace({
            widget: new TaskCheckboxWidget(task[2].toLowerCase() === 'x', sourceFrom),
          }).range(sourceFrom, sourceFrom + 3),
        );
      }
    }

    if (!codeLines.has(lineNumber) && !/^\s*#(?:\s|$)/.test(line.text)) {
      const tagPattern = /(^|\s)(#[\p{L}\p{N}_/-]+)/gu;
      for (const match of line.text.matchAll(tagPattern)) {
        const from = line.from + (match.index ?? 0) + match[1].length;
        addClass(from, from + match[2].length, 'sb-live-tag');
      }
    }
  }

  // Keep `---` portable in the Markdown source, while making it read as a real
  // divider until the user moves the cursor to that line to edit it.
  let frontmatterEndLine = 0;
  if (state.doc.line(1).text.trim() === '---') {
    for (let lineNumber = 2; lineNumber <= state.doc.lines; lineNumber += 1) {
      const text = state.doc.line(lineNumber).text.trim();
      if (text === '---' || text === '...') {
        frontmatterEndLine = lineNumber;
        break;
      }
    }
  }
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const previousLine = lineNumber > 1 ? state.doc.line(lineNumber - 1) : null;
    const isMarkdownRule = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line.text);
    const isFrontmatterFence = (lineNumber === 1 && state.doc.line(1).text.trim() === '---') || lineNumber === frontmatterEndLine;
    const isSetextUnderline = line.text.trim().startsWith('-') && Boolean(previousLine?.text.trim());
    if (isMarkdownRule && !isFrontmatterFence && !isSetextUnderline && !codeLines.has(lineNumber) && !activeLines.has(lineNumber)) {
      decorations.push(
        Decoration.replace({ block: true, widget: new HorizontalRuleWidget() }).range(line.from, line.to),
      );
    }
  }

  // Pipe tables are portable Markdown, but the editor should still read like a table.
  // Clicking the rendered grid moves the cursor into the source so it remains simple to edit.
  for (let lineNumber = 1; lineNumber < state.doc.lines; lineNumber += 1) {
    const headerLine = state.doc.line(lineNumber);
    const dividerLine = state.doc.line(lineNumber + 1);
    if (codeLines.has(lineNumber) || codeLines.has(lineNumber + 1) || !headerLine.text.includes('|') || !isTableDivider(dividerLine.text)) continue;

    const headers = tableCells(headerLine.text);
    if (headers.length === 0) continue;
    const rows: string[][] = [];
    let lastLine = dividerLine;
    let nextLineNumber = lineNumber + 2;
    while (nextLineNumber <= state.doc.lines) {
      const rowLine = state.doc.line(nextLineNumber);
      if (codeLines.has(nextLineNumber) || rowLine.text.trim() === '' || !rowLine.text.includes('|')) break;
      rows.push(tableCells(rowLine.text));
      lastLine = rowLine;
      nextLineNumber += 1;
    }

    const tableEndLine = lastLine.number;
    const tableIsActive = Array.from(activeLines).some((active) => active >= lineNumber && active <= tableEndLine);
    if (!tableIsActive) {
      decorations.push(
        Decoration.replace({
          block: true,
          widget: new MarkdownTableWidget({ from: headerLine.from, to: lastLine.to, headers, rows }),
        }).range(headerLine.from, lastLine.to),
      );
    }
    lineNumber = tableEndLine;
  }

  return Decoration.set(decorations, true);
}

export function livePreviewExtension({
  onOpenWikilink,
  onOpenQueryNote,
}: {
  onOpenWikilink: (target: string) => void;
  onOpenQueryNote: (id: string) => void;
}): Extension {
  // Block widgets (the rendered query and table views) cannot be supplied by a
  // ViewPlugin. CodeMirror rejects them while it computes layout, which used to
  // throw a RangeError and unmount the entire Second Brain page. A state field is
  // the supported decoration source for widgets that can change line height.
  const previewDecorations = StateField.define<DecorationSet>({
    create: buildDecorations,
    update(decorations, transaction) {
      return transaction.docChanged || transaction.selection ? buildDecorations(transaction.state) : decorations;
    },
  });

  return [
    previewDecorations,
    EditorView.decorations.from(previewDecorations),
    EditorView.domEventHandlers({
      click(event) {
        if (!event.ctrlKey && !event.metaKey) return false;
        const element = event.target instanceof Element ? event.target : null;
        const wikilink = element?.closest<HTMLElement>('[data-wikilink-target]');
        if (wikilink?.dataset.wikilinkTarget) {
          event.preventDefault();
          onOpenWikilink(wikilink.dataset.wikilinkTarget);
          return true;
        }
        const queryNote = element?.closest<HTMLElement>('[data-query-note-id]');
        if (queryNote?.dataset.queryNoteId) {
          event.preventDefault();
          onOpenQueryNote(queryNote.dataset.queryNoteId);
          return true;
        }
        const link = element?.closest<HTMLElement>('[data-link-href]');
        if (link?.dataset.linkHref) {
          event.preventDefault();
          window.open(link.dataset.linkHref, '_blank', 'noopener,noreferrer');
          return true;
        }
        return false;
      },
    }),
  ];
}
