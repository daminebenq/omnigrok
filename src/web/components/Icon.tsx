// Single source for UI glyphs. Keeps visible strings emoji-free and avoids
// hand-rolled inline SVG scattered through components.

export type IconName =
  | "chat"
  | "agents"
  | "files"
  | "projects"
  | "settings"
  | "mcp"
  | "browser"
  | "reasoning"
  | "vision"
  | "coding"
  | "audio"
  | "image"
  | "tools"
  | "plus"
  | "close"
  | "menu"
  | "send"
  | "stop"
  | "search"
  | "logo"
  | "spark"
  | "warning"
  | "check"
  | "copy"
  | "trash"
  | "upload"
  | "refresh"
  | "external";

const PATHS: Record<IconName, string> = {
  chat: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  agents: "M12 2a2 2 0 012 2v2h3a2 2 0 012 2v3h2a2 2 0 010 4h-2v3a2 2 0 01-2 2h-3v2a2 2 0 01-4 0v-2H7a2 2 0 01-2-2v-3H3a2 2 0 010-4h2V8a2 2 0 012-2h3V4a2 2 0 012-2z",
  files: "M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9zM13 2v7h7",
  projects: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  settings:
    "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z",
  mcp: "M5 12h14M5 12a2 2 0 01-2-2V7a2 2 0 012-2h14a2 2 0 012 2v3a2 2 0 01-2 2M5 12a2 2 0 00-2 2v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 00-2-2M7 8h.01M7 16h.01",
  browser: "M12 21a9 9 0 100-18 9 9 0 000 18zM3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 010 18 15 15 0 010-18z",
  reasoning:
    "M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96.44A2.5 2.5 0 014.5 17a2.5 2.5 0 01-1.98-4.04A2.5 2.5 0 014.5 8.5a2.5 2.5 0 012.54-4.06A2.5 2.5 0 019.5 2zM14.5 2A2.5 2.5 0 0012 4.5v15a2.5 2.5 0 004.96.44A2.5 2.5 0 0019.5 17a2.5 2.5 0 001.98-4.04A2.5 2.5 0 0019.5 8.5a2.5 2.5 0 00-2.54-4.06A2.5 2.5 0 0014.5 2z",
  vision: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z",
  coding: "M16 18l6-6-6-6M8 6l-6 6 6 6",
  audio: "M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z",
  image: "M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21",
  tools: "M14.7 6.3a4 4 0 01-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 015.4-5.4l-2.6 2.6-2.1-2.1z",
  plus: "M12 5v14M5 12h14",
  close: "M18 6L6 18M6 6l12 12",
  menu: "M3 6h18M3 12h18M3 18h18",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  stop: "M6 6h12v12H6z",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  logo: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  spark: "M12 3l1.9 5.8L20 10l-5.4 2.9L13 19l-2.4-5.4L5 12l5.4-2.2z",
  warning: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  check: "M20 6L9 17l-5-5",
  copy: "M8 8h10a2 2 0 012 2v10a2 2 0 01-2 2H8a2 2 0 01-2-2V10a2 2 0 012-2zM16 8V4a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2h4",
  trash: "M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6",
  upload: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12",
  refresh: "M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15",
  external: "M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3",
};

export const CAPABILITY_LABEL: Record<string, string> = {
  reasoning: "Reasoning",
  vision: "Vision",
  coding: "Coding",
  audio: "Audio",
  image: "Image generation",
  tools: "Tool use",
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
}

export function Icon({ name, size = 16, className = "", title }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
