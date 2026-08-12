import { useEffect } from 'react';
import { checkFocusTimer } from '../lib/focusTimer.js';

export default function FocusTimerMonitor() {
  useEffect(() => {
    checkFocusTimer();
    const timer = window.setInterval(checkFocusTimer, 250);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}
