/**
 * Cosmetics (M3.5) — original look-only items.
 *
 * Everything here is drawn from scratch in code (the client builds each hat,
 * skin pattern, pet and nameplate out of primitives); there is no art file and
 * nothing is derived from any commercial game. Items are pure decoration: the
 * server stores them so other people can see them and never lets them touch a
 * rule. Ids are stable strings so a saved profile survives a redeploy.
 */

export type HatId = 'none' | 'beanie' | 'halo' | 'crest' | 'visor' | 'crown' | 'sprout';
export type SkinId = 'plain' | 'stripe' | 'patched' | 'freckled';
export type PetId = 'none' | 'mote' | 'pup' | 'drone';
export type NameplateId = 'plain' | 'underline' | 'badge';

export interface CosmeticOption<T extends string> {
  id: T;
  name: string;
  /** One line shown in the picker. */
  hint: string;
}

export const HATS: ReadonlyArray<CosmeticOption<HatId>> = [
  { id: 'none', name: 'None', hint: 'bare antenna' },
  { id: 'beanie', name: 'Beanie', hint: 'a warm cap' },
  { id: 'halo', name: 'Halo', hint: 'a floating ring' },
  { id: 'crest', name: 'Crest', hint: 'a little fin' },
  { id: 'visor', name: 'Brim', hint: 'a hard brim' },
  { id: 'crown', name: 'Crown', hint: 'jungle-queen energy' },
  { id: 'sprout', name: 'Sprout', hint: 'two small leaves' },
];

export const SKINS: ReadonlyArray<CosmeticOption<SkinId>> = [
  { id: 'plain', name: 'Plain', hint: 'factory finish' },
  { id: 'stripe', name: 'Stripe', hint: 'a racing band' },
  { id: 'patched', name: 'Patched', hint: 'welded plates' },
  { id: 'freckled', name: 'Freckled', hint: 'dust from the vents' },
];

export const PETS: ReadonlyArray<CosmeticOption<PetId>> = [
  { id: 'none', name: 'None', hint: 'travel light' },
  { id: 'mote', name: 'Mote', hint: 'a drifting spark' },
  { id: 'pup', name: 'Pup', hint: 'follows your boot' },
  { id: 'drone', name: 'Drone', hint: 'hums beside you' },
];

export const NAMEPLATES: ReadonlyArray<CosmeticOption<NameplateId>> = [
  { id: 'plain', name: 'Plain', hint: 'just your name' },
  { id: 'underline', name: 'Underline', hint: 'a thin rule' },
  { id: 'badge', name: 'Badge', hint: 'a soft plate' },
];

export interface Cosmetics {
  hat: HatId;
  skin: SkinId;
  pet: PetId;
  nameplate: NameplateId;
}

export const DEFAULT_COSMETICS: Cosmetics = {
  hat: 'none',
  skin: 'plain',
  pet: 'none',
  nameplate: 'plain',
};

function pick<T extends string>(options: ReadonlyArray<CosmeticOption<T>>, value: unknown, fallback: T): T {
  const found = options.find((option) => option.id === value);
  return found ? found.id : fallback;
}

/**
 * Coerce an untrusted cosmetics patch into a valid set. Anything unknown falls
 * back to the matching default rather than throwing: a stale client should get
 * plain clothes, not a dropped connection.
 */
export function readCosmetics(raw: unknown, base: Cosmetics = DEFAULT_COSMETICS): Cosmetics {
  const patch = (raw ?? {}) as Partial<Record<keyof Cosmetics, unknown>>;
  return {
    hat: pick(HATS, patch.hat, base.hat),
    skin: pick(SKINS, patch.skin, base.skin),
    pet: pick(PETS, patch.pet, base.pet),
    nameplate: pick(NAMEPLATES, patch.nameplate, base.nameplate),
  };
}

/** Compact label for the lobby list: "Beanie · Stripe · Pup". */
export function describeCosmetics(cosmetics: Cosmetics): string {
  const hat = HATS.find((h) => h.id === cosmetics.hat)?.name ?? 'None';
  const skin = SKINS.find((s) => s.id === cosmetics.skin)?.name ?? 'Plain';
  const pet = PETS.find((p) => p.id === cosmetics.pet)?.name ?? 'None';
  return `${hat} · ${skin} · ${pet}`;
}
