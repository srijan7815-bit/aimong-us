/**
 * Canonical colour palette for player identities (PROD_QUA.md §1.2).
 *
 * Every colour carries a distinct `symbol` as well, so colour-blind players can
 * tell seats apart by the shape on the pod-bot's antenna and in the vote grid.
 * These values are authoring data, not art — the sprites are generated from them.
 */
export interface PlayerColor {
  id: string;
  name: string;
  hex: string;
  /** Shape drawn on the antenna tip; unique per colour. */
  symbol:
    | 'circle'
    | 'triangle'
    | 'square'
    | 'diamond'
    | 'star'
    | 'cross'
    | 'ring'
    | 'half'
    | 'bar'
    | 'dot'
    | 'chevron'
    | 'hex';
}

export const PLAYER_COLORS: readonly PlayerColor[] = [
  { id: 'red', name: 'Red', hex: '#E5484D', symbol: 'circle' },
  { id: 'blue', name: 'Blue', hex: '#3E63DD', symbol: 'triangle' },
  { id: 'green', name: 'Green', hex: '#30A46C', symbol: 'square' },
  { id: 'orange', name: 'Orange', hex: '#F76B15', symbol: 'diamond' },
  { id: 'purple', name: 'Purple', hex: '#8E4EC6', symbol: 'star' },
  { id: 'teal', name: 'Teal', hex: '#12A594', symbol: 'cross' },
  { id: 'yellow', name: 'Yellow', hex: '#FFC53D', symbol: 'ring' },
  { id: 'pink', name: 'Pink', hex: '#E93D82', symbol: 'half' },
  { id: 'brown', name: 'Brown', hex: '#A18072', symbol: 'bar' },
  { id: 'white', name: 'White', hex: '#D6D6D6', symbol: 'dot' },
  { id: 'black', name: 'Black', hex: '#3A3A3F', symbol: 'chevron' },
  { id: 'cyan', name: 'Cyan', hex: '#7CE2FE', symbol: 'hex' },
] as const;

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 12;
export const MAX_AI_SEATS = 9;

export function colorById(id: string): PlayerColor {
  return PLAYER_COLORS.find((c) => c.id === id) ?? PLAYER_COLORS[0]!;
}

/** First palette colour nobody at the table is wearing. */
export function pickFreeColor(taken: readonly string[]): PlayerColor {
  return PLAYER_COLORS.find((c) => !taken.includes(c.id)) ?? PLAYER_COLORS[0]!;
}
