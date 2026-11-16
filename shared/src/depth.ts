/**
 * Escala de profundidade (raridade → pontos).
 * Os pontos aqui são os valores-base; o servidor é a única autoridade que os aplica.
 */
export type DepthTier = 1 | 2 | 3 | 4 | 5;

export interface DepthZone {
  tier: DepthTier;
  key: 'superficie' | 'aguas-rasas' | 'zona-intermediaria' | 'zona-profunda' | 'abismo';
  label: string;
  rarity: string;
  points: number;
  /** Profundidade (metros) usada na animação de descida. */
  meters: number;
}

export const DEPTH_ZONES: readonly DepthZone[] = [
  { tier: 1, key: 'superficie', label: 'Superfície', rarity: 'Muito comum', points: 50, meters: 10 },
  { tier: 2, key: 'aguas-rasas', label: 'Águas rasas', rarity: 'Comum', points: 100, meters: 120 },
  { tier: 3, key: 'zona-intermediaria', label: 'Zona intermediária', rarity: 'Incomum', points: 200, meters: 800 },
  { tier: 4, key: 'zona-profunda', label: 'Zona profunda', rarity: 'Rara', points: 350, meters: 3200 },
  { tier: 5, key: 'abismo', label: 'Abismo', rarity: 'Muito rara', points: 500, meters: 6800 },
] as const;

export function zoneForTier(tier: DepthTier): DepthZone {
  return DEPTH_ZONES[tier - 1]!;
}
