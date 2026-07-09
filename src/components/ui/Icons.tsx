import type { SVGProps } from "react";

const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Icon = {
  Dashboard: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p}><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>
  ),
  Bank: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p}><path d="M3 10l9-6 9 6"/><path d="M5 10v8"/><path d="M19 10v8"/><path d="M9 10v8"/><path d="M15 10v8"/><path d="M3 20h18"/></svg>
  ),
  Folder: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
  ),
  Cog: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
  ),
  Upload: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>
  ),
  Sparkles: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p} width={16} height={16}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>
  ),
  Search: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p} width={16} height={16}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
  ),
  Plus: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p} width={16} height={16}><path d="M12 5v14M5 12h14"/></svg>
  ),
  Check: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p} width={14} height={14}><path d="M20 6L9 17l-5-5"/></svg>
  ),
  User: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6"/></svg>
  ),
  Logout: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p} width={16} height={16}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
  ),
  File: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p} width={16} height={16}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>
  ),
  Download: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p} width={16} height={16}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
  ),
  Link: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p} width={14} height={14}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
  ),
  Close: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p} width={16} height={16}><path d="M18 6L6 18M6 6l12 12"/></svg>
  ),
  Warning: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p} width={16} height={16}><path d="M12 2L1 21h22L12 2z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
  ),
  Chevron: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p} width={14} height={14}><path d="M9 18l6-6-6-6"/></svg>
  ),
  Refresh: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p} width={14} height={14}><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10"/><path d="M20.5 15a9 9 0 0 1-14.9 3.4L1 14"/></svg>
  ),
  Menu: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p} width={20} height={20}><path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/></svg>
  ),
  Camera: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base} {...p} width={22} height={22}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
  ),
};
