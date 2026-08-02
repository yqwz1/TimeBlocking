import path from 'node:path';
import { listMarkdownFiles, readNoteFile } from './vault.js';

export interface TemplateVars {
  date: string;
  time: string;
  title: string;
}

const TEMPLATE_ICON_COMMENT = /^\s*<!--\s*template-icon:\s*([a-z0-9-]+)\s*-->\s*(?:\r?\n)?/i;

/** Reads the optional icon marker placed at the beginning of a template. */
function templateIcon(content: string): string | undefined {
  return TEMPLATE_ICON_COMMENT.exec(content)?.[1]?.toLowerCase();
}

/** Substitutes `{{date}}`, `{{time}}`, `{{title}}` in template content. */
export function renderTemplate(content: string, vars: TemplateVars): string {
  return content
    .replace(TEMPLATE_ICON_COMMENT, '')
    .replace(/\{\{\s*(date|time|title)\s*\}\}/g, (_m, key: string) => vars[key as keyof TemplateVars]);
}

export interface TemplateSummary {
  id: string;
  title: string;
  icon?: string;
}

/** Lists `.md` files under the configured templates folder. Titled by filename, not by heading — a
 *  template's own `# {{title}}` heading is an unrendered placeholder, not a display name. */
export async function listTemplates(root: string, templatesFolder: string): Promise<TemplateSummary[]> {
  const prefix = `${templatesFolder.replace(/^\/+|\/+$/g, '')}/`;
  const files = await listMarkdownFiles(root);
  const out: TemplateSummary[] = [];
  for (const id of files) {
    if (!id.startsWith(prefix)) continue;
    const file = await readNoteFile(root, id);
    if (!file) continue;
    out.push({ id, title: path.basename(id).replace(/\.md$/i, ''), icon: templateIcon(file.content) });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}
