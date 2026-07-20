import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { NodeCircleProgram } from 'sigma/rendering';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import { inferSettings } from 'graphology-layout-forceatlas2';
import { Check, FilePlus2, Lightbulb, Link2, Maximize2, Minus, Plus, Search, Sparkles, Trash2, Waypoints, X } from 'lucide-react';
import type { ConceptType, GraphPathResultDTO, GraphQueryFilterDTO, GraphWhyDTO, NoteGraphDTO, NoteGraphEdgeType, SuggestedEdgeDTO } from '@timeblock/shared';
import { useTheme } from '../../hooks/useTheme';
import { useSettings } from '../../hooks';
import { useAcceptSuggestion, useCreateNote, useDismissSuggestion, useGraphInsights, useGraphPath, useGraphQuery, useGraphSuggestions, useGraphWhy } from '../../hooks/notes';
import NodeDiamondProgram from './nodeDiamondProgram';
import ConceptInspector, { type InspectorTarget } from './ConceptInspector';

/**
 * The Graph — G3. Adds the concept layer: AI-extracted entities render as WebGL diamond nodes bridging
 * notes that share them, on a toggleable layer. Notes are circles (G1/G2 encoding: size = PageRank/degree,
 * colour = folder/tag, opacity = freshness, ring = open tasks). Explicit + concept edges live in sigma and
 * drive the layout; semantic (dashed) + tag (dotted) edges are drawn on a camera-synced 2D overlay.
 */

interface Palette {
  node: string;
  pinned: string;
  edge: string;
  label: string;
  hoverEdge: string;
  dim: string;
  semanticEdge: string;
  tagEdge: string;
  taskRing: string;
  concept: string;
  conceptEdge: string;
  minimapNode: string;
  minimapView: string;
}

const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    node: '#0d9488',
    pinned: '#d97706',
    edge: 'rgba(100,116,139,0.35)',
    label: '#475569',
    hoverEdge: 'rgba(13,148,136,0.85)',
    dim: 'rgba(148,163,184,0.28)',
    semanticEdge: 'rgba(13,148,136,0.55)',
    tagEdge: 'rgba(217,119,6,0.6)',
    taskRing: '#0d9488',
    concept: '#9333ea',
    conceptEdge: 'rgba(147,51,234,0.32)',
    minimapNode: 'rgba(71,85,105,0.7)',
    minimapView: 'rgba(13,148,136,0.9)',
  },
  dark: {
    node: '#2dd4bf',
    pinned: '#fbbf24',
    edge: 'rgba(148,163,184,0.22)',
    label: '#cbd5e1',
    hoverEdge: 'rgba(45,212,191,0.9)',
    dim: 'rgba(100,116,139,0.2)',
    semanticEdge: 'rgba(45,212,191,0.6)',
    tagEdge: 'rgba(251,191,36,0.55)',
    taskRing: '#2dd4bf',
    concept: '#c084fc',
    conceptEdge: 'rgba(192,132,252,0.4)',
    minimapNode: 'rgba(148,163,184,0.7)',
    minimapView: 'rgba(45,212,191,0.9)',
  },
};

const CATEGORY_COLORS = [
  '#0d9488', '#6366f1', '#db2777', '#ea580c', '#16a34a', '#0891b2',
  '#9333ea', '#ca8a04', '#dc2626', '#2563eb', '#059669', '#c026d3',
];

const MAX_OVERLAY_EDGES = 4000;

type SizeBy = 'pagerank' | 'degree';
type ColorBy = 'folder' | 'tag' | 'community' | 'uniform';
type EdgeToggles = { explicit: boolean; semantic: boolean; tag: boolean };

interface NodeAttrs {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  folder: string;
  tags: string[];
  pinned: boolean;
  pagerank: number;
  degree: number;
  betweenness: number;
  openTasks: number;
  freshnessDays: number;
  kind: 'note' | 'concept';
  conceptType: ConceptType | null;
  communityId: string | null;
  communityLabel: string | null;
}

