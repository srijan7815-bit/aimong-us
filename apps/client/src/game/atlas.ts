/**
 * Swappable art atlas.
 *
 * The client never hard-codes frame coordinates: it fetches a manifest and asks
 * for frames by name. Replacing the placeholder art later = publish a folder with
 * the same manifest shape and set `VITE_ATLAS` at build time.
 */
export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasManifest {
  name: string;
  version: number;
  tileSize: number;
  image: string;
  imageWidth: number;
  imageHeight: number;
  frames: Record<string, AtlasFrame>;
}

const ATLAS_DIR = (import.meta.env.VITE_ATLAS as string | undefined) ?? 'placeholder';

export function atlasBaseUrl(): string {
  return `${import.meta.env.BASE_URL}assets/atlas/${ATLAS_DIR}/`;
}

export async function loadAtlasManifest(): Promise<AtlasManifest> {
  const base = atlasBaseUrl();
  const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`atlas manifest missing at ${base}manifest.json`);
  const manifest = (await res.json()) as AtlasManifest;
  if (!manifest.frames?.floor || !manifest.frames?.wall) {
    throw new Error('atlas manifest needs at least "floor" and "wall" frames');
  }
  return manifest;
}

/** Texture key Phaser loads the atlas image under. */
export const ATLAS_TEXTURE = 'atlas';
