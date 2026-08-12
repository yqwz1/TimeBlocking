import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Archive,
  Beef,
  CalendarClock,
  Check,
  ChevronRight,
  CircleGauge,
  CookingPot,
  Edit3,
  Flame,
  ExternalLink,
  History,
  MapPin,
  PackageOpen,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Store,
  Sparkles,
  Tags,
  Trash2,
  Wheat,
  X,
} from 'lucide-react';
import type {
  KitchenFoodDTO,
  KitchenFoodInput,
  KitchenStockAdjustmentReason,
  KitchenStockPortionDTO,
} from '@timeblock/shared';
import {
  useAddKitchenStock,
  useAddKitchenPlanLine,
  useAdjustKitchenStock,
  useArchiveKitchenFood,
  useCancelKitchenPlan,
  useConsumeKitchenPlanLine,
  useCreateKitchenFood,
  useGenerateKitchenPlan,
  useKitchenDashboard,
  useKitchenDeals,
  useRefreshKitchenDeals,
  useRemoveKitchenPlanLine,
  useSaveKitchenSettings,
  useUndoKitchenPlanLine,
  useUndoKitchenMovement,
  useUpdateKitchenFood,
} from '../hooks/kitchen.js';

const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100';
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-teal-500/60 disabled:cursor-not-allowed disabled:opacity-50';
const card = 'rounded-xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900';
const label = 'mb-1.5 block text-[11px] font-semibold text-slate-500 dark:text-neutral-400';

type KitchenView = 'today' | 'inventory' | 'deals' | 'activity';

function format(value: number, digits = 1) {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function preparationLabel(value: KitchenFoodDTO['preparationState']) {
  return value === 'as_packaged' ? 'as packaged' : value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong';
}

function Modal({ title, description, children, onClose, wide = false }: { title: string; description?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}
    >
      <motion.section
        initial={{ y: 14, scale: 0.985 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 8, scale: 0.985 }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.01em] text-slate-950 dark:text-neutral-50">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200" aria-label="Close">
            <X size={17} />
          </button>
        </header>
        {children}
      </motion.section>
    </motion.div>
  );
}

type FoodDraft = {
  name: string;
  category: string;
  unit: KitchenFoodDTO['unit'];
  preparationState: KitchenFoodDTO['preparationState'];
  nutritionBasisAmount: string;
  proteinPerBasis: string;
  caloriesPerBasis: string;
  carbsPerBasis: string;
  fatPerBasis: string;
  portionMode: KitchenFoodDTO['portionMode'];
  planningIncrement: string;
  dailyMaxQuantity: string;
  dailyMaxPortions: string;
  lowStockThreshold: string;
  plannerEligible: boolean;
};

const emptyFood: FoodDraft = {
  name: '', category: 'Protein', unit: 'g', preparationState: 'as_packaged', nutritionBasisAmount: '100',
  proteinPerBasis: '', caloriesPerBasis: '', carbsPerBasis: '', fatPerBasis: '', portionMode: 'whole',
  planningIncrement: '', dailyMaxQuantity: '', dailyMaxPortions: '', lowStockThreshold: '', plannerEligible: true,
};

function draftFromFood(food: KitchenFoodDTO): FoodDraft {
  return {
    name: food.name,
    category: food.category,
    unit: food.unit,
    preparationState: food.preparationState,
    nutritionBasisAmount: String(food.nutritionBasisAmount),
    proteinPerBasis: String(food.proteinPerBasis),
    caloriesPerBasis: food.caloriesPerBasis == null ? '' : String(food.caloriesPerBasis),
    carbsPerBasis: food.carbsPerBasis == null ? '' : String(food.carbsPerBasis),
    fatPerBasis: food.fatPerBasis == null ? '' : String(food.fatPerBasis),
    portionMode: food.portionMode,
    planningIncrement: food.planningIncrement == null ? '' : String(food.planningIncrement),
    dailyMaxQuantity: food.dailyMaxQuantity == null ? '' : String(food.dailyMaxQuantity),
    dailyMaxPortions: food.dailyMaxPortions == null ? '' : String(food.dailyMaxPortions),
    lowStockThreshold: food.lowStockThreshold == null ? '' : String(food.lowStockThreshold),
    plannerEligible: food.plannerEligible,
  };
}

function optionalNumber(value: string) {
  return value.trim() === '' ? null : Number(value);
}

