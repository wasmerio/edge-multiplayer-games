// One player palette for every game. A game that needs a different look
// overrides the theme properties, never these eight.
export const PLAYER_COLOURS = [
  "#ff4b4b", "#4bff7a", "#4ba8ff", "#ffd24b",
  "#ff4bd8", "#4bfff0", "#ff9a4b", "#c04bff",
];
export const colourFor = (index) => PLAYER_COLOURS[index % PLAYER_COLOURS.length];
