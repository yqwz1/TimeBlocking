import type { LucideIcon } from 'lucide-react';
import { BookOpen, Briefcase, Camera, Code, Coffee, Dumbbell, FileText, Folder, GraduationCap, Heart, Home, Lightbulb, Music, Palette, Plane, Rocket, ShoppingCart, Sparkles, Star, Target, Users, Zap } from 'lucide-react';

export const NOTE_COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#0ea5e9', '#6366f1', '#0d9488', '#ec4899', '#64748b'];

export const NOTE_ICONS: Record<string, LucideIcon> = {
  folder: Folder, briefcase: Briefcase, rocket: Rocket, home: Home, heart: Heart, star: Star, target: Target, zap: Zap,
  code: Code, dumbbell: Dumbbell, plane: Plane, 'shopping-cart': ShoppingCart, music: Music, camera: Camera, coffee: Coffee,
  palette: Palette, 'graduation-cap': GraduationCap, users: Users, sparkles: Sparkles, book: BookOpen, idea: Lightbulb,
};

export function NoteIcon({ icon, color, fallback: Fallback = FileText, size = 14 }: { icon: string | null; color: string | null; fallback?: LucideIcon; size?: number }) {
  const Icon = (icon && NOTE_ICONS[icon]) || Fallback;
  return <Icon size={size} className="shrink-0" style={color ? { color } : undefined} />;
}

export function NoteAppearancePicker({ color, icon, onChange, disabled = false }: { color: string | null; icon: string | null; onChange: (next: { color: string | null; icon: string | null }) => void; disabled?: boolean }) {
  return <div className="space-y-3 p-3" aria-label="Note appearance">
    <div>
      <p className="mb-1.5 text-[11px] font-semibold text-slate-500 dark:text-neutral-400">Note color</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onChange({ color: null, icon })} disabled={disabled} aria-pressed={!color} title="Use the default color" className={`flex h-7 w-7 items-center justify-center rounded-full border border-dashed text-xs text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-700 dark:hover:text-white ${!color ? 'border-slate-800 bg-slate-100 text-slate-700 dark:border-white dark:bg-white/10 dark:text-white' : 'border-slate-300 dark:border-neutral-700'}`}>×</button>
        {NOTE_COLORS.map((swatch) => <button key={swatch} type="button" onClick={() => onChange({ color: swatch, icon })} disabled={disabled} aria-label={`Use ${swatch} for this note`} aria-pressed={color === swatch} className={`h-7 w-7 rounded-full ring-offset-2 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-wait ${color === swatch ? 'ring-2 ring-slate-900 dark:ring-white dark:ring-offset-neutral-900' : ''}`} style={{ backgroundColor: swatch }} />)}
      </div>
    </div>
    <div>
      <p className="mb-1.5 text-[11px] font-semibold text-slate-500 dark:text-neutral-400">Note icon</p>
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={() => onChange({ color, icon: null })} disabled={disabled} aria-pressed={!icon} title="Use the default note icon" className={`flex h-8 w-8 items-center justify-center rounded-md border border-dashed text-xs text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-700 dark:hover:text-white ${!icon ? 'border-slate-800 bg-slate-100 text-slate-700 dark:border-white dark:bg-white/10 dark:text-white' : 'border-slate-300 dark:border-neutral-700'}`}>×</button>
        {Object.entries(NOTE_ICONS).map(([name, Icon]) => <button key={name} type="button" onClick={() => onChange({ color, icon: name })} disabled={disabled} title={name.replace(/-/g, ' ')} aria-label={`Use ${name.replace(/-/g, ' ')} icon`} aria-pressed={icon === name} className={`flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-neutral-400 dark:hover:bg-white/10 ${icon === name ? 'bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-white' : ''}`} style={icon === name && color ? { color } : undefined}><Icon size={15} /></button>)}
      </div>
    </div>
  </div>;
}
