// Inline SVG icons. Kept in the bundle so the app loads no outside resources.
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
const Svg = ({ size = 24, children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...base} {...rest}>{children}</svg>
);

export const IconReport = (p) => <Svg {...p}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" /></Svg>;
export const IconShield = (p) => <Svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></Svg>;
export const IconBuilding = (p) => <Svg {...p}><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" /><path d="M16 9h2a2 2 0 0 1 2 2v10" /><path d="M8 7h4M8 11h4M8 15h4M2 21h20" /></Svg>;
export const IconExit = (p) => <Svg {...p} size={p.size ?? 18}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></Svg>;
export const IconDoc = (p) => <Svg {...p} size={p.size ?? 20}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></Svg>;
export const IconCheck = (p) => <Svg {...p} size={p.size ?? 20}><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></Svg>;
export const IconDeny = (p) => <Svg {...p} size={p.size ?? 20}><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></Svg>;
export const IconWarn = (p) => <Svg {...p} size={p.size ?? 20}><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></Svg>;
export const IconInfo = (p) => <Svg {...p} size={p.size ?? 20}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>;
export const IconArrow = (p) => <Svg {...p} size={p.size ?? 16}><path d="m9 6 6 6-6 6" /></Svg>;
export const IconLock = (p) => <Svg {...p}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Svg>;
export const IconKey = (p) => <Svg {...p}><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 8.2-8.2M17 6l2 2M14 9l2 2" /></Svg>;
export const IconClock = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const IconList = (p) => <Svg {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></Svg>;
