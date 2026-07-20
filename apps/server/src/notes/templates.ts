import path from 'node:path';
import { listMarkdownFiles, readNoteFile } from './vault.js';

export interface TemplateVars {
  date: string;
  time: string;
  title: string;
}

/** Substitutes `{{date}}`, `{{time}}`, `{{title}}` in template content. */
export function renderTemplate(content: string, vars: TemplateVars): string {
  return content.replace(/\{\{\s*(date|time|title)\s*\}\}/g, (_m, key: string) => vars[key as keyof TemplateVars]);
}

export interface TemplateSummary {
  id: string;
  title: string;
}

/** Lists `.md` files under the configured templates folder. Titled by filename, not by heading — a
 *  template's own `# {{title}}` heading is an unrendered placeholder, not a display name. */
export async function listTemplates(root: string, templatesFolder: string): Promise<TemplateSummary[]> {
  const prefix = `${templatesFolder.replace(/^\/+|\/+$/g, '')}/`;
  const files = await listMarkdownFiles(root);
  const out: TemplateSummary[] = [];
  for (const id of files) {
    if (!id.startsWith(prefix)) continue;
    if (!(await readNoteFile(root, id))) continue;
    out.push({ id, title: path.basename(id).replace(/\.md$/i, '') });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}
