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
    symbol: 'circle' | 'triangle' | 'square' | 'diamond' | 'star' | 'cross' | 'ring' | 'half' | 'bar' | 'dot' | 'chevron' | 'hex';
}
export declare const PLAYER_COLORS: readonly PlayerColor[];
export declare const MIN_PLAYERS = 5;
export declare const MAX_PLAYERS = 12;
export declare const MAX_AI_SEATS = 9;
export declare function colorById(id: string): PlayerColor;
/** First palette colour nobody at the table is wearing. */
export declare function pickFreeColor(taken: readonly string[]): PlayerColor;
