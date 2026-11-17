// Tracks whether the viewport is phone-sized. The breakpoint matches
// FORCE_MAXIMIZE_BELOW_PX in Desktop.jsx (768px) so the overlay sidebar,
// the header toggle and the 70% tool zoom all switch on at the same width
// that windows start force-maximizing. SSR-safe: returns false when there's
// no window (initial server render / tests using renderToString).
import { useEffect, useState } from 'react';

export const MOBILE_MAX_WIDTH_PX = 767;           // inclusive; i.e. < 768
const QUERY = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;

/** True on phone-width screens. Re-renders when crossing the breakpoint. */
export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    // Safari < 14 only supports the deprecated addListener API.
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
    setIsMobile(mql.matches);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, []);

  return isMobile;
}
