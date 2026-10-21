const s = (body) => `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICON = {
  wicks: s('<line x1="9" y1="1" x2="9" y2="17"/><rect x="6" y="12" width="6" height="4" fill="currentColor"/>'),
  delta: s('<rect x="3" y="3" width="4" height="12" fill="currentColor"/><rect x="11" y="9" width="4" height="6"/>'),
  dirMatch: s('<path d="M3 12l3-4 3 4M9 12l3-4 3 4"/>'),
  z: s('<path d="M1 14h4l2-12 2 12h8"/>'),
  vwap: s('<path d="M1 13c3-7 5-7 8 0s5 7 8 0"/><line x1="1" y1="9" x2="17" y2="9" stroke-dasharray="2 2"/>'),
  impulse: s('<rect x="6" y="2" width="6" height="14" fill="currentColor"/><line x1="15" y1="2" x2="15" y2="16"/>'),
  bb: s('<path d="M1 4c5 3 11 3 16 0M1 14c5-3 11-3 16 0"/><circle cx="9" cy="9" r="1.6" fill="currentColor"/>'),
  uo: s('<path d="M2 14a7 7 0 0 1 14 0"/><line x1="9" y1="14" x2="13" y2="8"/>'),
  lrs: s('<line x1="2" y1="15" x2="16" y2="3"/><circle cx="5" cy="13" r="1" fill="currentColor"/><circle cx="9" cy="8" r="1" fill="currentColor"/><circle cx="13" cy="6" r="1" fill="currentColor"/>'),
  smi: s('<path d="M1 13c4-9 9-9 16-5"/><path d="M1 8c6 1 10 6 16 3" stroke-dasharray="2 2"/>'),
  ao: s('<line x1="3" y1="9" x2="3" y2="5"/><line x1="7" y1="9" x2="7" y2="2"/><line x1="11" y1="9" x2="11" y2="13"/><line x1="15" y1="9" x2="15" y2="16"/>'),
  aoFlip: s('<line x1="4" y1="9" x2="4" y2="15"/><line x1="9" y1="9" x2="9" y2="12"/><line x1="14" y1="9" x2="14" y2="3"/><path d="M2 5l3-3 3 3"/>'),
  box: s('<rect x="3" y="5" width="12" height="8" stroke-dasharray="2 2"/><path d="M15 9h3"/>'),
  wave: s('<path d="M1 9c2-6 4-6 6 0s4 6 6 0 3-4 4-2"/>'),
  sound: s('<path d="M3 7h3l4-3v10l-4-3H3z"/><path d="M13 6a4 4 0 0 1 0 6"/>'),
  moon: s('<path d="M13 12A6 6 0 0 1 7 3a6 6 0 1 0 6 9z"/>'),
};