function FoodEditor({ food, onClose }: { food: KitchenFoodDTO | null; onClose: () => void }) {
  const [draft, setDraft] = useState<FoodDraft>(() => food ? draftFromFood(food) : emptyFood);
  const [error, setError] = useState('');
  const create = useCreateKitchenFood();
  const update = useUpdateKitchenFood();
  const busy = create.isPending || update.isPending;
  const set = <K extends keyof FoodDraft>(key: K, value: FoodDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const input: KitchenFoodInput = {
      name: draft.name,
      category: draft.category,
      unit: draft.unit,
      preparationState: draft.preparationState,
      nutritionBasisAmount: Number(draft.nutritionBasisAmount),
      proteinPerBasis: Number(draft.proteinPerBasis),
      caloriesPerBasis: optionalNumber(draft.caloriesPerBasis),
      carbsPerBasis: optionalNumber(draft.carbsPerBasis),
      fatPerBasis: optionalNumber(draft.fatPerBasis),
      portionMode: draft.portionMode,
      planningIncrement: draft.portionMode === 'splittable' ? Number(draft.planningIncrement || '1') : null,
      dailyMaxQuantity: optionalNumber(draft.dailyMaxQuantity),
      dailyMaxPortions: optionalNumber(draft.dailyMaxPortions),
      lowStockThreshold: optionalNumber(draft.lowStockThreshold),
      plannerEligible: draft.plannerEligible,
    };
    try {
      if (food) await update.mutateAsync({ id: food.id, patch: input });
      else await create.mutateAsync(input);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <Modal title={food ? `Edit ${food.name}` : 'Add food'} description="Set nutrition once, then add exact portions whenever you restock." onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className={label}>Food name</span><input required value={draft.name} onChange={(e) => set('name', e.target.value)} className={field} placeholder="Chicken breast" autoFocus /></label>
          <label><span className={label}>Category</span><input required value={draft.category} onChange={(e) => set('category', e.target.value)} className={field} /></label>
          <label><span className={label}>Measured in</span><select value={draft.unit} onChange={(e) => set('unit', e.target.value as FoodDraft['unit'])} className={field}><option value="g">Grams</option><option value="ml">Milliliters</option><option value="unit">Units</option><option value="scoop">Scoops</option></select></label>
          <label><span className={label}>Nutrition state</span><select value={draft.preparationState} onChange={(e) => set('preparationState', e.target.value as FoodDraft['preparationState'])} className={field}><option value="raw">Raw</option><option value="cooked">Cooked</option><option value="as_packaged">As packaged</option></select></label>
          <label><span className={label}>Nutrition basis</span><div className="relative"><input required min="0.001" step="any" type="number" value={draft.nutritionBasisAmount} onChange={(e) => set('nutritionBasisAmount', e.target.value)} className={`${field} pr-12`} /><span className="pointer-events-none absolute right-3 top-2.5 text-sm text-slate-400">{draft.unit}</span></div></label>
        </div>

        <section className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 dark:border-teal-500/20 dark:bg-teal-500/[0.06]">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-neutral-100"><Flame size={15} className="text-teal-600 dark:text-teal-400" /> Macros per nutrition basis</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label><span className={label}>Protein (g) *</span><input required min="0.001" step="any" type="number" value={draft.proteinPerBasis} onChange={(e) => set('proteinPerBasis', e.target.value)} className={field} /></label>
            <label><span className={label}>Calories</span><input min="0" step="any" type="number" value={draft.caloriesPerBasis} onChange={(e) => set('caloriesPerBasis', e.target.value)} className={field} /></label>
            <label><span className={label}>Carbs (g)</span><input min="0" step="any" type="number" value={draft.carbsPerBasis} onChange={(e) => set('carbsPerBasis', e.target.value)} className={field} /></label>
            <label><span className={label}>Fat (g)</span><input min="0" step="any" type="number" value={draft.fatPerBasis} onChange={(e) => set('fatPerBasis', e.target.value)} className={field} /></label>
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <label><span className={label}>Planner behavior</span><select value={draft.portionMode} onChange={(e) => set('portionMode', e.target.value as FoodDraft['portionMode'])} className={field}><option value="whole">Use whole bag / portion</option><option value="splittable">Allow partial quantity</option></select></label>
          {draft.portionMode === 'splittable' && <label><span className={label}>Planning increment</span><input required min="0.001" step="any" type="number" value={draft.planningIncrement} onChange={(e) => set('planningIncrement', e.target.value)} className={field} placeholder="25" /><span className="mt-1 block text-[10px] leading-4 text-slate-400">Rounding step only, not a serving size.</span></label>}
          <label><span className={label}>Maximum per day {draft.portionMode === 'splittable' && draft.plannerEligible ? '*' : '(optional)'}</span><input required={draft.portionMode === 'splittable' && draft.plannerEligible} min={draft.planningIncrement || '0.001'} step="any" type="number" value={draft.dailyMaxQuantity} onChange={(e) => set('dailyMaxQuantity', e.target.value)} className={field} placeholder={draft.unit === 'scoop' ? 'For example: 2 scoops' : `Maximum ${draft.unit} per day`} /><span className="mt-1 block text-[10px] leading-4 text-slate-400">Limits this item in each daily plan and in the stock runway forecast.</span></label>
          <label><span className={label}>Maximum stock portions per day (optional)</span><input min="1" max="100" step="1" type="number" value={draft.dailyMaxPortions} onChange={(e) => set('dailyMaxPortions', e.target.value)} className={field} placeholder="For example: 1 bag or 2 bottles" /><span className="mt-1 block text-[10px] leading-4 text-slate-400">Use this for variable-weight bags, cans, and bottles. Each selected stock portion counts once.</span></label>
          <label><span className={label}>Low-stock warning</span><input min="0" step="any" type="number" value={draft.lowStockThreshold} onChange={(e) => set('lowStockThreshold', e.target.value)} className={field} placeholder={`Optional (${draft.unit})`} /></label>
        </div>

        <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-neutral-800"><input type="checkbox" checked={draft.plannerEligible} onChange={(e) => set('plannerEligible', e.target.checked)} className="h-4 w-4 accent-teal-600" /><span><strong className="font-semibold">Use in generated plans</strong><span className="block text-xs text-slate-500 dark:text-neutral-400">Turn this off to track stock without letting Kitchen select it.</span></span></label>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={`${button} text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800`}>Cancel</button><button disabled={busy} className={`${button} bg-teal-600 px-4 text-white hover:bg-teal-700`}><Check size={15} /> {food ? 'Save changes' : 'Add food'}</button></div>
      </form>
    </Modal>
  );
}

function StockEditor({ food, onClose }: { food: KitchenFoodDTO; onClose: () => void }) {
  const [weights, setWeights] = useState('');
  const [expiry, setExpiry] = useState('');
  const [error, setError] = useState('');
  const add = useAddKitchenStock();
  const amountCount = weights.split(/[\s,;]+/).filter(Boolean).length;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const amounts = weights.split(/[\s,;]+/).map(Number).filter((value) => Number.isFinite(value) && value > 0);
    if (!amounts.length) { setError('Enter at least one positive portion amount.'); return; }
    try {
      await add.mutateAsync({ foodId: food.id, input: { portions: amounts.map((amount, index) => ({ amount, label: `${food.portionMode === 'whole' ? 'Portion' : 'Lot'} ${food.portions.length + index + 1}`, expiresOn: expiry || null })) } });
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };
  return (
    <Modal title={`Restock ${food.name}`} description={`Enter exact ${food.unit} amounts for each bag or lot.`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 p-5">
        <label><span className={label}>Portion amounts ({food.unit})</span><textarea required rows={5} value={weights} onChange={(e) => setWeights(e.target.value)} className={field} placeholder={food.unit === 'g' ? '243, 278, 301, 265' : food.unit === 'ml' ? '330, 330, 330' : '1, 1, 1'} autoFocus /></label>
        <p className="-mt-2 text-xs text-slate-500 dark:text-neutral-400">Separate multiple portions with commas, spaces, or new lines.</p>
        <label><span className={label}>Expiry date (optional)</span><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={field} /></label>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={`${button} text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800`}>Cancel</button><button disabled={add.isPending} className={`${button} bg-teal-600 px-4 text-white hover:bg-teal-700`}><Plus size={15} /> Add {amountCount || ''} {amountCount === 1 ? 'portion' : 'portions'}</button></div>
      </form>
    </Modal>
  );
}

function AdjustmentEditor({ food, portion, onClose }: { food: KitchenFoodDTO; portion: KitchenStockPortionDTO; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<Exclude<KitchenStockAdjustmentReason, 'restored'>>('eaten');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const adjust = useAdjustKitchenStock();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await adjust.mutateAsync({ stockId: portion.id, input: { deltaQuantity: -Number(amount), reason, note } });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  return (
    <Modal title={`Use ${food.name}`} description={`${format(portion.availableQuantity)} ${food.unit} is available in this portion.`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 p-5">
        <label><span className={label}>Amount used ({food.unit})</span><input autoFocus required min="0.001" max={portion.availableQuantity} step="any" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} /></label>
        <label><span className={label}>Reason</span><select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className={field}><option value="eaten">Eaten — count toward today</option><option value="correction">Stock correction</option><option value="discarded">Discarded</option></select></label>
        <label><span className={label}>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} className={field} /></label>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={`${button} text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800`}>Cancel</button><button disabled={adjust.isPending} className={`${button} bg-slate-900 px-4 text-white hover:bg-slate-700 dark:bg-white dark:text-neutral-900`}>Update stock</button></div>
      </form>
    </Modal>
  );
}

function PlanItemEditor({ foods, dateLocal, onClose }: { foods: KitchenFoodDTO[]; dateLocal: string; onClose: () => void }) {
  const choices = foods.flatMap((food) => food.portions
    .filter((portion) => portion.availableQuantity > 0 && (!portion.expiresOn || portion.expiresOn >= dateLocal))
    .map((portion) => ({ food, portion })));
  const [stockPortionId, setStockPortionId] = useState(choices[0]?.portion.id ?? '');
  const selected = choices.find(({ portion }) => portion.id === stockPortionId) ?? choices[0];
  const defaultQuantity = selected ? (selected.food.portionMode === 'whole' ? selected.portion.availableQuantity : Math.min(selected.food.planningIncrement ?? 1, selected.portion.availableQuantity)) : 0;
  const [quantity, setQuantity] = useState(String(defaultQuantity));
  const [error, setError] = useState('');
  const add = useAddKitchenPlanLine();

  const selectPortion = (id: string) => {
    setStockPortionId(id);
    const choice = choices.find(({ portion }) => portion.id === id);
    if (choice) setQuantity(String(choice.food.portionMode === 'whole' ? choice.portion.availableQuantity : Math.min(choice.food.planningIncrement ?? 1, choice.portion.availableQuantity)));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await add.mutateAsync({ dateLocal, stockPortionId, quantity: Number(quantity) });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <Modal title="Add to today’s plan" description="Choose available stock and reserve the amount you intend to eat." onClose={onClose}>
      {selected ? <form onSubmit={submit} className="space-y-4 p-5">
        <label><span className={label}>Food and stock portion</span><select value={stockPortionId} onChange={(event) => selectPortion(event.target.value)} className={field} autoFocus>{choices.map(({ food, portion }) => <option key={portion.id} value={portion.id}>{food.name} — {portion.label ?? `${format(portion.remainingQuantity)} ${food.unit}`}</option>)}</select></label>
        <div className="rounded-xl border border-teal-200 bg-teal-50/60 px-3 py-3 dark:border-teal-500/20 dark:bg-teal-500/[0.06]"><p className="text-xs font-semibold text-slate-800 dark:text-neutral-100">{format(selected.portion.availableQuantity)} {selected.food.unit} available</p><p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">{format(selected.food.proteinPerBasis)} g protein per {format(selected.food.nutritionBasisAmount)} {selected.food.unit}{selected.portion.expiresOn ? ` · expires ${selected.portion.expiresOn}` : ''}</p></div>
        <label><span className={label}>Amount to plan ({selected.food.unit})</span><input required min="0.001" max={selected.portion.availableQuantity} step="any" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={field} /></label>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={`${button} text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800`}>Cancel</button><button disabled={add.isPending} className={`${button} bg-teal-600 px-4 text-white hover:bg-teal-700`}><Plus size={15} /> Add to plan</button></div>
      </form> : <div className="p-6 text-center"><PackageOpen className="mx-auto text-slate-300 dark:text-neutral-600" size={26} /><p className="mt-3 text-sm font-semibold">No available stock to add</p><p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Restock an item first, then return to today’s plan.</p></div>}
    </Modal>
  );
}

function SummaryMetric({ icon: Icon, label: metricLabel, value, note, tone = 'teal' }: { icon: typeof CircleGauge; label: string; value: string; note: string; tone?: 'teal' | 'emerald' | 'amber' | 'rose' }) {
  const tones = {
    teal: 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-400',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
    rose: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
  };
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tones[tone]}`}><Icon size={16} /></span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-neutral-500">{metricLabel}</p>
        <p className="mt-0.5 truncate text-base font-bold tabular-nums text-slate-900 dark:text-neutral-100">{value}</p>
        <p className="truncate text-[10px] text-slate-500 dark:text-neutral-400">{note}</p>
      </div>
    </div>
  );
}

export default function KitchenPage() {
  const dashboard = useKitchenDashboard();
  const deals = useKitchenDeals();
  const [view, setView] = useState<KitchenView>('today');
  const [editingFood, setEditingFood] = useState<KitchenFoodDTO | 'new' | null>(null);
  const [stockFood, setStockFood] = useState<KitchenFoodDTO | null>(null);
  const [adjusting, setAdjusting] = useState<{ food: KitchenFoodDTO; portion: KitchenStockPortionDTO } | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [planItemOpen, setPlanItemOpen] = useState(false);
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [dealQuery, setDealQuery] = useState('');
  const [dealCategory, setDealCategory] = useState('All');
  const generate = useGenerateKitchenPlan();
  const consume = useConsumeKitchenPlanLine();
  const undo = useUndoKitchenPlanLine();
  const undoMovement = useUndoKitchenMovement();
  const cancel = useCancelKitchenPlan();
  const archive = useArchiveKitchenFood();
  const saveSettings = useSaveKitchenSettings();
  const refreshDeals = useRefreshKitchenDeals();
  const removePlanLine = useRemoveKitchenPlanLine();
  const [proteinTarget, setProteinTarget] = useState('120');
  const [calorieTarget, setCalorieTarget] = useState('2500');
  const [carbTarget, setCarbTarget] = useState('325');
  const [warningDays, setWarningDays] = useState('7');
  const [forecastDays, setForecastDays] = useState('30');

  useEffect(() => {
    if (dashboard.data) {
      setProteinTarget(String(dashboard.data.settings.dailyProteinTarget));
      setCalorieTarget(String(dashboard.data.settings.dailyCaloriesTarget));
      setCarbTarget(String(dashboard.data.settings.dailyCarbsTarget));
      setWarningDays(String(dashboard.data.settings.warningCoverageDays));
      setForecastDays(String(dashboard.data.settings.forecastDays));
    }
  }, [dashboard.data?.settings]);

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => setter((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const portions = useMemo(() => dashboard.data?.foods.flatMap((food) => food.portions.filter((portion) => portion.availableQuantity > 0).map((portion) => ({ food, portion }))) ?? [], [dashboard.data?.foods]);

  if (dashboard.isLoading) return <div className="grid h-full place-items-center bg-slate-50 dark:bg-neutral-950"><div className="text-center text-slate-500 dark:text-neutral-400"><CookingPot className="mx-auto mb-3 animate-pulse text-teal-600" size={30} /><p className="text-sm">Loading Kitchen…</p></div></div>;
  if (dashboard.isError || !dashboard.data) return <div className="grid h-full place-items-center bg-slate-50 p-6 dark:bg-neutral-950"><div className={`${card} max-w-md p-6 text-center shadow-sm`}><span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400"><AlertTriangle size={20} /></span><h1 className="mt-4 text-lg font-semibold">Kitchen is unavailable</h1><p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">{errorMessage(dashboard.error)}</p><button onClick={() => void dashboard.refetch()} className={`${button} mt-4 bg-slate-900 px-4 text-white hover:bg-slate-700 dark:bg-white dark:text-neutral-900`}><RefreshCw size={15} /> Try again</button></div></div>;

  const data = dashboard.data;
  const planProtein = data.plan?.plannedMacros.proteinG ?? 0;
  const consumed = data.consumedTodayMacros.proteinG;
  const accounted = consumed + planProtein;
  const planCalories = data.plan?.plannedMacros.caloriesKcal ?? 0;
  const consumedCalories = data.consumedTodayMacros.caloriesKcal ?? 0;
  const accountedCalories = consumedCalories + planCalories;
  const planCarbs = data.plan?.plannedMacros.carbsG ?? 0;
  const consumedCarbs = data.consumedTodayMacros.carbsG ?? 0;
  const accountedCarbs = consumedCarbs + planCarbs;
  const caloriesIncomplete = (consumed > 0 && data.consumedTodayMacros.incompleteFields.includes('calories')) || (planProtein > 0 && Boolean(data.plan?.plannedMacros.incompleteFields.includes('calories')));
  const carbsIncomplete = (consumed > 0 && data.consumedTodayMacros.incompleteFields.includes('carbs')) || (planProtein > 0 && Boolean(data.plan?.plannedMacros.incompleteFields.includes('carbs')));
  const progress = Math.min(100, (accounted / data.settings.dailyProteinTarget) * 100);
  const filteredFoods = data.foods.filter((food) => `${food.name} ${food.category}`.toLowerCase().includes(inventoryQuery.trim().toLowerCase()));
  const plannerSetupFoods = data.foods.filter((food) => food.plannerEligible && food.portionMode === 'splittable' && food.dailyMaxQuantity == null && food.availableQuantity > 0);
  const dealCategories = ['All', ...new Set(deals.data?.deals.map((deal) => deal.category) ?? [])];
  const visibleDeals = (deals.data?.deals ?? []).filter((deal) => {
    const matchesCategory = dealCategory === 'All' || deal.category === dealCategory;
    const query = dealQuery.trim().toLowerCase();
    return matchesCategory && (!query || `${deal.category} ${deal.description} ${deal.store}`.toLowerCase().includes(query));
  });
  const flaggedDeals = (deals.data?.deals ?? []).filter((deal) => deal.quality !== 'discount').length;

  const views: Array<{ id: KitchenView; label: string; icon: typeof CookingPot; badge?: number }> = [
    { id: 'today', label: 'Today', icon: CookingPot, badge: data.plan?.lines.filter((line) => line.status === 'planned').length },
    { id: 'inventory', label: 'Inventory', icon: PackageOpen, badge: data.foods.filter((food) => food.lowStock).length },
    { id: 'deals', label: 'Deals', icon: Tags, badge: flaggedDeals },
    { id: 'activity', label: 'Activity & runway', icon: History, badge: data.alerts.length },
  ];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50 font-[Aptos,'Segoe_UI_Variable_Text','Segoe_UI',sans-serif] text-slate-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="z-30 flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-400"><CookingPot size={18} /></span>
          <div className="min-w-0"><h1 className="truncate text-sm font-semibold tracking-[-0.02em]">The Kitchen</h1><p className="truncate text-[10px] text-slate-400">Macro planning and exact stock</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={() => setSettingsOpen(true)} className={`${button} border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800`}><Settings2 size={14} /><span className="hidden sm:inline">Settings</span></button>
          <button onClick={() => setEditingFood('new')} className={`${button} bg-teal-600 text-white shadow-sm hover:bg-teal-700`}><Plus size={15} /> Add food</button>
        </div>
      </header>

      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900 sm:px-4" aria-label="Kitchen sections">
        {views.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return <button key={item.id} type="button" onClick={() => setView(item.id)} aria-current={active ? 'page' : undefined} className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-teal-500/60 ${active ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-neutral-900' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'}`}><Icon size={13} /> {item.label}{Boolean(item.badge) && <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[9px] tabular-nums ${active ? 'bg-white/15 dark:bg-black/10' : item.id === 'activity' || item.id === 'inventory' ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400' : 'bg-slate-200 text-slate-600 dark:bg-neutral-700 dark:text-neutral-300'}`}>{item.badge}</span>}</button>;
        })}
      </nav>

      <section className="grid shrink-0 divide-y divide-slate-200 border-b border-slate-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        <SummaryMetric icon={CircleGauge} label="Protein today" value={`${format(accounted)} / ${format(data.settings.dailyProteinTarget)} g`} note={`${format(consumed)} eaten · ${format(planProtein)} planned`} tone={accounted >= data.settings.dailyProteinTarget ? 'emerald' : 'teal'} />
        <SummaryMetric icon={Flame} label="Calories today" value={`${format(accountedCalories, 0)} / ${format(data.settings.dailyCaloriesTarget, 0)} kcal`} note={`${format(consumedCalories, 0)} eaten · ${format(planCalories, 0)} planned${caloriesIncomplete ? ' · incomplete labels' : ''}`} tone={accountedCalories >= data.settings.dailyCaloriesTarget ? 'emerald' : 'amber'} />
        <SummaryMetric icon={Wheat} label="Carbs today" value={`${format(accountedCarbs)} / ${format(data.settings.dailyCarbsTarget)} g`} note={`${format(consumedCarbs)} eaten · ${format(planCarbs)} planned${carbsIncomplete ? ' · incomplete labels' : ''}`} tone={accountedCarbs >= data.settings.dailyCarbsTarget ? 'emerald' : 'teal'} />
        <SummaryMetric icon={ShieldCheck} label="Coverage" value={`${data.forecast.fullTargetDays} full days`} note={data.forecast.coversHorizon ? `${data.forecast.horizonDays}-day horizon covered` : `First gap ${data.forecast.firstMissDate ?? 'soon'}`} tone={data.forecast.fullTargetDays < data.settings.warningCoverageDays ? 'rose' : 'emerald'} />
      </section>

      <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-5 sm:py-5">
        {view === 'today' && (
          <div className="mx-auto grid max-w-[1400px] gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.55fr)]">
            <section className={`${card} overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-neutral-800 sm:px-5">
                <div><h2 className="text-sm font-semibold">Today’s macro plan</h2><p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">Reserve exact portions, then confirm what you actually ate.</p></div>
                <div className="flex items-center gap-2"><button type="button" disabled={!portions.length} onClick={() => setPlanItemOpen(true)} className={`${button} border border-teal-200 bg-white text-teal-700 hover:bg-teal-50 dark:border-teal-500/30 dark:bg-neutral-900 dark:text-teal-400 dark:hover:bg-teal-500/[0.06]`}><Plus size={14} /> Add item</button><button disabled={generate.isPending || !data.foods.length || plannerSetupFoods.length > 0} onClick={() => void generate.mutateAsync({ dateLocal: data.dateLocal, pinnedStockIds: [...pinned], excludedFoodIds: [], excludedStockIds: [...excluded] })} className={`${button} bg-teal-600 text-white shadow-sm hover:bg-teal-700`}><Sparkles size={14} /> {data.plan ? 'Regenerate plan' : 'Generate plan'}</button></div>
              </div>

              {plannerSetupFoods.length > 0 && <div className="border-b border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-500/[0.06] sm:px-5"><div className="flex items-start gap-2.5"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" /><div><p className="text-xs font-semibold text-amber-900 dark:text-amber-200">Set realistic daily limits before planning</p><p className="mt-1 text-[11px] leading-5 text-amber-800/80 dark:text-amber-300/80">A partial stock item has no natural serving boundary. Add the maximum you would actually eat in one day so Kitchen cannot turn the whole protein target into one oversized food amount.</p><div className="mt-2 flex flex-wrap gap-1.5">{plannerSetupFoods.map((food) => <button key={food.id} type="button" onClick={() => setEditingFood(food)} className="rounded-md border border-amber-300 bg-white/70 px-2 py-1 text-[10px] font-semibold text-amber-800 hover:bg-white dark:border-amber-500/30 dark:bg-neutral-900/60 dark:text-amber-300">Set {food.name} limit</button>)}</div></div></div></div>}

              <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950/40 sm:px-5">
                <div className="flex items-center justify-between gap-4 text-xs"><span className="font-medium text-slate-600 dark:text-neutral-300">{format(accounted)} of {format(data.settings.dailyProteinTarget)} g accounted for</span><span className={data.plan?.targetMet ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-neutral-400'}>{data.plan?.targetMet ? 'Target covered' : `${format(Math.max(0, data.settings.dailyProteinTarget - accounted))} g remaining`}</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-neutral-800"><motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} className={`h-full rounded-full ${data.plan?.targetMet ? 'bg-emerald-500' : 'bg-teal-500'}`} /></div>
              </div>

              {portions.length > 0 && <details className="border-b border-slate-200 px-4 py-3 dark:border-neutral-800 sm:px-5"><summary className="cursor-pointer list-none text-xs font-semibold text-slate-600 dark:text-neutral-300"><span className="inline-flex items-center gap-1.5"><ChevronRight size={13} className="transition group-open:rotate-90" /> Portion preferences <span className="font-normal text-slate-400">{pinned.size} pinned · {excluded.size} excluded</span></span></summary><div className="mt-3 flex flex-wrap gap-2">{portions.map(({ food, portion }) => <div key={portion.id} className={`inline-flex items-center overflow-hidden rounded-lg border text-xs ${excluded.has(portion.id) ? 'border-rose-200 bg-rose-50/70 opacity-70 dark:border-rose-500/20 dark:bg-rose-500/10' : pinned.has(portion.id) ? 'border-teal-300 bg-teal-50 dark:border-teal-500/30 dark:bg-teal-500/10' : 'border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-900'}`}><button type="button" onClick={() => { toggle(setPinned, portion.id); setExcluded((current) => { const next = new Set(current); next.delete(portion.id); return next; }); }} className="flex items-center gap-1.5 px-2.5 py-2"><Pin size={11} className={pinned.has(portion.id) ? 'fill-current text-teal-600' : 'text-slate-400'} /> {food.name} · {format(portion.availableQuantity)} {food.unit}</button><button type="button" onClick={() => { toggle(setExcluded, portion.id); setPinned((current) => { const next = new Set(current); next.delete(portion.id); return next; }); }} className="border-l border-inherit px-2 py-2 text-slate-400 hover:text-rose-600" aria-label={`Exclude ${food.name} portion`}><X size={11} /></button></div>)}</div></details>}

              {!data.plan ? (
                <div className="grid min-h-[22rem] place-items-center p-6 text-center"><div className="max-w-sm"><span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400"><CookingPot size={21} /></span><h3 className="mt-4 text-base font-semibold">No plan for today</h3><p className="mt-1.5 text-sm leading-6 text-slate-500 dark:text-neutral-400">Build it yourself by adding stock items, or generate a plan automatically.</p>{portions.length > 0 && <button type="button" onClick={() => setPlanItemOpen(true)} className={`${button} mt-4 bg-teal-600 px-4 text-white hover:bg-teal-700`}><Plus size={14} /> Add first item</button>}{!data.foods.length && <button onClick={() => setEditingFood('new')} className={`${button} mt-4 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200`}><Plus size={14} /> Add your first food</button>}</div></div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-neutral-800">
                  {data.plan.lines.map((line, index) => <motion.div key={line.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.035, 0.2) }} className={`flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5 ${line.status === 'cancelled' ? 'opacity-45' : ''}`}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${line.status === 'consumed' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400'}`}>{line.status === 'consumed' ? <Check size={16} /> : <Beef size={16} />}</span><div className="min-w-40 flex-1"><p className="text-sm font-semibold">{line.foodName}</p><p className="mt-0.5 text-[11px] text-slate-500 dark:text-neutral-400">{line.stockLabel ?? 'Tracked portion'}{line.expiresOn ? ` · expires ${line.expiresOn}` : ''}</p></div><div className="text-right"><p className="text-sm font-bold tabular-nums">{format(line.macros.proteinG)} g protein</p><p className="text-[11px] text-slate-500 dark:text-neutral-400">{format(line.plannedQuantity)} {line.unit}</p></div>{line.status === 'planned' && <div className="flex items-center gap-1.5"><input aria-label={`Actual ${line.unit} of ${line.foodName}`} type="number" min="0.001" step="any" value={actuals[line.id] ?? String(line.plannedQuantity)} onChange={(e) => setActuals((current) => ({ ...current, [line.id]: e.target.value }))} className="h-8 w-20 rounded-lg border border-slate-200 bg-white px-2 text-xs tabular-nums outline-none focus:border-teal-500 dark:border-neutral-700 dark:bg-neutral-950" /><button disabled={consume.isPending} onClick={() => void consume.mutateAsync({ planId: data.plan!.id, lineId: line.id, input: { actualQuantity: Number(actuals[line.id] ?? line.plannedQuantity) } })} className={`${button} min-h-8 bg-slate-900 px-2.5 text-xs text-white hover:bg-slate-700 dark:bg-white dark:text-neutral-900`}><Check size={12} /> Eaten</button><button type="button" disabled={removePlanLine.isPending} onClick={() => void removePlanLine.mutateAsync({ planId: data.plan!.id, lineId: line.id })} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" aria-label={`Remove ${line.foodName} from plan`} title="Remove from plan"><Trash2 size={13} /></button></div>}{line.status === 'consumed' && <button disabled={undo.isPending} onClick={() => void undo.mutateAsync({ planId: data.plan!.id, lineId: line.id })} className={`${button} min-h-8 px-2.5 text-xs text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800`}><RotateCcw size={12} /> Undo</button>}</motion.div>)}
                  {data.plan.status === 'draft' && <div className="flex justify-end px-4 py-3 sm:px-5"><button disabled={cancel.isPending} onClick={() => void cancel.mutateAsync(data.plan!.id)} className={`${button} min-h-8 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-neutral-400 dark:hover:bg-rose-500/10`}><X size={12} /> {cancel.isPending ? 'Cancelling…' : 'Cancel reservations'}</button></div>}
                </div>
              )}
            </section>

            <aside className="space-y-4">
              {data.alerts.length > 0 && <section className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-500/20 dark:bg-amber-500/[0.06]"><div className="flex items-center gap-2 border-b border-amber-200 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-500/20 dark:text-amber-300"><AlertTriangle size={15} /> Needs attention</div><div className="divide-y divide-amber-200/70 dark:divide-amber-500/15">{data.alerts.map((alert) => <div key={alert.id} className="px-4 py-3"><p className="text-xs font-semibold text-slate-800 dark:text-neutral-100">{alert.title}</p><p className="mt-1 text-[11px] leading-5 text-slate-600 dark:text-neutral-400">{alert.detail}</p></div>)}</div></section>}

              <section className={`${card} overflow-hidden`}><div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-800"><div><h2 className="text-sm font-semibold">Stock runway</h2><p className="mt-0.5 text-[11px] text-slate-500 dark:text-neutral-400">Projected after {data.forecast.horizonDays} days</p></div><button type="button" onClick={() => setView('activity')} className="text-xs font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400">Details</button></div><div className="space-y-4 p-4">{data.forecast.perFood.slice(0, 5).map((item) => { const food = data.foods.find((candidate) => candidate.id === item.foodId); if (!food) return null; const pct = food.availableQuantity > 0 ? (item.remainingAfterForecast / food.availableQuantity) * 100 : 0; return <div key={item.foodId}><div className="mb-1.5 flex items-center justify-between gap-3 text-xs"><span className="truncate font-medium">{item.foodName}</span><span className="shrink-0 tabular-nums text-slate-400">{item.projectedDepletionDate ? `out ${item.projectedDepletionDate}` : `${format(item.remainingAfterForecast)} ${food.unit} left`}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800"><div className={`h-full rounded-full ${pct < 25 ? 'bg-rose-500' : pct < 50 ? 'bg-amber-500' : 'bg-teal-500'}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div></div>; })}{!data.foods.length && <p className="text-sm leading-6 text-slate-500 dark:text-neutral-400">Add food and stock to begin forecasting your runway.</p>}</div></section>
            </aside>
          </div>
        )}

        {view === 'inventory' && (
          <div className="mx-auto max-w-[1400px]">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold tracking-[-0.02em]">Inventory</h2><p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">Manage food definitions and tap a portion to record usage.</p></div><label className="relative block w-full sm:w-64"><span className="sr-only">Search inventory</span><Search size={14} className="absolute left-3 top-2.5 text-slate-400" /><input value={inventoryQuery} onChange={(event) => setInventoryQuery(event.target.value)} className={`${field} h-9 py-2 pl-9`} placeholder="Search food" /></label></div>
            {!data.foods.length ? <button onClick={() => setEditingFood('new')} className="grid min-h-72 w-full place-items-center rounded-xl border-2 border-dashed border-slate-200 bg-white/50 text-center transition hover:border-teal-300 hover:bg-white dark:border-neutral-800 dark:bg-neutral-900/40 dark:hover:border-teal-500/40"><div className="max-w-sm px-6"><span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400"><Plus size={20} /></span><h3 className="mt-4 text-base font-semibold">Add your first repeat purchase</h3><p className="mt-1.5 text-sm leading-6 text-slate-500 dark:text-neutral-400">Define label nutrition once. Future restocks only need the exact bag or portion weights.</p></div></button> : filteredFoods.length === 0 ? <div className={`${card} grid min-h-56 place-items-center p-6 text-center`}><div><Search className="mx-auto text-slate-300 dark:text-neutral-600" size={24} /><p className="mt-3 text-sm font-semibold">No matching food</p><p className="mt-1 text-xs text-slate-500">Try a different name or category.</p></div></div> : <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{filteredFoods.map((food, index) => <motion.article key={food.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.03, 0.18) }} className={`${card} overflow-hidden`}><div className="flex items-start gap-3 p-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400"><Beef size={17} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-semibold">{food.name}</h3>{food.lowStock && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">Low</span>}{!food.plannerEligible && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">Manual</span>}</div><p className="mt-1 truncate text-[11px] text-slate-500 dark:text-neutral-400">{food.category} · {food.proteinPerBasis} g protein / {food.nutritionBasisAmount} {food.unit} · {preparationLabel(food.preparationState)}</p></div><div className="flex"><button onClick={() => setEditingFood(food)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200" aria-label={`Edit ${food.name}`}><Edit3 size={14} /></button><button disabled={food.stockQuantity > 0 || archive.isPending} onClick={() => void archive.mutateAsync(food.id)} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-25 dark:hover:bg-rose-500/10" title={food.stockQuantity > 0 ? 'Empty this stock before archiving' : 'Archive food'} aria-label={`Archive ${food.name}`}><Archive size={14} /></button></div></div><div className="grid grid-cols-3 border-y border-slate-100 bg-slate-50/60 dark:border-neutral-800 dark:bg-neutral-950/30"><div className="px-4 py-3"><p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Available</p><p className="mt-1 text-sm font-bold tabular-nums">{format(food.availableQuantity)} {food.unit}</p></div><div className="border-x border-slate-100 px-4 py-3 dark:border-neutral-800"><p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Reserved</p><p className="mt-1 text-sm font-bold tabular-nums">{format(food.reservedQuantity)} {food.unit}</p></div><div className="px-4 py-3"><p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Protein</p><p className="mt-1 text-sm font-bold tabular-nums">{format(food.macrosRemaining.proteinG)} g</p></div></div><div className="p-4"><div className="mb-3 flex min-h-16 flex-wrap content-start gap-2">{food.portions.filter((portion) => portion.remainingQuantity > 0).map((portion) => <button key={portion.id} onClick={() => setAdjusting({ food, portion })} className={`rounded-lg border px-2.5 py-2 text-left outline-none transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-teal-500/60 ${portion.expiresOn && portion.expiresOn < data.dateLocal ? 'border-rose-200 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-500/10' : portion.reservedQuantity > 0 ? 'border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10' : 'border-slate-200 bg-white hover:border-teal-300 dark:border-neutral-700 dark:bg-neutral-900'}`}><p className="text-xs font-semibold tabular-nums">{format(portion.remainingQuantity)} {food.unit}</p><p className="mt-0.5 text-[9px] text-slate-500 dark:text-neutral-400">{format(portion.macrosRemaining.proteinG)}g protein{portion.reservedQuantity > 0 ? ` · ${format(portion.reservedQuantity)} reserved` : ''}</p></button>)}</div>{food.portions.every((portion) => portion.remainingQuantity <= 0) && <p className="mb-3 py-2 text-xs text-slate-500 dark:text-neutral-400">No portions left. Restock to use this food in plans.</p>}<button onClick={() => setStockFood(food)} className={`${button} w-full border border-dashed border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-500/30 dark:text-teal-400 dark:hover:bg-teal-500/[0.06]`}><Plus size={14} /> Add exact {food.portionMode === 'whole' ? 'bags / portions' : 'stock lots'}</button></div></motion.article>)}</div>}
          </div>
        )}

        {view === 'deals' && (
          <div className="mx-auto max-w-[1400px]">
            <section className="mb-4 overflow-hidden rounded-xl border border-emerald-200 bg-[linear-gradient(120deg,rgba(236,253,245,0.95),rgba(240,253,250,0.65))] dark:border-emerald-500/20 dark:bg-[linear-gradient(120deg,rgba(6,78,59,0.16),rgba(13,148,136,0.05))]">
              <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm"><Tags size={18} /></span>
                  <div className="min-w-0"><h2 className="text-base font-semibold tracking-[-0.02em]">Protein deals in Mecca</h2><p className="mt-0.5 text-xs text-slate-600 dark:text-neutral-300">Daily D4D offers · {flaggedDeals} good or excellent {flaggedDeals === 1 ? 'deal' : 'deals'} flagged</p></div>
                </div>
                <button type="button" disabled={refreshDeals.isPending} onClick={() => void refreshDeals.mutateAsync()} className={`${button} bg-emerald-700 px-4 text-white shadow-sm hover:bg-emerald-800`}><RefreshCw size={14} className={refreshDeals.isPending ? 'animate-spin' : ''} /> {refreshDeals.isPending ? 'Checking D4D…' : 'Refresh deals'}</button>
              </div>
              {deals.data?.lastError && <div className="border-t border-amber-200 bg-amber-50/80 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"><AlertTriangle size={13} className="mr-1.5 inline" />Latest refresh failed: {deals.data.lastError}. Showing the last saved offers.</div>}
            </section>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex max-w-full gap-1 overflow-x-auto pb-1">{dealCategories.map((category) => <button key={category} type="button" onClick={() => setDealCategory(category)} className={`min-h-8 shrink-0 rounded-lg px-3 text-xs font-semibold transition ${dealCategory === category ? 'bg-slate-900 text-white dark:bg-white dark:text-neutral-900' : 'border border-slate-200 bg-white text-slate-600 hover:border-emerald-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'}`}>{category}</button>)}</div>
              <label className="relative block w-full sm:w-72"><span className="sr-only">Search deals</span><Search size={14} className="absolute left-3 top-2.5 text-slate-400" /><input value={dealQuery} onChange={(event) => setDealQuery(event.target.value)} className={`${field} h-9 py-2 pl-9`} placeholder="Search product or store" /></label>
            </div>

            {deals.isLoading ? <div className={`${card} grid min-h-72 place-items-center text-center`}><div><RefreshCw className="mx-auto animate-spin text-emerald-600" size={24} /><p className="mt-3 text-sm font-semibold">Checking today’s D4D offers</p><p className="mt-1 text-xs text-slate-500">The rest of Kitchen stays available while deals load.</p></div></div>
              : deals.isError ? <div className={`${card} grid min-h-64 place-items-center p-6 text-center`}><div><AlertTriangle className="mx-auto text-rose-500" size={24} /><p className="mt-3 text-sm font-semibold">Deals are unavailable</p><p className="mt-1 text-xs text-slate-500">{errorMessage(deals.error)}</p><button type="button" onClick={() => void deals.refetch()} className={`${button} mt-4 border border-slate-200 dark:border-neutral-700`}><RefreshCw size={13} /> Try again</button></div></div>
              : visibleDeals.length === 0 ? <div className={`${card} grid min-h-64 place-items-center p-6 text-center`}><div><Tags className="mx-auto text-slate-300 dark:text-neutral-600" size={26} /><p className="mt-3 text-sm font-semibold">No matching discounted protein offers</p><p className="mt-1 text-xs text-slate-500">Refresh D4D or clear the current filters.</p></div></div>
              : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visibleDeals.map((deal, index) => <motion.article key={deal.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.025, 0.2) }} className={`${card} group overflow-hidden`}>
                <div className="flex gap-3 p-3.5">
                  <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-100 bg-slate-50 dark:border-neutral-800 dark:bg-neutral-950">{deal.imageUrl ? <img src={deal.imageUrl} alt="" loading="lazy" className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.04]" /> : <Tags size={22} className="text-slate-300 dark:text-neutral-600" />}</div>
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${deal.quality === 'excellent' ? 'bg-emerald-600 text-white' : deal.quality === 'good' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400'}`}>{deal.quality === 'excellent' ? 'Excellent deal' : deal.quality === 'good' ? 'Good deal' : 'Discount'}</span><span className="text-[10px] font-bold text-rose-600 dark:text-rose-400">−{deal.discountPct}%</span></div><h3 className="mt-2 text-sm font-semibold">{deal.category}</h3><p className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-4 text-slate-500 dark:text-neutral-400">{deal.description || 'See the flyer image for product details.'}</p><div className="mt-2 flex items-end gap-2"><span className="text-xl font-black tabular-nums tracking-[-0.04em] text-emerald-700 dark:text-emerald-400">{deal.priceSar.toFixed(2)}</span><span className="mb-0.5 text-[10px] font-semibold text-slate-500">SAR</span><span className="mb-0.5 text-xs tabular-nums text-slate-400 line-through">{deal.previousPriceSar.toFixed(2)}</span></div></div>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 bg-slate-50/60 px-3.5 py-3 text-[10px] text-slate-600 dark:border-neutral-800 dark:bg-neutral-950/30 dark:text-neutral-300"><span className="flex min-w-0 items-center gap-1.5"><Store size={12} className="shrink-0 text-emerald-600" /><span className="truncate">{deal.store}</span></span><span className="flex items-center gap-1.5"><MapPin size={12} className="shrink-0 text-emerald-600" />{deal.location}</span><span className="col-span-2 flex items-center justify-between gap-3"><span className="font-semibold text-slate-500 dark:text-neutral-400">Offer ends {deal.validTo ?? 'date not listed'}</span><a href={deal.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline dark:text-emerald-400">D4D <ExternalLink size={10} /></a></span></div>
              </motion.article>)}</div>}

            {deals.data?.refreshedAtUtc && <p className="mt-4 text-center text-[10px] text-slate-400">Last checked {new Date(deals.data.refreshedAtUtc).toLocaleString()} · Prices are copied from store flyers and may contain OCR errors.</p>}
          </div>
        )}

        {view === 'activity' && (
          <div className="mx-auto grid max-w-[1400px] gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <section className={`${card} overflow-hidden`}><div className="border-b border-slate-200 px-4 py-3 dark:border-neutral-800"><h2 className="text-sm font-semibold">Runway forecast</h2><p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">How much stock remains after repeating the planner for {data.forecast.horizonDays} days.</p></div><div className="space-y-5 p-4">{data.forecast.perFood.map((item) => { const food = data.foods.find((candidate) => candidate.id === item.foodId); if (!food) return null; const pct = food.availableQuantity > 0 ? (item.remainingAfterForecast / food.availableQuantity) * 100 : 0; return <div key={item.foodId}><div className="mb-2 flex items-center justify-between gap-4"><div><p className="text-sm font-semibold">{item.foodName}</p><p className="mt-0.5 text-[11px] text-slate-500 dark:text-neutral-400">{format(food.availableQuantity)} {food.unit} available now</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold tabular-nums ${item.projectedDepletionDate ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'}`}>{item.projectedDepletionDate ? `Runs out ${item.projectedDepletionDate}` : `${format(item.remainingAfterForecast)} ${food.unit} remains`}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800"><div className={`h-full rounded-full ${pct < 25 ? 'bg-rose-500' : pct < 50 ? 'bg-amber-500' : 'bg-teal-500'}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div></div>; })}{!data.foods.length && <div className="grid min-h-40 place-items-center text-center"><p className="text-sm text-slate-500 dark:text-neutral-400">Add food and stock to begin forecasting.</p></div>}</div></section>
            <section className={`${card} overflow-hidden`}><div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-800"><div><h2 className="text-sm font-semibold">Recent stock activity</h2><p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">Adds, corrections, consumption, and discarded stock.</p></div><CalendarClock size={16} className="text-slate-400" /></div>{data.movements.length > 0 ? <div className="divide-y divide-slate-100 dark:divide-neutral-800">{data.movements.slice(0, 16).map((movement) => { const food = data.foods.find((item) => item.id === movement.foodId); const canUndo = !movement.reversedAtUtc && !movement.planLineId && movement.reason !== 'restored'; return <div key={movement.id} className={`flex items-center gap-3 px-4 py-3 text-sm ${movement.reversedAtUtc ? 'opacity-45' : ''}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${movement.deltaQuantity > 0 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400'}`}>{movement.deltaQuantity > 0 ? <Plus size={13} /> : <Trash2 size={13} />}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{food?.name ?? 'Archived food'}</p><p className="mt-0.5 truncate text-[10px] capitalize text-slate-500 dark:text-neutral-400">{movement.reason.replace('_', ' ')}{movement.note ? ` · ${movement.note}` : ''} · {movement.dateLocal}</p></div><span className="shrink-0 text-xs font-semibold tabular-nums">{movement.deltaQuantity > 0 ? '+' : ''}{format(movement.deltaQuantity)} {food?.unit ?? ''}</span>{canUndo && <button type="button" disabled={undoMovement.isPending} onClick={() => void undoMovement.mutateAsync(movement.id)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-teal-600 dark:hover:bg-neutral-800" aria-label={`Undo ${movement.reason} movement`}><RotateCcw size={13} /></button>}</div>; })}</div> : <div className="grid min-h-64 place-items-center text-center"><div><History className="mx-auto text-slate-300 dark:text-neutral-600" size={24} /><p className="mt-3 text-sm font-semibold">No stock activity yet</p><p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Restocks and usage will appear here.</p></div></div>}</section>
          </div>
        )}
      </main>

      <AnimatePresence>
        {editingFood && <FoodEditor food={editingFood === 'new' ? null : editingFood} onClose={() => setEditingFood(null)} />}
        {stockFood && <StockEditor food={stockFood} onClose={() => setStockFood(null)} />}
        {adjusting && <AdjustmentEditor food={adjusting.food} portion={adjusting.portion} onClose={() => setAdjusting(null)} />}
        {planItemOpen && <PlanItemEditor foods={data.foods} dateLocal={data.dateLocal} onClose={() => setPlanItemOpen(false)} />}
        {settingsOpen && <Modal title="Kitchen settings" description="Set your daily maintenance targets and how far ahead Kitchen should forecast." onClose={() => setSettingsOpen(false)}><form onSubmit={(event) => { event.preventDefault(); void saveSettings.mutateAsync({ dailyProteinTarget: Number(proteinTarget), dailyCaloriesTarget: Number(calorieTarget), dailyCarbsTarget: Number(carbTarget), warningCoverageDays: Number(warningDays), forecastDays: Number(forecastDays) }).then(() => setSettingsOpen(false)); }} className="space-y-4 p-5"><div className="rounded-lg border border-teal-200 bg-teal-50/70 px-3 py-2.5 text-xs leading-5 text-teal-900 dark:border-teal-500/20 dark:bg-teal-500/[0.06] dark:text-teal-200"><p className="font-semibold">Maintenance starting point</p><p className="text-teal-800/80 dark:text-teal-300/80">2,500 kcal and 325 g carbs are provisional targets for 167 cm, 73 kg, and four active days per week. Adjust from your 2–3 week weight trend.</p></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><label><span className={label}>Protein (g)</span><input required min="1" step="0.1" type="number" value={proteinTarget} onChange={(e) => setProteinTarget(e.target.value)} className={field} /></label><label><span className={label}>Calories (kcal)</span><input required min="1" step="1" type="number" value={calorieTarget} onChange={(e) => setCalorieTarget(e.target.value)} className={field} /></label><label><span className={label}>Carbs (g)</span><input required min="0" step="0.1" type="number" value={carbTarget} onChange={(e) => setCarbTarget(e.target.value)} className={field} /></label></div><label><span className={label}>Warn when coverage falls below</span><div className="relative"><input required min="1" max="90" type="number" value={warningDays} onChange={(e) => setWarningDays(e.target.value)} className={`${field} pr-14`} /><span className="pointer-events-none absolute right-3 top-2.5 text-sm text-slate-400">days</span></div></label><label><span className={label}>Forecast horizon</span><div className="relative"><input required min="7" max="90" type="number" value={forecastDays} onChange={(e) => setForecastDays(e.target.value)} className={`${field} pr-14`} /><span className="pointer-events-none absolute right-3 top-2.5 text-sm text-slate-400">days</span></div></label><button disabled={saveSettings.isPending} className={`${button} w-full bg-teal-600 text-white hover:bg-teal-700`}><Check size={15} /> Save settings</button></form></Modal>}
      </AnimatePresence>
    </div>
  );
}
