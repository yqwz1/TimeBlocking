import type { OnThisDayDTO } from '@timeblock/shared';

export default function OnThisDayCard({
  data,
  onOpenNote,
  embedded = false,
}: {
  data: OnThisDayDTO | undefined;
  onOpenNote: (id: string) => void;
  embedded?: boolean;
}) {
  return (
    <div className={`sb-on-this-day ${embedded ? 'is-embedded' : ''}`}>
      {!embedded && (
        <div className="sb-on-this-day-head">
          <div>
            <p>On this day</p>
            <span>Notes from one week, one month, and one year ago.</span>
          </div>
          <time>{data?.date ?? '...'}</time>
        </div>
      )}
      <div className="sb-on-this-day-buckets">
        {data?.buckets.map((bucket) => (
          <section key={bucket.label}>
            <div className="sb-on-this-day-label">
              <p>{bucket.label}</p>
              <time>{bucket.anchorDate}</time>
            </div>
            {bucket.notes.length === 0 ? (
              <p className="sb-on-this-day-empty">Nothing saved for that day.</p>
            ) : (
              <div className="sb-on-this-day-notes">
                {bucket.notes.slice(0, 3).map((note) => (
                  <button
                    key={`${bucket.label}-${note.id}`}
                    onClick={() => onOpenNote(note.id)}
                    className="sb-on-this-day-note"
                  >
                    <div className="min-w-0">
                      <p>{note.title}</p>
                      <span>{note.folder || 'Vault root'}</span>
                    </div>
                    {note.openTasks > 0 && <strong>{note.openTasks}</strong>}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