/** Unordered pair key for path/ghost edge sets. '|' is illegal in a note id, so it never collides. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function categoryColor(key: string): string {
  return CATEGORY_COLORS[hashString(key) % CATEGORY_COLORS.length];
}
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
function noteSizeUnits(a: NodeAttrs, sizeBy: SizeBy): number {
  const base = sizeBy === 'pagerank' ? 3 + (a.pagerank || 0) * 13 : 3 + Math.min(a.degree || 0, 12) * 0.9;
  return base + (a.pinned ? 1 : 0);
}
function conceptSizeUnits(a: NodeAttrs): number {
  return 5 + Math.min(a.degree || 0, 10) * 0.7;
}
function baseColorFor(a: NodeAttrs, colorBy: ColorBy, folderColors: Map<string, string>, palette: Palette): string {
  if (colorBy === 'uniform') return a.pinned ? palette.pinned : palette.node;
  if (colorBy === 'folder') return folderColors.get(a.folder) ?? palette.node;
  if (colorBy === 'community') return a.communityId ? categoryColor(a.communityId) : '#94a3b8';
  return a.tags.length ? categoryColor(a.tags[0]) : palette.node;
}
function freshnessOpacity(days: number, fadeDays: number): number {
  if (fadeDays <= 0) return 1;
  return 1 - 0.7 * Math.min(1, days / fadeDays);
}

interface HoverCard {
  x: number;
  y: number;
  kind: 'note' | 'concept';
  title: string;
  folder: string;
  tags: string[];
  degree: number;
  openTasks: number;
  pagerank: number;
  freshnessDays: number;
  conceptType: ConceptType | null;
}

export default function GraphView({
  graph: dto,
  onNavigate,
  onClose,
  focusIds,
  onClearFocus,
}: {
  graph: NoteGraphDTO;
  onNavigate: (id: string) => void;
  onClose: () => void;
  /** G4 spatial citations: fly to + highlight this subgraph (from a chat answer). */
  focusIds?: string[];
  onClearFocus?: () => void;
}) {
  const { resolved } = useTheme();
  const palette = PALETTES[resolved];
  const { data: settings } = useSettings();
  const fadeDays = settings?.graphFreshnessFadeDays ?? 45;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const layoutRef = useRef<FA2Layout | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const focusRef = useRef<Set<string>>(new Set());
  const reheatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onNavigateRef = useRef(onNavigate);

  const [sizeBy, setSizeBy] = useState<SizeBy>('pagerank');
  const [colorBy, setColorBy] = useState<ColorBy>('folder');
  const [edgeTypes, setEdgeTypes] = useState<EdgeToggles>({ explicit: true, semantic: true, tag: true });
  const [conceptLayer, setConceptLayer] = useState(true);
  const [inspector, setInspector] = useState<InspectorTarget | null>(null);

  const paletteRef = useRef(palette);
  const sizeByRef = useRef(sizeBy);
  const colorByRef = useRef(colorBy);
  const edgeTypesRef = useRef(edgeTypes);
  const fadeDaysRef = useRef(fadeDays);
  const folderColorsRef = useRef<Map<string, string>>(new Map());
  const typedEdgesRef = useRef<Array<{ source: string; target: string; type: NoteGraphEdgeType }>>([]);
  const setInspectorRef = useRef(setInspector);
  paletteRef.current = palette;
  sizeByRef.current = sizeBy;
  colorByRef.current = colorBy;
  edgeTypesRef.current = edgeTypes;
  fadeDaysRef.current = fadeDays;
  onNavigateRef.current = onNavigate;
  setInspectorRef.current = setInspector;

  const [hoverCard, setHoverCard] = useState<HoverCard | null>(null);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState<string | 'all'>('all');

  // ── G6 §5 NL query · §6 connect · §7 suggestions state ──────────────────────
  const [queryText, setQueryText] = useState('');
  const [nlFilter, setNlFilter] = useState<GraphQueryFilterDTO | null>(null);
  const [nlInterp, setNlInterp] = useState('');
  const [connectMode, setConnectMode] = useState(false);
  const [connectSel, setConnectSel] = useState<string[]>([]);
  const [pathResult, setPathResult] = useState<GraphPathResultDTO | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [evidence, setEvidence] = useState<{ source: string; target: string; sourceTitle: string; targetTitle: string; why: GraphWhyDTO | null } | null>(null);
  const aiEnabled = settings?.aiEnabled ?? false;

  const graphQuery = useGraphQuery();
  const graphPath = useGraphPath();
  const graphWhy = useGraphWhy();
  const suggestionsQuery = useGraphSuggestions(showSuggestions);
  const acceptSug = useAcceptSuggestion();
  const dismissSug = useDismissSuggestion();
  const suggestions = suggestionsQuery.data ?? [];

  // ── G6 §8 — Insights (orphans · blind spots · bridges · stale-central · duplicates) ──
  const insightsQuery = useGraphInsights(showInsights);
  const insights = insightsQuery.data;
  const createNote = useCreateNote();
  // Turn a concept name into a safe root-level note path; the server refuses truly illegal names.
  const createNoteForConcept = useCallback(
    (name: string) => {
      const safe = name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
      createNote.mutate(
        { path: `${safe}.md`, content: `# ${name}\n\n` },
        { onSuccess: (note) => onNavigate(note.id) },
      );
    },
    [createNote, onNavigate],
  );

  const pathNodesRef = useRef<Set<string>>(new Set());
  const pathEdgesRef = useRef<Set<string>>(new Set());
  const pathChainRef = useRef<string[]>([]);
  const connectSelRef = useRef<string[]>([]);
  const connectModeRef = useRef(false);
  const suggestRef = useRef<SuggestedEdgeDTO[]>([]);
  const showSuggestRef = useRef(false);
  const onPickConnectRef = useRef<(id: string) => void>(() => {});
  const ghostFrameRef = useRef(0);
  connectModeRef.current = connectMode;
  connectSelRef.current = connectSel;
  suggestRef.current = showSuggestions ? suggestions : [];
  showSuggestRef.current = showSuggestions;

  const titleById = useMemo(() => new Map(dto.nodes.map((n) => [n.id, n.title])), [dto.nodes]);

  const allTags = useMemo(() => Array.from(new Set(dto.nodes.flatMap((n) => n.tags))).sort(), [dto.nodes]);
  const allFolders = useMemo(() => Array.from(new Set(dto.nodes.filter((n) => n.kind === 'note').map((n) => n.folder))).sort(), [dto.nodes]);

  // G6 §5: does a note pass the AI-compiled NL filter? (Additive: an empty facet does not constrain.)
  const passesNl = useMemo(() => {
    return (n: NoteGraphDTO['nodes'][number]): boolean => {
      const f = nlFilter;
      if (!f) return true;
      if (f.tags.length && !n.tags.some((t) => f.tags.some((ft) => ft.toLowerCase() === t.toLowerCase()))) return false;
      if (f.folders.length && !f.folders.some((fd) => fd.toLowerCase() === n.folder.toLowerCase())) return false;
      if (f.communityLabels.length && !(n.communityLabel && f.communityLabels.some((cl) => cl.toLowerCase() === n.communityLabel!.toLowerCase()))) return false;
      if (f.untouchedMinDays != null && n.freshnessDays < f.untouchedMinDays) return false;
      if (f.minPagerank != null && n.pagerank < f.minPagerank) return false;
      if (f.minDegree != null && n.degree < f.minDegree) return false;
      if (f.minBetweenness != null && n.betweenness < f.minBetweenness) return false;
      if (f.hasOpenTasks && n.openTasks <= 0) return false;
      if (f.text) {
        const hay = `${n.title} ${n.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(f.text.toLowerCase())) return false;
      }
      return true;
    };
  }, [nlFilter]);

  const { nodes, links } = useMemo(() => {
    const noteVisible = new Set(
      dto.nodes
        .filter(
          (n) =>
            n.kind === 'note' &&
            (folder === 'all' || n.folder === folder) &&
            (activeTags.size === 0 || n.tags.some((t) => activeTags.has(t))) &&
            passesNl(n),
        )
        .map((n) => n.id),
    );
    // Concept nodes are kept only if they still bridge ≥2 currently-visible notes.
    const conceptEdgesToVisible = new Map<string, number>();
    for (const e of dto.edges) {
      if (e.type === 'concept' && noteVisible.has(e.source)) conceptEdgesToVisible.set(e.target, (conceptEdgesToVisible.get(e.target) ?? 0) + 1);
    }
    const visible = new Set(noteVisible);
    for (const n of dto.nodes) if (n.kind === 'concept' && (conceptEdgesToVisible.get(n.id) ?? 0) >= 2) visible.add(n.id);
    return {
      nodes: dto.nodes.filter((n) => visible.has(n.id)),
      links: dto.edges.filter((e) => visible.has(e.source) && visible.has(e.target)),
    };
  }, [dto, activeTags, folder, passesNl]);

  const noteCount = nodes.filter((n) => n.kind === 'note').length;
  const conceptCount = nodes.filter((n) => n.kind === 'concept').length;
  const explicitCount = links.filter((e) => e.type === 'explicit').length;
  const semanticCount = links.filter((e) => e.type === 'semantic').length;
  const tagCount = links.filter((e) => e.type === 'tag').length;

  const reheat = useCallback((ms = 2500) => {
    const layout = layoutRef.current;
    if (!layout) return;
    if (!layout.isRunning()) layout.start();
    if (reheatTimer.current) clearTimeout(reheatTimer.current);
    reheatTimer.current = setTimeout(() => layout.isRunning() && layout.stop(), ms);
  }, []);

  // ── G6 §6: apply a computed path — highlight its nodes/edges + fly to it. ────
  const applyPath = useCallback((res: GraphPathResultDTO | null) => {
    setPathResult(res);
    const chain = res && res.strongest.length ? res.strongest : res?.shortest ?? [];
    pathNodesRef.current = new Set(chain.map((s) => s.id));
    const edgeSet = new Set<string>();
    for (let i = 1; i < chain.length; i++) edgeSet.add(pairKey(chain[i - 1].id, chain[i].id));
    pathEdgesRef.current = edgeSet;
    pathChainRef.current = chain.map((s) => s.id);
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    sigma?.refresh();
    if (!sigma || !graph || chain.length === 0) return;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const s of chain) {
      if (!graph.hasNode(s.id)) continue;
      const a = graph.getNodeAttributes(s.id) as unknown as NodeAttrs;
      sx += a.x;
      sy += a.y;
      n++;
    }
    if (n > 0) sigma.getCamera().animate({ x: sx / n, y: sy / n, ratio: 0.5 }, { duration: 500 });
  }, []);

  const clearConnect = useCallback(() => {
    setConnectSel([]);
    applyPath(null);
  }, [applyPath]);

  // Pick up to two endpoints in Connect mode; on the second, compute the path.
  const handlePickConnect = useCallback(
    (id: string) => {
      setConnectSel((prev) => {
        if (prev.includes(id)) return prev;
        const next = prev.length >= 2 ? [id] : [...prev, id];
        if (next.length === 2) {
          graphPath.mutate({ source: next[0], target: next[1] }, { onSuccess: applyPath });
        } else {
          applyPath(null);
        }
        return next;
      });
    },
    [applyPath, graphPath],
  );
  onPickConnectRef.current = handlePickConnect;

  const openWhy = useCallback(
    (source: string, target: string) => {
      setEvidence({ source, target, sourceTitle: titleById.get(source) ?? source, targetTitle: titleById.get(target) ?? target, why: null });
      graphWhy.mutate({ source, target }, { onSuccess: (why) => setEvidence((e) => (e && e.source === source && e.target === target ? { ...e, why } : e)) });
    },
    [graphWhy, titleById],
  );

  function runQuery() {
    const q = queryText.trim();
    if (!q || graphQuery.isPending) return;
    graphQuery.mutate(q, {
      onSuccess: (res) => {
        setNlFilter(res.filter);
        setNlInterp(res.interpretation);
      },
    });
  }

  // ── Create the sigma instance once. ────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const graph = new Graph({ type: 'undirected' });
    graphRef.current = graph;

    const sigma = new Sigma(graph, container, {
      renderLabels: true,
      labelRenderedSizeThreshold: 6,
      labelFont: 'Inter, system-ui, sans-serif',
      labelSize: 12,
      labelWeight: '500',
      labelColor: { color: paletteRef.current.label },
      defaultNodeColor: paletteRef.current.node,
      defaultNodeType: 'circle',
      nodeProgramClasses: { circle: NodeCircleProgram, diamond: NodeDiamondProgram },
      defaultEdgeColor: paletteRef.current.edge,
      zIndex: true,
      minCameraRatio: 0.08,
      maxCameraRatio: 8,
      nodeReducer: (node, data) => {
        const a = graph.getNodeAttributes(node) as unknown as NodeAttrs;
        const hovered = hoveredRef.current;
        if (a.kind === 'concept') {
          const size = conceptSizeUnits(a);
          const c = paletteRef.current.concept;
          if (hovered) {
            if (node === hovered) return { ...data, size: size + 1, color: c, zIndex: 2, forceLabel: true };
            if (graph.areNeighbors(hovered, node)) return { ...data, size, color: c, zIndex: 1, forceLabel: true };
            return { ...data, size, color: paletteRef.current.dim, label: '', zIndex: 0 };
          }
          if (pathNodesRef.current.size > 0 && !pathNodesRef.current.has(node)) return { ...data, size, color: paletteRef.current.dim, label: '', zIndex: 0 };
          if (pathNodesRef.current.has(node)) return { ...data, size: size + 1, color: c, zIndex: 2, forceLabel: true };
          if (focusRef.current.size > 0) return { ...data, size, color: paletteRef.current.dim, label: '', zIndex: 0 };
          return { ...data, size, color: c };
        }
        const size = noteSizeUnits(a, sizeByRef.current);
        const base = baseColorFor(a, colorByRef.current, folderColorsRef.current, paletteRef.current);
        const op = freshnessOpacity(a.freshnessDays, fadeDaysRef.current);
        if (hovered) {
          if (node === hovered) return { ...data, size: size + 1, color: hexToRgba(base, 1), zIndex: 2, forceLabel: true };
          if (graph.areNeighbors(hovered, node)) return { ...data, size, color: hexToRgba(base, Math.max(op, 0.65)), zIndex: 1, forceLabel: true };
          return { ...data, size, color: paletteRef.current.dim, label: '', zIndex: 0 };
        }
        // G6 §6: Connect-mode path / endpoint highlight takes over the canvas.
        const path = pathNodesRef.current;
        const sel = connectSelRef.current;
        if (path.size > 0) {
          if (path.has(node)) return { ...data, size: size + (sel.includes(node) ? 2 : 1.2), color: hexToRgba(base, 1), zIndex: 2, forceLabel: true };
          return { ...data, size, color: paletteRef.current.dim, label: '', zIndex: 0 };
        }
        if (sel.length > 0) {
          if (sel.includes(node)) return { ...data, size: size + 2, color: hexToRgba(base, 1), zIndex: 2, forceLabel: true };
          if (connectModeRef.current) return { ...data, size, color: hexToRgba(base, Math.max(op * 0.6, 0.25)) };
        }
        const focus = focusRef.current;
        if (focus.size > 0) {
          if (focus.has(node)) return { ...data, size: size + 1.5, color: hexToRgba(base, 1), zIndex: 2, forceLabel: true };
          return { ...data, size, color: paletteRef.current.dim, label: '', zIndex: 0 };
        }
        return { ...data, size, color: hexToRgba(base, op) };
      },
      edgeReducer: (edge, data) => {
        const etype = (data.etype as NoteGraphEdgeType) ?? 'explicit';
        if (etype === 'explicit' && !edgeTypesRef.current.explicit) return { ...data, hidden: true };
        const hovered = hoveredRef.current;
        if (hovered) {
          if (graph.hasExtremity(edge, hovered)) {
            const color = etype === 'concept' ? paletteRef.current.concept : paletteRef.current.hoverEdge;
            return { ...data, color, size: etype === 'concept' ? 1.2 : 1.6, zIndex: 1 };
          }
          return { ...data, hidden: true };
        }
        if (etype === 'concept') return { ...data, color: paletteRef.current.conceptEdge, size: 0.9 };
        const w = (data.weight as number) ?? 1;
        return { ...data, color: paletteRef.current.edge, size: Math.min(0.5 + w * 0.35, 3) };
      },
    });
    sigmaRef.current = sigma;

    const layout = new FA2Layout(graph, {
      settings: { ...inferSettings(graph), gravity: 1.2, scalingRatio: 12, slowDown: 4, barnesHutOptimize: true, edgeWeightInfluence: 1 },
    });
    layoutRef.current = layout;

    sigma.on('clickNode', ({ node }) => {
      const a = graph.getNodeAttributes(node) as unknown as NodeAttrs;
      // G6 §6: in Connect mode a click picks path endpoints instead of navigating.
      if (connectModeRef.current) {
        onPickConnectRef.current(node);
        return;
      }
      if (a.kind === 'concept') {
        setInspectorRef.current({ conceptId: node.slice('concept:'.length), name: a.label, type: a.conceptType, mentions: a.degree });
      } else {
        onNavigateRef.current(node);
      }
    });
    sigma.on('enterNode', ({ node }) => {
      hoveredRef.current = node;
      const a = graph.getNodeAttributes(node) as unknown as NodeAttrs;
      const pos = sigma.graphToViewport({ x: a.x, y: a.y });
      setHoverCard({
        x: pos.x,
        y: pos.y,
        kind: a.kind,
        title: a.label ?? node,
        folder: a.folder ?? '',
        tags: a.tags ?? [],
        degree: a.degree ?? graph.degree(node),
        openTasks: a.openTasks ?? 0,
        pagerank: a.pagerank ?? 0,
        freshnessDays: a.freshnessDays ?? 0,
        conceptType: a.conceptType ?? null,
      });
      sigma.refresh();
      container.style.cursor = 'pointer';
    });
    sigma.on('leaveNode', () => {
      hoveredRef.current = null;
      setHoverCard(null);
      sigma.refresh();
      container.style.cursor = 'default';
    });

    const drawOverlay = () => {
      const canvas = overlayRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = container.offsetWidth;
      const h = container.offsetHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      const hovered = hoveredRef.current;
      const toggles = edgeTypesRef.current;

      let drawn = 0;
      for (const e of typedEdgesRef.current) {
        if (e.type === 'semantic' && !toggles.semantic) continue;
        if (e.type === 'tag' && !toggles.tag) continue;
        if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
        if (hovered && e.source !== hovered && e.target !== hovered) continue;
        const p1 = sigma.graphToViewport(graph.getNodeAttributes(e.source) as { x: number; y: number });
        const p2 = sigma.graphToViewport(graph.getNodeAttributes(e.target) as { x: number; y: number });
        ctx.setLineDash(e.type === 'semantic' ? [6, 5] : [1.5, 5]);
        ctx.lineWidth = e.type === 'semantic' ? 1.4 : 1.3;
        ctx.strokeStyle = e.type === 'semantic' ? paletteRef.current.semanticEdge : paletteRef.current.tagEdge;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        if (++drawn >= MAX_OVERLAY_EDGES) break;
      }
      ctx.setLineDash([]);

      // G6 §7: suggested (ghost) edges — animated violet dashes between not-yet-linked note pairs.
      if (showSuggestRef.current && suggestRef.current.length) {
        ghostFrameRef.current = (ghostFrameRef.current + 1) % 100000;
        ctx.setLineDash([2, 6]);
        ctx.lineDashOffset = -(ghostFrameRef.current * 0.6);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = paletteRef.current.concept;
        for (const s of suggestRef.current) {
          if (!graph.hasNode(s.source) || !graph.hasNode(s.target)) continue;
          if (hovered && s.source !== hovered && s.target !== hovered) continue;
          const p1 = sigma.graphToViewport(graph.getNodeAttributes(s.source) as { x: number; y: number });
          const p2 = sigma.graphToViewport(graph.getNodeAttributes(s.target) as { x: number; y: number });
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }

      // G6 §6: the connection path drawn bright over everything.
      const chain = pathChainRef.current;
      if (chain.length > 1) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = paletteRef.current.hoverEdge;
        ctx.beginPath();
        let started = false;
        for (const id of chain) {
          if (!graph.hasNode(id)) {
            started = false;
            continue;
          }
          const p = sigma.graphToViewport(graph.getNodeAttributes(id) as { x: number; y: number });
          if (started) ctx.lineTo(p.x, p.y);
          else ctx.moveTo(p.x, p.y);
          started = true;
        }
        ctx.stroke();
      }

      graph.forEachNode((id, attr) => {
        const a = attr as unknown as NodeAttrs;
        if (a.kind === 'concept' || (!a.openTasks && !a.pinned)) return;
        if (hovered && id !== hovered && !graph.areNeighbors(hovered, id)) return;
        const p = sigma.graphToViewport({ x: a.x, y: a.y });
        const dd = sigma.getNodeDisplayData(id);
        const r = (dd ? sigma.scaleSize(dd.size) : 5) + 3;
        if (a.pinned) {
          ctx.strokeStyle = paletteRef.current.pinned;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (a.openTasks) {
          ctx.strokeStyle = paletteRef.current.taskRing;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + (a.pinned ? 3 : 0), 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    };

    const drawMinimap = () => {
      const canvas = minimapRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      if (graph.order === 0) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      graph.forEachNode((_n, a) => {
        minX = Math.min(minX, a.x);
        minY = Math.min(minY, a.y);
        maxX = Math.max(maxX, a.x);
        maxY = Math.max(maxY, a.y);
      });
      const pad = 6;
      const spanX = maxX - minX || 1;
      const spanY = maxY - minY || 1;
      const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
      const offX = (W - spanX * scale) / 2;
      const offY = (H - spanY * scale) / 2;
      const toMap = (x: number, y: number) => ({ x: offX + (x - minX) * scale, y: offY + (y - minY) * scale });
      graph.forEachNode((_n, attr) => {
        const a = attr as unknown as NodeAttrs;
        const p = toMap(a.x, a.y);
        ctx.fillStyle = a.kind === 'concept' ? paletteRef.current.concept : paletteRef.current.minimapNode;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      });
      const tl = sigma.viewportToGraph({ x: 0, y: 0 });
      const br = sigma.viewportToGraph({ x: container.offsetWidth, y: container.offsetHeight });
      const a = toMap(tl.x, tl.y);
      const b = toMap(br.x, br.y);
      ctx.strokeStyle = paletteRef.current.minimapView;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    };

    sigma.on('afterRender', () => {
      drawOverlay();
      drawMinimap();
    });

    return () => {
      if (reheatTimer.current) clearTimeout(reheatTimer.current);
      layout.kill();
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
      layoutRef.current = null;
    };
  }, []);

  // ── Reconcile the graph in place when the filtered set / concept layer changes. ──
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;

    const folderColors = new Map<string, string>();
    for (const f of Array.from(new Set(dto.nodes.filter((n) => n.kind === 'note').map((n) => n.folder))).sort()) folderColors.set(f, categoryColor(f || 'root'));
    folderColorsRef.current = folderColors;

    const showConcepts = conceptLayer;
    const visibleNodes = nodes.filter((n) => n.kind === 'note' || showConcepts);
    typedEdgesRef.current = links.filter((e) => e.type === 'semantic' || e.type === 'tag').map((e) => ({ source: e.source, target: e.target, type: e.type }));
    // Edges that live in sigma + drive the layout: explicit always, concept when the layer is on.
    const graphLinks = links.filter((e) => e.type === 'explicit' || (showConcepts && e.type === 'concept'));

    const desired = new Set(visibleNodes.map((n) => n.id));
    for (const id of graph.nodes()) if (!desired.has(id)) graph.dropNode(id);

    const cam = sigma.getCamera().getState();
    for (const n of visibleNodes) {
      const attrs: Partial<NodeAttrs> = {
        label: n.title,
        folder: n.folder,
        tags: n.tags,
        pinned: n.pinned,
        pagerank: n.pagerank,
        degree: n.degree,
        betweenness: n.betweenness,
        openTasks: n.openTasks,
        freshnessDays: n.freshnessDays,
        kind: n.kind,
        conceptType: n.conceptType,
        communityId: n.communityId,
        communityLabel: n.communityLabel,
      };
      if (graph.hasNode(n.id)) {
        graph.mergeNodeAttributes(n.id, attrs);
      } else {
        graph.addNode(n.id, {
          ...attrs,
          type: n.kind === 'concept' ? 'diamond' : 'circle',
          x: cam.x + (Math.random() - 0.5) * 0.4,
          y: cam.y + (Math.random() - 0.5) * 0.4,
          size: n.kind === 'concept' ? 5 : 4,
          color: n.kind === 'concept' ? paletteRef.current.concept : paletteRef.current.node,
        });
      }
    }

    for (const e of graphLinks) {
      if (graph.hasNode(e.source) && graph.hasNode(e.target) && !graph.hasEdge(e.source, e.target)) {
        graph.addEdge(e.source, e.target, { weight: e.weight, etype: e.type });
      }
    }
    const wanted = new Set(graphLinks.map((e) => `${e.source}|${e.target}`));
    for (const edge of graph.edges()) {
      const [s, t] = graph.extremities(edge);
      if (!wanted.has(`${s}|${t}`) && !wanted.has(`${t}|${s}`)) graph.dropEdge(edge);
    }

    sigma.refresh();
    reheat();
  }, [nodes, links, dto.nodes, conceptLayer, reheat]);

  useEffect(() => {
    sigmaRef.current?.refresh();
  }, [sizeBy, colorBy, edgeTypes, palette, fadeDays]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.setSetting('labelColor', { color: palette.label });
    sigma.setSetting('defaultEdgeColor', palette.edge);
    sigma.refresh();
  }, [palette]);

  // ── G4 spatial citations: highlight the focus subgraph and fly the camera to its centroid. ──
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;
    focusRef.current = new Set(focusIds ?? []);
    sigma.refresh();
    const present = (focusIds ?? []).filter((id) => graph.hasNode(id));
    if (present.length === 0) return;
    let sx = 0;
    let sy = 0;
    for (const id of present) {
      const a = graph.getNodeAttributes(id) as unknown as NodeAttrs;
      sx += a.x;
      sy += a.y;
    }
    const ratio = present.length <= 3 ? 0.28 : present.length <= 12 ? 0.42 : 0.6;
    sigma.getCamera().animate({ x: sx / present.length, y: sy / present.length, ratio }, { duration: 500 });
    // The layout may still be settling — re-center shortly after so the fly-to lands on final positions.
    const t = setTimeout(() => {
      const g = graphRef.current;
      const s = sigmaRef.current;
      if (!g || !s) return;
      let x = 0;
      let y = 0;
      let n = 0;
      for (const id of present) {
        if (!g.hasNode(id)) continue;
        const a = g.getNodeAttributes(id) as unknown as NodeAttrs;
        x += a.x;
        y += a.y;
        n++;
      }
      if (n > 0) s.getCamera().animate({ x: x / n, y: y / n, ratio }, { duration: 400 });
    }, 900);
    return () => clearTimeout(t);
  }, [focusIds]);

  // G6 §7: keep repainting so the ghost-edge dashes animate while the suggestions layer is on.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.refresh();
    if (!showSuggestions) return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 45) {
        sigma.refresh();
        last = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showSuggestions, suggestions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (evidence) setEvidence(null);
      else if (inspector) setInspector(null);
      else if (connectMode) {
        setConnectMode(false);
        clearConnect();
      } else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, inspector, evidence, connectMode, clearConnect]);

  const zoomIn = () => sigmaRef.current?.getCamera().animatedZoom({ duration: 200 });
  const zoomOut = () => sigmaRef.current?.getCamera().animatedUnzoom({ duration: 200 });
  const resetView = () => sigmaRef.current?.getCamera().animatedReset({ duration: 300 });

  const toggleTag = (t: string) =>
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const segBtn = (active: boolean) =>
    `px-2 py-0.5 text-xs transition-colors ${active ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5'}`;

  // G6 §5: the compiled NL filter rendered as editable chips (remove one to tweak the query by hand).
  const patchFilter = (patch: Partial<GraphQueryFilterDTO>) => setNlFilter((f) => (f ? { ...f, ...patch } : f));
  const nlChips: { key: string; label: string; clear: () => void }[] = [];
  if (nlFilter) {
    for (const t of nlFilter.tags) nlChips.push({ key: `tag:${t}`, label: `#${t}`, clear: () => patchFilter({ tags: nlFilter.tags.filter((x) => x !== t) }) });
    for (const fd of nlFilter.folders) nlChips.push({ key: `folder:${fd}`, label: `📁 ${fd || 'root'}`, clear: () => patchFilter({ folders: nlFilter.folders.filter((x) => x !== fd) }) });
    for (const cl of nlFilter.communityLabels) nlChips.push({ key: `com:${cl}`, label: `⬦ ${cl}`, clear: () => patchFilter({ communityLabels: nlFilter.communityLabels.filter((x) => x !== cl) }) });
    if (nlFilter.untouchedMinDays != null) nlChips.push({ key: 'untouched', label: `untouched ≥ ${nlFilter.untouchedMinDays}d`, clear: () => patchFilter({ untouchedMinDays: null }) });
    if (nlFilter.minPagerank != null) nlChips.push({ key: 'pr', label: `PageRank ≥ ${nlFilter.minPagerank.toFixed(2)}`, clear: () => patchFilter({ minPagerank: null }) });
    if (nlFilter.minDegree != null) nlChips.push({ key: 'deg', label: `degree ≥ ${nlFilter.minDegree}`, clear: () => patchFilter({ minDegree: null }) });
    if (nlFilter.minBetweenness != null) nlChips.push({ key: 'btw', label: `betweenness ≥ ${nlFilter.minBetweenness.toFixed(2)}`, clear: () => patchFilter({ minBetweenness: null }) });
    if (nlFilter.hasOpenTasks) nlChips.push({ key: 'tasks', label: 'has open tasks', clear: () => patchFilter({ hasOpenTasks: false }) });
    if (nlFilter.text) nlChips.push({ key: 'text', label: `"${nlFilter.text}"`, clear: () => patchFilter({ text: null }) });
  }
  const clearNl = () => {
    setNlFilter(null);
    setNlInterp('');
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-neutral-950">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-2 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-200">Graph</h2>

        <div className="flex items-center gap-2">
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          >
            <option value="all">All folders</option>
            {allFolders.map((f) => (
              <option key={f} value={f}>
                {f || '(root)'}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-1">
            {allTags.map((t) => {
              const active = activeTags.has(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    active ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:text-neutral-300 dark:hover:bg-white/10'
                  }`}
                >
                  #{t}
                </button>
              );
            })}
            {activeTags.size > 0 && (
              <button onClick={() => setActiveTags(new Set())} className="text-xs text-slate-400 underline hover:text-slate-600 dark:hover:text-neutral-300">
                clear
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-neutral-500">Size</span>
          <div className="flex overflow-hidden rounded-md border border-slate-300 dark:border-neutral-700">
            <button className={segBtn(sizeBy === 'pagerank')} onClick={() => setSizeBy('pagerank')}>PageRank</button>
            <button className={segBtn(sizeBy === 'degree')} onClick={() => setSizeBy('degree')}>Degree</button>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-neutral-500">Color</span>
          <div className="flex overflow-hidden rounded-md border border-slate-300 dark:border-neutral-700">
            <button className={segBtn(colorBy === 'folder')} onClick={() => setColorBy('folder')}>Folder</button>
            <button className={segBtn(colorBy === 'tag')} onClick={() => setColorBy('tag')}>Tag</button>
            <button className={segBtn(colorBy === 'community')} onClick={() => setColorBy('community')} title="Colour by detected community (G4)">Community</button>
            <button className={segBtn(colorBy === 'uniform')} onClick={() => setColorBy('uniform')}>None</button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(
            [
              ['explicit', 'Links', palette.edge, explicitCount],
              ['semantic', 'Semantic', palette.semanticEdge, semanticCount],
              ['tag', 'Tags', palette.tagEdge, tagCount],
            ] as const
          ).map(([key, label, color, count]) => {
            const on = edgeTypes[key];
            return (
              <button
                key={key}
                onClick={() => setEdgeTypes((p) => ({ ...p, [key]: !p[key] }))}
                title={`${count} ${label.toLowerCase()} edges`}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                  on ? 'border-slate-300 text-slate-600 dark:border-neutral-600 dark:text-neutral-300' : 'border-slate-200 text-slate-300 line-through dark:border-neutral-800 dark:text-neutral-600'
                }`}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: on ? color : 'transparent', border: `1px solid ${color}` }} />
                {label} {count}
              </button>
            );
          })}
          <button
            onClick={() => setConceptLayer((v) => !v)}
            title={`${conceptCount} concept nodes`}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
              conceptLayer ? 'border-slate-300 text-slate-600 dark:border-neutral-600 dark:text-neutral-300' : 'border-slate-200 text-slate-300 line-through dark:border-neutral-800 dark:text-neutral-600'
            }`}
          >
            <span className="inline-block h-2 w-2 rotate-45" style={{ backgroundColor: conceptLayer ? palette.concept : 'transparent', border: `1px solid ${palette.concept}` }} />
            Concepts {conceptCount}
          </button>
        </div>

        {focusIds && focusIds.length > 0 && (
          <button
            onClick={() => onClearFocus?.()}
            className="ml-auto flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 hover:bg-teal-100 dark:bg-teal-500/15 dark:text-teal-300 dark:hover:bg-teal-500/25"
            title="Clear the chat highlight"
          >
            Focused · {focusIds.length} note{focusIds.length === 1 ? '' : 's'}
            <X size={12} />
          </button>
        )}
        <span className={`${focusIds && focusIds.length > 0 ? '' : 'ml-auto'} text-xs text-slate-400 dark:text-neutral-500`}>
          {noteCount} notes{dto.indexReady ? '' : ' · indexing…'}
        </span>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-neutral-300"
          title="Close (Esc)"
        >
          <X size={18} />
        </button>
      </div>

      {/* G6 §5/§6/§7 row: ask-the-graph query bar + compiled chips + Connect / Suggestions toggles. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-neutral-800">
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={queryText}
              dir="auto"
              onChange={(e) => setQueryText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runQuery()}
              disabled={!aiEnabled}
              placeholder={aiEnabled ? 'Ask the graph… e.g. gamedev notes I haven’t touched in 3 months' : 'Ask the graph (enable AI in Settings)'}
              className="w-80 max-w-[60vw] rounded-md border border-slate-300 py-1 pl-7 pr-2 text-xs disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <button
            onClick={runQuery}
            disabled={!aiEnabled || !queryText.trim() || graphQuery.isPending}
            className="rounded-md bg-teal-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
          >
            {graphQuery.isPending ? '…' : 'Run'}
          </button>
        </div>

        {graphQuery.isError && <span className="text-xs text-rose-500">Couldn’t compile that — try rephrasing.</span>}
        {nlInterp && <span className="text-xs italic text-slate-500 dark:text-neutral-400">“{nlInterp}”</span>}
        {nlChips.map((c) => (
          <button
            key={c.key}
            onClick={c.clear}
            className="flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 hover:bg-teal-100 dark:bg-teal-500/15 dark:text-teal-300 dark:hover:bg-teal-500/25"
            title="Remove this filter"
          >
            {c.label}
            <X size={11} />
          </button>
        ))}
        {nlFilter && (
          <button onClick={clearNl} className="text-xs text-slate-400 underline hover:text-slate-600 dark:hover:text-neutral-300">
            clear query
          </button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => {
              setConnectMode((v) => {
                const nv = !v;
                if (!nv) clearConnect();
                return nv;
              });
            }}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${
              connectMode ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5'
            }`}
            title="Connection explorer: click two nodes to trace the path between them"
          >
            <Waypoints size={13} /> Connect
          </button>
          <button
            onClick={() => setShowSuggestions((v) => !v)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${
              showSuggestions ? 'border-purple-500 bg-purple-500 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5'
            }`}
            title="Suggested links: AI-proposed connections you can accept or dismiss"
          >
            <Sparkles size={13} /> Suggestions{showSuggestions && suggestions.length ? ` ${suggestions.length}` : ''}
          </button>
          <button
            onClick={() => setShowInsights((v) => !v)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${
              showInsights ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5'
            }`}
            title="Insights: orphans, blind spots, bridges, stale-but-central notes and duplicate suspects"
          >
            <Lightbulb size={13} /> Insights
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {noteCount === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-400 dark:text-neutral-500">
            No notes match this filter.
          </div>
        )}
        <div ref={containerRef} className="h-full w-full" />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />

        <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/90 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
          <button onClick={zoomIn} className="p-2 text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5" title="Zoom in">
            <Plus size={15} />
          </button>
          <button onClick={zoomOut} className="border-t border-slate-200 p-2 text-slate-500 hover:bg-slate-100 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5" title="Zoom out">
            <Minus size={15} />
          </button>
          <button onClick={resetView} className="border-t border-slate-200 p-2 text-slate-500 hover:bg-slate-100 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5" title="Reset view">
            <Maximize2 size={15} />
          </button>
        </div>

        <div className="absolute bottom-3 left-3 rounded-lg border border-slate-200 bg-white/85 px-3 py-2 text-[11px] text-slate-500 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/85 dark:text-neutral-400">
          <div className="mb-1 font-medium text-slate-600 dark:text-neutral-300">Encoding</div>
          <div>Size · {sizeBy === 'pagerank' ? 'PageRank' : 'degree'}</div>
          <div>Color · {colorBy === 'uniform' ? 'uniform' : colorBy}</div>
          <div>Opacity · freshness ({fadeDays}d fade)</div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: palette.taskRing }} /> open tasks
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rotate-45" style={{ backgroundColor: palette.concept }} /> concept
          </div>
        </div>

        <canvas
          ref={minimapRef}
          width={180}
          height={120}
          className="absolute bottom-3 right-3 rounded-lg border border-slate-200 bg-white/80 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80"
        />

        {hoverCard && (
          <div
            className="pointer-events-none absolute z-20 max-w-xs -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
            style={{ left: hoverCard.x, top: hoverCard.y - 12 }}
          >
            <div className="truncate text-sm font-medium text-slate-800 dark:text-neutral-100">{hoverCard.title}</div>
            {hoverCard.kind === 'concept' ? (
              <div className="mt-0.5 text-[11px] text-slate-400 dark:text-neutral-500">
                {hoverCard.conceptType} · {hoverCard.degree} note{hoverCard.degree === 1 ? '' : 's'} · click to manage
              </div>
            ) : (
              <div className="mt-0.5 text-[11px] text-slate-400 dark:text-neutral-500">
                {hoverCard.folder || '(root)'} · {hoverCard.degree} link{hoverCard.degree === 1 ? '' : 's'} · PR {hoverCard.pagerank.toFixed(2)}
                {hoverCard.openTasks > 0 && ` · ${hoverCard.openTasks} open task${hoverCard.openTasks === 1 ? '' : 's'}`}
                {hoverCard.freshnessDays > 0 && ` · ${hoverCard.freshnessDays}d old`}
              </div>
            )}
            {hoverCard.kind === 'note' && hoverCard.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {hoverCard.tags.slice(0, 6).map((t) => (
                  <span key={t} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-white/5 dark:text-neutral-400">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* G6 §6 — Connect mode helper / path narration. */}
        {connectMode && (
          <div className="absolute left-3 top-3 z-20 w-72 rounded-lg border border-slate-200 bg-white/95 p-3 text-xs shadow-lg backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-slate-700 dark:text-neutral-200">
              <Waypoints size={13} /> Connection explorer
            </div>
            {connectSel.length < 2 ? (
              <p className="text-slate-500 dark:text-neutral-400">
                Click {connectSel.length === 0 ? 'two nodes' : 'one more node'} to trace the strongest &amp; shortest path between them.
                {connectSel.length === 1 && <span className="mt-1 block truncate text-slate-400">from “{titleById.get(connectSel[0]) ?? connectSel[0]}”</span>}
              </p>
            ) : graphPath.isPending ? (
              <p className="text-slate-400">Finding paths…</p>
            ) : pathResult && (pathResult.strongest.length || pathResult.shortest.length) ? (
              <div className="space-y-2">
                <p className="text-slate-600 dark:text-neutral-300">{pathResult.narration}</p>
                <div className="flex flex-wrap items-center gap-1">
                  {(pathResult.strongest.length ? pathResult.strongest : pathResult.shortest).map((s, i) => (
                    <span key={s.id} className="flex items-center gap-1">
                      {i > 0 && <span className="text-[10px] text-slate-400">→{s.viaType}→</span>}
                      <button
                        onClick={() => s.kind === 'note' && onNavigate(s.id)}
                        className={`rounded px-1 py-0.5 ${s.kind === 'concept' ? 'text-purple-600 dark:text-purple-300' : 'text-teal-700 hover:underline dark:text-teal-300'}`}
                      >
                        {s.title}
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => openWhy(connectSel[0], connectSel[1])} className="rounded-md border border-slate-300 px-2 py-0.5 text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5">
                    Why related?
                  </button>
                  <button onClick={clearConnect} className="text-slate-400 underline hover:text-slate-600 dark:hover:text-neutral-300">
                    reset
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-slate-500 dark:text-neutral-400">No path connects these two in the current graph.</p>
                <button onClick={() => openWhy(connectSel[0], connectSel[1])} className="rounded-md border border-slate-300 px-2 py-0.5 text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5">
                  Why related?
                </button>
                <button onClick={clearConnect} className="ml-2 text-slate-400 underline hover:text-slate-600">reset</button>
              </div>
            )}
          </div>
        )}

        {/* G6 §7 — Suggested edges panel. */}
        {showSuggestions && (
          <div className="absolute bottom-3 left-3 z-20 max-h-[45vh] w-80 overflow-auto rounded-lg border border-slate-200 bg-white/95 p-3 text-xs shadow-lg backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
            <div className="mb-2 flex items-center gap-1.5 font-medium text-purple-700 dark:text-purple-300">
              <Sparkles size={13} /> Suggested links
            </div>
            {suggestionsQuery.isLoading ? (
              <p className="text-slate-400">Scanning for connections…</p>
            ) : suggestions.length === 0 ? (
              <p className="text-slate-500 dark:text-neutral-400">No new suggestions — nothing above the similarity threshold that isn’t already linked or dismissed.</p>
            ) : (
              <ul className="space-y-1.5">
                {suggestions.map((s) => (
                  <li key={`${s.source}|${s.target}`} className="rounded-md border border-slate-200 p-1.5 dark:border-neutral-800">
                    <div className="flex items-center justify-between gap-1">
                      <button onClick={() => openWhy(s.source, s.target)} className="min-w-0 flex-1 text-left" title="Why related?">
                        <span className="block truncate text-slate-700 dark:text-neutral-200">{s.sourceTitle}</span>
                        <span className="block truncate text-slate-400">↔ {s.targetTitle}</span>
                      </button>
                      <span className="shrink-0 text-[10px] text-purple-500">{Math.round(s.confidence * 100)}%</span>
                    </div>
                    <div className="mt-1 flex gap-1">
                      <button
                        onClick={() => acceptSug.mutate({ source: s.source, target: s.target })}
                        disabled={acceptSug.isPending}
                        className="flex items-center gap-1 rounded bg-teal-600 px-1.5 py-0.5 text-white disabled:opacity-40"
                        title="Insert a [[wikilink]] in the source note"
                      >
                        <Check size={11} /> Accept
                      </button>
                      <button
                        onClick={() => dismissSug.mutate({ source: s.source, target: s.target })}
                        disabled={dismissSug.isPending}
                        className="flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-white/5"
                      >
                        <Trash2 size={11} /> Dismiss
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* G6 §8 — Insights drawer. */}
        {showInsights && (
          <div className="absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 text-xs shadow-lg backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-neutral-800">
              <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-300">
                <Lightbulb size={13} /> Insights
              </span>
              <button onClick={() => setShowInsights(false)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5" title="Close">
                <X size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
              {insightsQuery.isLoading || !insights ? (
                <p className="text-slate-400">Analysing the graph…</p>
              ) : insights.orphans.length + insights.blindSpots.length + insights.bridges.length + insights.staleCentral.length + insights.duplicates.length === 0 ? (
                <p className="text-slate-500 dark:text-neutral-400">
                  Nothing to flag right now — no orphans, blind spots, bridges, stale-but-central notes or duplicates.
                  {!insights.embeddingsReady && ' Build the embedding index (Settings) to unlock orphan links and duplicate detection.'}
                </p>
              ) : (
                <>
                  {/* Orphans → link to a semantic neighbour. */}
                  {insights.orphans.length > 0 && (
                    <section>
                      <div className="mb-1.5 flex items-center gap-1.5 font-medium text-slate-700 dark:text-neutral-200">
                        <Link2 size={12} /> Orphans <span className="text-slate-400">· {insights.orphans.length}</span>
                      </div>
                      <p className="mb-1.5 text-[11px] text-slate-400">Unlinked notes — link them to a related note.</p>
                      <ul className="space-y-1.5">
                        {insights.orphans.map((o) => (
                          <li key={o.id} className="rounded-md border border-slate-200 p-1.5 dark:border-neutral-800">
                            <button onClick={() => onNavigate(o.id)} dir="auto" className="block w-full truncate text-left text-slate-700 hover:underline dark:text-neutral-200" title={o.title}>
                              {o.title}
                            </button>
                            {o.neighbors.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {o.neighbors.map((n) => (
                                  <button
                                    key={n.id}
                                    onClick={() => acceptSug.mutate({ source: o.id, target: n.id })}
                                    disabled={acceptSug.isPending}
                                    className="flex max-w-full items-center gap-1 rounded bg-teal-600 px-1.5 py-0.5 text-white disabled:opacity-40"
                                    title={`Insert [[${n.title}]] · ${Math.round(n.score * 100)}% similar`}
                                  >
                                    <Link2 size={10} /> <span className="truncate">{n.title}</span>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-0.5 text-[11px] text-slate-400">{insights.embeddingsReady ? 'no strong match to link' : 'embed notes to find links'}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {/* Blind spots → create a note for the concept. */}
                  {insights.blindSpots.length > 0 && (
                    <section>
                      <div className="mb-1.5 flex items-center gap-1.5 font-medium text-slate-700 dark:text-neutral-200">
                        <FilePlus2 size={12} /> Blind spots <span className="text-slate-400">· {insights.blindSpots.length}</span>
                      </div>
                      <p className="mb-1.5 text-[11px] text-slate-400">Concepts you mention a lot but have no note for.</p>
                      <ul className="space-y-1.5">
                        {insights.blindSpots.map((b) => (
                          <li key={b.conceptId} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 p-1.5 dark:border-neutral-800">
                            <span className="min-w-0">
                              <span dir="auto" className="block truncate text-slate-700 dark:text-neutral-200">{b.name}</span>
                              <span className="text-[10px] text-slate-400">{b.type} · {b.noteCount} notes</span>
                            </span>
                            <button
                              onClick={() => createNoteForConcept(b.name)}
                              disabled={createNote.isPending}
                              className="flex shrink-0 items-center gap-1 rounded bg-teal-600 px-1.5 py-0.5 text-white disabled:opacity-40"
                              title="Create a note for this concept"
                            >
                              <FilePlus2 size={10} /> Create
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {/* Bridges → open the cross-domain note. */}
                  {insights.bridges.length > 0 && (
                    <section>
                      <div className="mb-1.5 flex items-center gap-1.5 font-medium text-slate-700 dark:text-neutral-200">
                        <Waypoints size={12} /> Bridges <span className="text-slate-400">· {insights.bridges.length}</span>
                      </div>
                      <p className="mb-1.5 text-[11px] text-slate-400">Notes connecting separate communities — your cross-domain ideas.</p>
                      <ul className="space-y-1.5">
                        {insights.bridges.map((b) => (
                          <li key={b.id} className="rounded-md border border-slate-200 p-1.5 dark:border-neutral-800">
                            <button onClick={() => onNavigate(b.id)} dir="auto" className="block w-full truncate text-left text-slate-700 hover:underline dark:text-neutral-200" title={b.title}>
                              {b.title}
                            </button>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                              {b.communities.map((c) => (
                                <span key={c} className="rounded-full bg-slate-100 px-1.5 py-0.5 dark:bg-white/5 dark:text-neutral-400">{c}</span>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {/* Stale but central → open to review. */}
                  {insights.staleCentral.length > 0 && (
                    <section>
                      <div className="mb-1.5 flex items-center gap-1.5 font-medium text-slate-700 dark:text-neutral-200">
                        <Maximize2 size={12} /> Stale but central <span className="text-slate-400">· {insights.staleCentral.length}</span>
                      </div>
                      <p className="mb-1.5 text-[11px] text-slate-400">Important notes untouched for {insights.staleDays}+ days — worth revisiting.</p>
                      <ul className="space-y-1.5">
                        {insights.staleCentral.map((s) => (
                          <li key={s.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 p-1.5 dark:border-neutral-800">
                            <button onClick={() => onNavigate(s.id)} dir="auto" className="min-w-0 flex-1 truncate text-left text-slate-700 hover:underline dark:text-neutral-200" title={s.title}>
                              {s.title}
                            </button>
                            <span className="shrink-0 text-[10px] text-slate-400">{s.freshnessDays}d · PR {s.pagerank.toFixed(2)}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {/* Duplicate suspects → why-related evidence + open. */}
                  {insights.duplicates.length > 0 && (
                    <section>
                      <div className="mb-1.5 flex items-center gap-1.5 font-medium text-slate-700 dark:text-neutral-200">
                        <Sparkles size={12} /> Duplicate suspects <span className="text-slate-400">· {insights.duplicates.length}</span>
                      </div>
                      <p className="mb-1.5 text-[11px] text-slate-400">Near-identical notes — review and merge if they overlap.</p>
                      <ul className="space-y-1.5">
                        {insights.duplicates.map((d) => (
                          <li key={`${d.source}|${d.target}`} className="rounded-md border border-slate-200 p-1.5 dark:border-neutral-800">
                            <div className="flex items-center justify-between gap-1">
                              <button onClick={() => openWhy(d.source, d.target)} className="min-w-0 flex-1 text-left" title="Why related?">
                                <span dir="auto" className="block truncate text-slate-700 dark:text-neutral-200">{d.sourceTitle}</span>
                                <span dir="auto" className="block truncate text-slate-400">↔ {d.targetTitle}</span>
                              </button>
                              <span className="shrink-0 text-[10px] text-amber-500">{Math.round(d.similarity * 100)}%</span>
                            </div>
                            <div className="mt-1 flex gap-1">
                              <button onClick={() => onNavigate(d.source)} className="rounded border border-slate-300 px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 dark:border-neutral-700 dark:hover:bg-white/5">Open</button>
                              <button onClick={() => openWhy(d.source, d.target)} className="rounded border border-slate-300 px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 dark:border-neutral-700 dark:hover:bg-white/5">Compare</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* G6 §6 — "Why related?" evidence (side-by-side passages). */}
        {evidence && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-6" onClick={() => setEvidence(null)}>
            <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-neutral-800 dark:bg-neutral-950" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="text-sm font-semibold text-slate-800 dark:text-neutral-100">
                  Why related?
                  <span className="mt-0.5 block text-xs font-normal text-slate-500 dark:text-neutral-400">
                    {evidence.sourceTitle} ↔ {evidence.targetTitle}
                  </span>
                </div>
                <button onClick={() => setEvidence(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5">
                  <X size={16} />
                </button>
              </div>
              {!evidence.why ? (
                <p className="text-sm text-slate-400">Looking for the connection…</p>
              ) : (
                <div className="space-y-3">
                  {evidence.why.shared.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {evidence.why.shared.map((sh) => (
                        <span key={sh} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-white/5 dark:text-neutral-300">
                          {sh}
                        </span>
                      ))}
                    </div>
                  )}
                  {evidence.why.sourcePassage && evidence.why.targetPassage ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div dir="auto" className="rounded-lg border border-slate-200 p-2 text-xs text-slate-600 dark:border-neutral-800 dark:text-neutral-300">
                        <div className="mb-1 truncate font-medium text-slate-500 dark:text-neutral-400">{evidence.sourceTitle}</div>
                        {evidence.why.sourcePassage}
                      </div>
                      <div dir="auto" className="rounded-lg border border-slate-200 p-2 text-xs text-slate-600 dark:border-neutral-800 dark:text-neutral-300">
                        <div className="mb-1 truncate font-medium text-slate-500 dark:text-neutral-400">{evidence.targetTitle}</div>
                        {evidence.why.targetPassage}
                      </div>
                    </div>
                  ) : evidence.why.shared.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-neutral-400">These notes have no direct overlap — embed them (AI on) to see semantic passages.</p>
                  ) : null}
                  {evidence.why.score != null && (
                    <div className="text-[11px] text-slate-400">semantic similarity {Math.round(evidence.why.score * 100)}%</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {inspector && <ConceptInspector target={inspector} onClose={() => setInspector(null)} />}
      </div>
    </div>
  );
}
