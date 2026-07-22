import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CalendarDays,
  Clock3,
  FileText,
  FolderOpen,
  Gauge,
  LoaderCircle,
  Mic,
  RotateCcw,
  Sparkles,
  Square,
  Tag,
  X,
} from 'lucide-react';
import {
  buildVoiceNotePath,
  type NoteSummaryDTO,
  type TaskDifficulty,
  type VoiceInterpretationDTO,
} from '@timeblock/shared';
import { api } from '../api.js';
import { useCreateTask, useLabels, useProjects, useSettings } from '../hooks.js';
import { useCreateNote } from '../hooks/notes.js';
import { startBrowserSpeech, startWavRecording, type WavRecording } from '../lib/voiceRecorder.js';

type Stage = 'idle' | 'requesting' | 'recording' | 'processing' | 'review' | 'error';
type DraftMode = 'task' | 'note' | null;

interface TaskForm {
  content: string;
  description: string;
  projectId: string;
  priority: string;
  dueDate: string;
  dueTime: string;
  durationMin: string;
  difficulty: '' | TaskDifficulty;
  labels: string;
}

const EMPTY_TASK: TaskForm = {
  content: '',
  description: '',
  projectId: '',
  priority: '',
  dueDate: '',
  dueTime: '',
  durationMin: '',
  difficulty: '',
  labels: '',
};

const MAX_RECORDING_SECONDS = 60;

function elapsedLabel(seconds: number): string {
  return `0:${String(seconds).padStart(2, '0')}`;
}

function splitLabels(value: string): string[] {
  return [...new Set(value.split(',').map((label) => label.trim()).filter(Boolean))];
}

