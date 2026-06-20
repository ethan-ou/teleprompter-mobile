/*
  Central dark-mode palette. Keep all screen colors here instead of scattering
  hex literals so the app stays visually consistent.
*/

export const colors = {
  // Surfaces
  background: "#000000", // app + teleprompter base
  surface: "#121212", // cards, headers, control bar
  surfaceElevated: "#1E1E1E", // menus, inputs, pressed states
  border: "#2A2A2A",

  // Text
  text: "#FFFFFF",
  textMuted: "#9A9A9A",
  textFaint: "#5A5A5A",

  // Accents
  accent: "#0A84FF", // iOS dark-mode blue
  danger: "#FF453A",
  highlight: "#FFD700", // read-position highlight
  current: "#FFFFFF", // current word (distinct from highlight)
} as const;

export type Colors = typeof colors;
