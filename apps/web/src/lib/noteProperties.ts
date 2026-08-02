export interface NoteProperty {
  key: string;
  value: string;
}

const RESERVED_KEYS = new Set(['tags', 'tagcolors', 'pinned', 'bookmark', 'color', 'icon']);
const PROPERTY_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;
const FRONTMATTER = /^(---)(\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === 'string' ? parsed : trimmed;
    } catch {
      return trimmed;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed === 'null' ? '' : trimmed;
}

/** Lists editable scalar YAML frontmatter fields. Built-in note controls keep their own UI. */
export function getNoteProperties(content: string): NoteProperty[] {
  const match = content.match(FRONTMATTER);
  if (!match) return [];

  const properties: NoteProperty[] = [];
  for (const line of match[3].split(/\r?\n/)) {
    const item = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!item || RESERVED_KEYS.has(item[1].toLowerCase())) continue;
    const rawValue = item[2].trim();
    // Nested YAML, arrays, and objects are left untouched. The properties panel is for simple values.
    if (!rawValue || /^[\[{]|[|>]/.test(rawValue)) continue;
    properties.push({ key: item[1], value: unquote(rawValue) });
  }
  return properties;
}

export function normalisePropertyKey(value: string): string | null {
  const key = value.trim().replace(/\s+/g, '-').toLowerCase();
  return PROPERTY_KEY.test(key) && !RESERVED_KEYS.has(key) ? key : null;
}

/** Adds, changes, or removes one scalar frontmatter property without touching the Markdown body. */
export function withNoteProperty(content: string, key: string, value: string | null): string {
  const normalisedKey = normalisePropertyKey(key);
  if (!normalisedKey) return content;
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const nextLine = value === null ? null : `${normalisedKey}: ${JSON.stringify(value.trim())}`;
  const match = content.match(FRONTMATTER);

  if (!match) {
    if (nextLine === null) return content;
    return `---${newline}${nextLine}${newline}---${newline}${content}`;
  }

  const lines = match[3].split(/\r?\n/);
  const propertyIndex = lines.findIndex((line) => new RegExp(`^${normalisedKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:` , 'i').test(line));
  if (propertyIndex >= 0 && nextLine === null) lines.splice(propertyIndex, 1);
  else if (propertyIndex >= 0 && nextLine !== null) lines[propertyIndex] = nextLine;
  else if (nextLine !== null) lines.push(nextLine);

  const frontmatter = lines.length ? `---${newline}${lines.join(newline)}${newline}---${newline}` : '';
  return `${frontmatter}${content.slice(match[0].length)}`;
}
