/**
 * Clock colour themes (background + text). Pure + unit-tested; exposed via preload.
 * `auto` tints to the current holiday (caller passes the active holiday key).
 */

const THEMES = [
  { key: 'auto',    name: 'Auto (by holiday)', bg: '#0d1117', text: '#ffffff' },
  { key: 'dark',    name: 'Dark',              bg: '#0d1117', text: '#ffffff' },
  { key: 'light',   name: 'Light',             bg: '#ffffff', text: '#111111' },
  // Colourful
  { key: 'midnight', name: 'Midnight Blue',    bg: '#0b1026', text: '#cfe3ff' },
  { key: 'ocean',    name: 'Ocean',            bg: '#013a63', text: '#caf0f8' },
  { key: 'sunset',   name: 'Sunset',           bg: '#2d132c', text: '#ffd6a5' },
  { key: 'forest',   name: 'Forest',           bg: '#0b2e1a', text: '#d8f3dc' },
  // High-contrast
  { key: 'contrast', name: 'Black / Yellow',   bg: '#000000', text: '#ffeb3b' },
  { key: 'terminal', name: 'Terminal Green',   bg: '#000000', text: '#39ff14' },
  { key: 'amber',    name: 'Amber',            bg: '#000000', text: '#ffbf00' },
  // Brand
  { key: 'rccg',     name: 'RCCG (Purple/Gold)', bg: '#3b1f5e', text: '#ffd700' },
];

const THEME_MAP = Object.fromEntries(THEMES.map(t => [t.key, t]));

// Holiday → theme palette for the `auto` theme.
const HOLIDAY_THEME = {
  christmas: { bg: '#1b4332', text: '#ffccd5' },
  advent:    { bg: '#1b4332', text: '#ffccd5' },
  newyear:   { bg: '#0d0d0d', text: '#ffd700' },
  easter:    { bg: '#fff0f6', text: '#6a0572' },
  'palm-sunday': { bg: '#0b2e1a', text: '#fff0b3' },
  epiphany:  { bg: '#0b1026', text: '#ffe066' },
  pentecost: { bg: '#2b0a00', text: '#ff7b00' },
};

/**
 * Resolve a theme key (+ optional active holiday key for `auto`) to { bg, text }.
 */
function resolveTheme(themeKey, holidayKey) {
  if (themeKey === 'auto') {
    const t = (holidayKey && HOLIDAY_THEME[holidayKey]) || THEME_MAP.dark;
    return { bg: t.bg, text: t.text };
  }
  const t = THEME_MAP[themeKey] || THEME_MAP.dark;
  return { bg: t.bg, text: t.text };
}

module.exports = { THEMES, resolveTheme };
