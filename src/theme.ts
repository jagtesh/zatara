import { appearance, Appearance } from './config';
/** Static decoration: no animation loop or full-screen effects. */
export const theme = {
  bg: '#0c1220', panel: '#172236', border: '#35445f', text: '#e7eeff',
  muted: '#9baac4', accent: '#bba2f5', mint: '#6ee7c5',
  radius: 10, labelSize: 13, controlSize: 32,
  activeBorder: '#9481ba', inactiveBorder: '#45536b',
};
export const verticalGradient = (top: string, bottom: string) => ({
  from: [0, 0] as [number, number], to: [0, 1] as [number, number],
  stops: [{ at: 0, color: top }, { at: 1, color: bottom }],
});

export function applyAppearance(next: Appearance) {
  Object.assign(appearance, next);
  Object.assign(theme, { text: next.colors.text, muted: next.colors.muted, accent: next.colors.accent, activeBorder: next.colors.activeBorder, inactiveBorder: next.colors.inactiveBorder, labelSize: next.ui.fontSize });
}
