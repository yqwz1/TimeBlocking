export interface SerializableGraphView {
  v: 1;
  folder: string;
  tags: string[];
  sizeBy: 'pagerank' | 'degree';
  colorBy: 'folder' | 'tag' | 'community' | 'uniform';
  edges: { explicit: boolean; semantic: boolean; tag: boolean };
  concepts: boolean;
  regions: boolean;
  camera: { x: number; y: number; ratio: number; angle: number } | null;
  eraAt: string | null;
  pinned: Record<string, { x: number; y: number }>;
}

export interface SavedGraphView {
  id: string;
  name: string;
  createdAt: string;
  state: SerializableGraphView;
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeGraphView(state: SerializableGraphView): string {
  return toBase64Url(JSON.stringify(state));
}

export function decodeGraphView(encoded: string | null): SerializableGraphView | null {
  if (!encoded) return null;
  try {
    const value = JSON.parse(fromBase64Url(encoded)) as Partial<SerializableGraphView>;
    if (value.v !== 1 || !value.edges || !Array.isArray(value.tags)) return null;
    return { ...value, regions: value.regions ?? true } as SerializableGraphView;
  } catch {
    return null;
  }
}

export function graphViewUrl(state: SerializableGraphView, href = window.location.href): string {
  const url = new URL(href);
  url.searchParams.set('graph', '1');
  url.searchParams.set('view', encodeGraphView(state));
  return url.toString();
}

export function viewFromUrl(search = window.location.search): SerializableGraphView | null {
  return decodeGraphView(new URLSearchParams(search).get('view'));
}
