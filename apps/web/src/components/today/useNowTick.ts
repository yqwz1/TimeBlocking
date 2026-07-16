import { useEffect, useState } from 'react';

/** Ticks a millisecond timestamp on an interval so live progress bars move between plan refetches. */
export function useNowTick(ms = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
