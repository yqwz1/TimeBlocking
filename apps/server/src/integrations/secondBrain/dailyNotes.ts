import { DateTime } from 'luxon';

const BLOCKS_START = '<!-- timeblock:blocks:start -->';
const BLOCKS_END = '<!-- timeblock:blocks:end -->';
const REFLECTION_START = '<!-- timeblock:reflection:start -->';
const REFLECTION_END = '<!-- timeblock:reflection:end -->';

export interface DailyBlock {
  id: string;
  title: string;
  startUtc: string;
  endUtc: string;
  status: string;
  url: string;
}

function replaceManagedSection(content: string, heading: string, start: string, end: string, body: string): string {
  const managed = `${start}\n${body.trim()}\n${end}`;
  const existing = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (existing.test(content)) return content.replace(existing, managed);
  const headingRe = new RegExp(`^${escapeRegExp(heading)}\\s*$`, 'm');
  if (headingRe.test(content)) return content.replace(headingRe, `${heading}\n\n${managed}`);
  return `${content.trimEnd()}\n\n${heading}\n\n${managed}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function ensureTodaysBlocksSection(content: string): string {
  return /^## Today's blocks\s*$/m.test(content) ? content : `${content.trimEnd()}\n\n## Today's blocks\n`;
}

export function syncDailyBlocks(content: string, blocks: DailyBlock[], timezone: string): string {
  const rows = blocks.length
    ? blocks.map((block) => {
        const start = DateTime.fromISO(block.startUtc).setZone(timezone).toFormat('HH:mm');
        const end = DateTime.fromISO(block.endUtc).setZone(timezone).toFormat('HH:mm');
        const checked = block.status === 'done' ? 'x' : ' ';
        return `- [${checked}] ${start}\u2013${end} [${block.title}](${block.url}) \`${block.status}\``;
      }).join('\n')
    : '_No time blocks scheduled._';
  return replaceManagedSection(ensureTodaysBlocksSection(content), "## Today's blocks", BLOCKS_START, BLOCKS_END, rows);
}

export function appendDailyReflection(content: string, reflection: string, blocks: DailyBlock[], timezone: string): string {
  const completed = blocks.filter((block) => block.status === 'done');
  const incomplete = blocks.filter((block) => !['done', 'cancelled'].includes(block.status));
  const render = (items: DailyBlock[]) => items.length
    ? items.map((block) => `- ${DateTime.fromISO(block.startUtc).setZone(timezone).toFormat('HH:mm')} [${block.title}](${block.url})`).join('\n')
    : '- None';
  const body = [
    reflection.trim() || '_No written reflection._',
    '',
    '### Completed blocks',
    render(completed),
    '',
    '### Incomplete blocks',
    render(incomplete),
  ].join('\n');
  return replaceManagedSection(content, '## End-of-day reflection', REFLECTION_START, REFLECTION_END, body);
}
