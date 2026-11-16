export interface CharacterDef {
  id: string;
  name: string;
  /** Cor principal (facetas claras) e secundária (facetas escuras). */
  primary: string;
  secondary: string;
  accent: string;
  trait: string;
}

export const CHARACTERS: readonly CharacterDef[] = [
  { id: 'tubarao', name: 'Tubarão', primary: '#5B8FD6', secondary: '#2E5A9E', accent: '#E8F1FF', trait: 'Faro para respostas de sangue frio' },
  { id: 'polvo', name: 'Polvo', primary: '#F0436B', secondary: '#B0204A', accent: '#FFD1DC', trait: 'Oito braços, oito ideias' },
  { id: 'baleia', name: 'Baleia', primary: '#3C6FB5', secondary: '#21467F', accent: '#BFD8F5', trait: 'Memória do tamanho do oceano' },
  { id: 'golfinho', name: 'Golfinho', primary: '#7DB3E0', secondary: '#4A82B8', accent: '#EAF5FF', trait: 'Ecolocaliza a resposta certa' },
  { id: 'tartaruga', name: 'Tartaruga', primary: '#4CB07A', secondary: '#2C7550', accent: '#C9A86A', trait: 'Devagar e sempre, até o fundo' },
  { id: 'agua-viva', name: 'Água-viva', primary: '#B78BFF', secondary: '#7957D5', accent: '#F1E6FF', trait: 'Brilha onde ninguém mais vê' },
  { id: 'peixe-palhaco', name: 'Peixe-palhaço', primary: '#FF8A2B', secondary: '#D45E0A', accent: '#FFFFFF', trait: 'Sério quando precisa' },
  { id: 'raia', name: 'Raia', primary: '#2FB7C8', secondary: '#147886', accent: '#D7FAFF', trait: 'Plana sobre o óbvio' },
  { id: 'lula', name: 'Lula', primary: '#FF7A9C', secondary: '#C94468', accent: '#FFE3EA', trait: 'Solta tinta nas respostas fáceis' },
  { id: 'caranguejo', name: 'Caranguejo', primary: '#F2553A', secondary: '#B3321D', accent: '#FFD7CC', trait: 'Anda de lado, pensa diferente' },
  { id: 'cavalo-marinho', name: 'Cavalo-marinho', primary: '#F5C542', secondary: '#C4931A', accent: '#FFF4CF', trait: 'Elegância sob pressão' },
  { id: 'peixe-abissal', name: 'Peixe-abissal', primary: '#35E0C1', secondary: '#0E3B4A', accent: '#FFF59A', trait: 'Leva a própria luz ao abismo' },
] as const;

export const CHARACTER_IDS = CHARACTERS.map((c) => c.id);

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]!;
}