export default function VoiceCapture({ gameMode }: { gameMode: boolean }) {
  const { data: settings } = useSettings();
  const { data: projects = [] } = useProjects();
  const { data: labels = [] } = useLabels();
  const createTask = useCreateTask();
  const createNote = useCreateNote();

  const [stage, setStage] = useState<Stage>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(Array(14).fill(0.08));
  const [browserTranscript, setBrowserTranscript] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<VoiceInterpretationDTO | null>(null);
  const [mode, setMode] = useState<DraftMode>(null);
  const [taskForm, setTaskForm] = useState<TaskForm>(EMPTY_TASK);
  const [noteForm, setNoteForm] = useState({ title: '', body: '' });
  const [saveError, setSaveError] = useState('');

  const recordingRef = useRef<WavRecording | null>(null);
  const speechRef = useRef<ReturnType<typeof startBrowserSpeech>>(null);
  const browserTranscriptRef = useRef('');
  const lastAudioRef = useRef<Blob | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const limitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRecordingRef = useRef<() => void>(() => {});

  const clearTimers = () => {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    if (levelTimerRef.current) clearInterval(levelTimerRef.current);
    if (limitTimerRef.current) clearTimeout(limitTimerRef.current);
    elapsedTimerRef.current = null;
    levelTimerRef.current = null;
    limitTimerRef.current = null;
  };

  useEffect(
    () => () => {
      clearTimers();
      speechRef.current?.abort();
      void recordingRef.current?.cancel();
    },
    [],
  );

  useEffect(() => {
    if (stage !== 'review' && stage !== 'error') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeVoiceFlow();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stage]);

  const hydrateDraft = (next: VoiceInterpretationDTO) => {
    const zone = settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    let dueTime = '';
    if (next.task?.dueDatetimeUtc) dueTime = DateTime.fromISO(next.task.dueDatetimeUtc).setZone(zone).toFormat('HH:mm');
    setTaskForm(
      next.task
        ? {
            content: next.task.content,
            description: next.task.description,
            projectId: next.task.projectId ?? '',
            priority: next.task.priority ? String(next.task.priority) : '',
            dueDate: next.task.dueDate ?? '',
            dueTime,
            durationMin: next.task.durationMin ? String(next.task.durationMin) : '',
            difficulty: next.task.difficulty ?? '',
            labels: next.task.labels.join(', '),
          }
        : { ...EMPTY_TASK, content: next.transcript },
    );
    setNoteForm(
      next.note
        ? { title: next.note.title, body: next.note.body }
        : { title: next.transcript.slice(0, 72).replace(/[.!?،؟]+$/, ''), body: next.transcript },
    );
    setMode(next.intent === 'task' || next.intent === 'note' ? next.intent : null);
  };

  const interpretAudio = async (audio: Blob) => {
    setStage('processing');
    setError('');
    setSaveError('');
    lastAudioRef.current = audio;
    try {
      const file = new File([audio], 'timeblock-voice.wav', { type: 'audio/wav' });
      const next = await api.interpretVoice<VoiceInterpretationDTO>(file, browserTranscriptRef.current);
      setDraft(next);
      hydrateDraft(next);
      setStage('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The recording could not be interpreted.');
      setStage('error');
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;
    clearTimers();
    speechRef.current?.stop();
    speechRef.current = null;
    const active = recordingRef.current;
    recordingRef.current = null;
    try {
      const audio = await active.stop();
      if (audio.size <= 44) throw new Error('No audio was captured. Check your microphone and try again.');
      await interpretAudio(audio);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The recording could not be completed.');
      setStage('error');
    }
  };
  stopRecordingRef.current = () => void stopRecording();

  const startRecording = async () => {
    if (settings && !settings.aiEnabled) {
      setError('Voice capture needs AI features enabled in Settings.');
      setStage('error');
      return;
    }
    setStage('requesting');
    setError('');
    setDraft(null);
    setElapsed(0);
    setLevels(Array(14).fill(0.08));
    setBrowserTranscript('');
    browserTranscriptRef.current = '';
    lastAudioRef.current = null;
    try {
      const recording = await startWavRecording();
      recordingRef.current = recording;
      speechRef.current = startBrowserSpeech((text) => {
        browserTranscriptRef.current = text;
        setBrowserTranscript(text);
      });
      setStage('recording');
      const startedAt = Date.now();
      elapsedTimerRef.current = setInterval(() => setElapsed(Math.min(MAX_RECORDING_SECONDS, Math.floor((Date.now() - startedAt) / 1000))), 250);
      levelTimerRef.current = setInterval(() => {
        const level = recordingRef.current?.level() ?? 0;
        setLevels((current) => [...current.slice(1), Math.max(0.08, level)]);
      }, 110);
      limitTimerRef.current = setTimeout(() => stopRecordingRef.current(), MAX_RECORDING_SECONDS * 1000);
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      setError(denied ? 'Microphone access was denied. Allow microphone access for TimeBlock, then try again.' : err instanceof Error ? err.message : 'The microphone could not be opened.');
      setStage('error');
    }
  };

  function closeVoiceFlow() {
    clearTimers();
    speechRef.current?.abort();
    speechRef.current = null;
    void recordingRef.current?.cancel();
    recordingRef.current = null;
    lastAudioRef.current = null;
    browserTranscriptRef.current = '';
    setBrowserTranscript('');
    setDraft(null);
    setMode(null);
    setError('');
    setSaveError('');
    setStage('idle');
  }

  const saveDraft = async () => {
    setSaveError('');
    try {
      if (mode === 'task') {
        const content = taskForm.content.trim();
        if (!content) throw new Error('Add a task title before saving.');
        let dueDatetimeUtc: string | null = null;
        if (taskForm.dueTime && !taskForm.dueDate) throw new Error('Choose a due date for the due time.');
        if (taskForm.dueDate && taskForm.dueTime) {
          const zone = settings?.timezone || 'UTC';
          const localDue = DateTime.fromISO(`${taskForm.dueDate}T${taskForm.dueTime}`, { zone });
          if (!localDue.isValid) throw new Error('The due date or time is invalid.');
          dueDatetimeUtc = localDue.toUTC().toISO({ suppressMilliseconds: true });
        }
        await createTask.mutateAsync({
          content,
          description: taskForm.description.trim() || undefined,
          projectId: taskForm.projectId || null,
          priority: taskForm.priority ? Number(taskForm.priority) : undefined,
          dueDate: taskForm.dueDate || null,
          dueDatetimeUtc,
          durationMin: taskForm.durationMin ? Number(taskForm.durationMin) : null,
          difficulty: taskForm.difficulty || null,
          labels: splitLabels(taskForm.labels),
          status: 'todo',
        });
      } else if (mode === 'note') {
        const title = noteForm.title.trim();
        const body = noteForm.body.trim();
        if (!title || !body) throw new Error('Add a note title and body before saving.');
        const existing = await api.get<NoteSummaryDTO[]>('/notes/tree');
        const zone = settings?.timezone || 'UTC';
        const timestamp = DateTime.now().setZone(zone).toFormat('yyyy-LL-dd-HHmmss');
        const path = buildVoiceNotePath(timestamp, title, existing.map((item) => item.id));
        await createNote.mutateAsync({ path, content: `# ${title}\n\n${body}\n` });
      } else {
        throw new Error('Choose Task or Note before saving.');
      }
      closeVoiceFlow();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'The draft could not be saved.');
    }
  };

  const isSaving = createTask.isPending || createNote.isPending;
  const buttonLabel = stage === 'recording' ? 'Stop recording' : stage === 'processing' ? 'Processing voice' : stage === 'requesting' ? 'Opening microphone' : 'Create with voice';

  const statusPortal =
    stage === 'recording' || stage === 'requesting' || stage === 'processing'
      ? createPortal(
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, y: -12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              className="fixed right-5 top-[4.75rem] z-[80] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-2xl shadow-slate-900/15 backdrop-blur-xl dark:border-neutral-700 dark:bg-neutral-900/95"
              role="status"
              aria-live="polite"
            >
              <div className="h-1 bg-gradient-to-r from-teal-400 via-cyan-400 to-rose-400" />
              <div className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={`grid h-9 w-9 place-items-center rounded-full ${stage === 'recording' ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'}`}>
                      {stage === 'recording' ? <Mic size={17} /> : <LoaderCircle size={17} className="animate-spin" />}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                        {stage === 'recording' ? 'Listening' : stage === 'requesting' ? 'Opening your microphone' : 'Understanding your words'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-neutral-400">
                        {stage === 'recording' ? 'Arabic, English, or both' : 'Gemini is preparing an editable draft'}
                      </p>
                    </div>
                  </div>
                  {stage === 'recording' && <span className="font-mono text-xs font-semibold text-rose-600 dark:text-rose-300">{elapsedLabel(elapsed)} / 1:00</span>}
                </div>
                {stage === 'recording' && (
                  <>
                    <div className="mt-4 flex h-9 items-center justify-center gap-1 rounded-xl bg-slate-50 px-3 dark:bg-neutral-800/80" aria-hidden="true">
                      {levels.map((level, index) => (
                        <motion.span
                          key={index}
                          animate={{ height: `${Math.max(12, level * 100)}%` }}
                          transition={{ duration: 0.1 }}
                          className="w-1 rounded-full bg-gradient-to-t from-teal-500 to-cyan-300"
                        />
                      ))}
                    </div>
                    <p dir="auto" className="mt-3 min-h-5 line-clamp-2 text-sm text-slate-600 dark:text-neutral-300">
                      {browserTranscript || 'Speak naturally — say “add a task…” or “make a note…”'}
                    </p>
                  </>
                )}
              </div>
            </motion.div>
          </AnimatePresence>,
          document.body,
        )
      : null;

  const errorPortal =
    stage === 'error'
      ? createPortal(
          <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/35 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="voice-error-title">
            <motion.div initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-5 shadow-2xl dark:border-rose-500/30 dark:bg-neutral-900">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"><AlertTriangle size={20} /></span>
                <div className="min-w-0 flex-1">
                  <h2 id="voice-error-title" className="font-semibold text-slate-900 dark:text-neutral-100">Voice capture needs attention</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-neutral-400">{error}</p>
                  {browserTranscript && <p dir="auto" className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">{browserTranscript}</p>}
                </div>
                <button type="button" onClick={closeVoiceFlow} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-800"><X size={17} /></button>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={closeVoiceFlow} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800">Cancel</button>
                {lastAudioRef.current ? (
                  <button type="button" onClick={() => void interpretAudio(lastAudioRef.current!)} className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500"><RotateCcw size={15} /> Retry interpretation</button>
                ) : (
                  <button type="button" onClick={() => void startRecording()} className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500"><Mic size={15} /> Try again</button>
                )}
              </div>
            </motion.div>
          </div>,
          document.body,
        )
      : null;

  const reviewPortal =
    stage === 'review' && draft
      ? createPortal(
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="voice-review-title">
            <motion.div initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white shadow-2xl shadow-slate-950/25 dark:border-neutral-700 dark:bg-neutral-900">
              <div className="relative overflow-hidden border-b border-slate-200 px-5 py-4 dark:border-neutral-800 sm:px-6">
                <div className="pointer-events-none absolute -right-12 -top-20 h-40 w-40 rounded-full bg-teal-300/20 blur-3xl" />
                <div className="relative flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 text-white shadow-lg shadow-teal-500/20"><Sparkles size={19} /></span>
                    <div>
                      <h2 id="voice-review-title" className="font-semibold text-slate-950 dark:text-white">Review voice capture</h2>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">Detected {draft.language} · nothing is saved until you approve it</p>
                    </div>
                  </div>
                  <button type="button" onClick={closeVoiceFlow} aria-label="Close review" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"><X size={18} /></button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-neutral-800 dark:bg-neutral-950/50">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-neutral-500">Transcript</p>
                  <p dir="auto" className="text-sm leading-6 text-slate-700 dark:text-neutral-300">{draft.transcript}</p>
                </div>

                {draft.warnings.length > 0 && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                    {draft.warnings.map((warning) => <p key={warning}>• {warning}</p>)}
                  </div>
                )}

                <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-neutral-800" role="tablist" aria-label="Save as">
                  <button type="button" role="tab" aria-selected={mode === 'task'} onClick={() => setMode('task')} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${mode === 'task' ? 'bg-white text-teal-700 shadow-sm dark:bg-neutral-700 dark:text-teal-300' : 'text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-200'}`}><CalendarDays size={16} /> Task</button>
                  <button type="button" role="tab" aria-selected={mode === 'note'} onClick={() => setMode('note')} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${mode === 'note' ? 'bg-white text-teal-700 shadow-sm dark:bg-neutral-700 dark:text-teal-300' : 'text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-200'}`}><FileText size={16} /> Note</button>
                </div>

                {!mode && <p className="mt-4 rounded-xl border border-dashed border-teal-300 bg-teal-50/60 p-4 text-center text-sm text-teal-800 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-teal-200">Choose whether this recording should become a task or a note.</p>}

                {mode === 'task' && (
                  <div className="mt-5 space-y-4" role="tabpanel">
                    <label className="block text-xs font-semibold text-slate-500 dark:text-neutral-400">Task title
                      <input autoFocus dir="auto" value={taskForm.content} onChange={(event) => setTaskForm({ ...taskForm, content: event.target.value })} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-500/10 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
                    </label>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-neutral-400">Description
                      <textarea dir="auto" rows={3} value={taskForm.description} onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })} className="mt-1.5 block w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-500/10 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs font-semibold text-slate-500 dark:text-neutral-400"><span className="flex items-center gap-1.5"><FolderOpen size={13} /> Project</span>
                        <select value={taskForm.projectId} onChange={(event) => setTaskForm({ ...taskForm, projectId: event.target.value })} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-teal-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"><option value="">Inbox</option>{projects.filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
                      </label>
                      <label className="text-xs font-semibold text-slate-500 dark:text-neutral-400"><span className="flex items-center gap-1.5"><Tag size={13} /> Labels</span>
                        <input list="voice-labels" value={taskForm.labels} onChange={(event) => setTaskForm({ ...taskForm, labels: event.target.value })} placeholder="work, errands" className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-teal-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" /><datalist id="voice-labels">{labels.map((label) => <option key={label.id} value={label.name} />)}</datalist>
                      </label>
                      <label className="text-xs font-semibold text-slate-500 dark:text-neutral-400"><span className="flex items-center gap-1.5"><CalendarDays size={13} /> Due date</span>
                        <input type="date" value={taskForm.dueDate} onChange={(event) => setTaskForm({ ...taskForm, dueDate: event.target.value, dueTime: event.target.value ? taskForm.dueTime : '' })} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
                      </label>
                      <label className="text-xs font-semibold text-slate-500 dark:text-neutral-400"><span className="flex items-center gap-1.5"><Clock3 size={13} /> Due time</span>
                        <input type="time" disabled={!taskForm.dueDate} value={taskForm.dueTime} onChange={(event) => setTaskForm({ ...taskForm, dueTime: event.target.value })} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-400 disabled:opacity-45 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
                      </label>
                      <label className="text-xs font-semibold text-slate-500 dark:text-neutral-400"><span className="flex items-center gap-1.5"><Clock3 size={13} /> Duration (minutes)</span>
                        <input type="number" min={5} max={480} step={5} value={taskForm.durationMin} onChange={(event) => setTaskForm({ ...taskForm, durationMin: event.target.value })} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-teal-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs font-semibold text-slate-500 dark:text-neutral-400">Priority
                          <select value={taskForm.priority} onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value })} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-sm text-slate-800 outline-none focus:border-teal-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"><option value="">Default</option><option value="4">Urgent</option><option value="3">High</option><option value="2">Medium</option><option value="1">Low</option></select>
                        </label>
                        <label className="text-xs font-semibold text-slate-500 dark:text-neutral-400"><span className="flex items-center gap-1"><Gauge size={12} /> Difficulty</span>
                          <select value={taskForm.difficulty} onChange={(event) => setTaskForm({ ...taskForm, difficulty: event.target.value as TaskForm['difficulty'] })} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-sm text-slate-800 outline-none focus:border-teal-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"><option value="">Unset</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {mode === 'note' && (
                  <div className="mt-5 space-y-4" role="tabpanel">
                    <label className="block text-xs font-semibold text-slate-500 dark:text-neutral-400">Note title
                      <input autoFocus dir="auto" value={noteForm.title} onChange={(event) => setNoteForm({ ...noteForm, title: event.target.value })} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-500/10 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
                    </label>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-neutral-400">Cleaned Markdown
                      <textarea dir="auto" rows={10} value={noteForm.body} onChange={(event) => setNoteForm({ ...noteForm, body: event.target.value })} className="mt-1.5 block w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 font-mono text-sm leading-6 text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-500/10 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
                    </label>
                    <p className="text-xs text-slate-400 dark:text-neutral-500">Saved as a new Markdown file inside Voice Notes.</p>
                  </div>
                )}

                {saveError && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">{saveError}</p>}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950/40 sm:px-6">
                <button type="button" onClick={closeVoiceFlow} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-200/70 dark:text-neutral-400 dark:hover:bg-neutral-800">Discard</button>
                <button type="button" onClick={() => void saveDraft()} disabled={!mode || isSaving} className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-600/15 transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-45">
                  {isSaving ? <LoaderCircle size={16} className="animate-spin" /> : mode === 'task' ? <CalendarDays size={16} /> : <FileText size={16} />}
                  {isSaving ? 'Saving…' : mode === 'task' ? 'Create task' : mode === 'note' ? 'Save note' : 'Choose a type'}
                </button>
              </div>
            </motion.div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        onClick={() => (stage === 'recording' ? void stopRecording() : stage === 'idle' ? void startRecording() : undefined)}
        disabled={stage === 'requesting' || stage === 'processing' || stage === 'review' || stage === 'error'}
        aria-label={buttonLabel}
        title={buttonLabel}
        className={`relative grid h-8 w-8 place-items-center rounded-lg border transition-all ${
          stage === 'recording'
            ? 'border-rose-400 bg-rose-500 text-white shadow-md shadow-rose-500/25'
            : gameMode
              ? 'border-white/10 bg-white/5 text-slate-300 hover:border-teal-400/40 hover:bg-teal-400/10 hover:text-teal-300'
              : 'border-slate-200 bg-white text-slate-500 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-teal-500/40 dark:hover:bg-teal-500/10 dark:hover:text-teal-300'
        } disabled:cursor-default disabled:opacity-70`}
      >
        {stage === 'recording' ? <Square size={13} fill="currentColor" /> : stage === 'processing' || stage === 'requesting' ? <LoaderCircle size={16} className="animate-spin" /> : <Mic size={16} />}
        {stage === 'recording' && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-ping rounded-full bg-rose-400" aria-hidden="true" />}
      </motion.button>
      {statusPortal}
      {errorPortal}
      {reviewPortal}
    </>
  );
}
