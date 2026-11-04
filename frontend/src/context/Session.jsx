// Session state lives in memory only. The reporter's secret and key, and the staff JWT, are never
// written to localStorage, sessionStorage or cookies. Reporter state clears after inactivity.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const Ctx = createContext(null);
export const REPORTER_IDLE_MS = 2 * 60 * 1000;
export const EXIT_URL = import.meta.env.VITE_EXIT_URL || "https://www.google.com/search?q=weather";

export function SessionProvider({ children }) {
  const [reporter, setReporterState] = useState(null); // { reportId, secret, wallet }
  const [staff, setStaff] = useState(null); // { token, user, expiresAt }
  const [justSubmitted, setJustSubmitted] = useState(null); // { reportId, secret, ... } shown once
  const [idleNotice, setIdleNotice] = useState(false);
  const lastActivity = useRef(Date.now());

  const setReporter = useCallback((r) => {
    lastActivity.current = Date.now();
    setIdleNotice(false);
    setReporterState(r);
  }, []);

  const clearAll = useCallback(() => {
    setReporterState(null);
    setStaff(null);
    setJustSubmitted(null);
  }, []);

  // Activity tracking and the inactivity timeout for reporter data.
  useEffect(() => {
    const touch = () => (lastActivity.current = Date.now());
    const events = ["pointerdown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const t = setInterval(() => {
      const idle = Date.now() - lastActivity.current > REPORTER_IDLE_MS;
      if (idle) {
        setReporterState((r) => {
          if (r) setIdleNotice(true);
          return null;
        });
        setJustSubmitted(null);
      }
      setStaff((s) => (s && s.expiresAt < Date.now() ? null : s));
    }, 10_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(t);
    };
  }, []);

  const quickExit = useCallback(() => {
    clearAll();
    window.location.replace(EXIT_URL); // replace: the Back button does not return here
  }, [clearAll]);

  // Escape key leaves immediately.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !e.defaultPrevented && quickExit();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quickExit]);

  const value = useMemo(
    () => ({ reporter, setReporter, staff, setStaff, justSubmitted, setJustSubmitted, idleNotice, setIdleNotice, quickExit, clearAll }),
    [reporter, setReporter, staff, justSubmitted, idleNotice, quickExit, clearAll]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
