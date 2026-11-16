/**
 * Camada complementar — juiz semântico por IA (OPCIONAL, desligado por padrão).
 *
 * Só é consultado quando a resposta NÃO está na base, NÃO é entidade conhecida
 * de outra categoria e NÃO casou por fuzzy. Mesmo aprovada pela IA, a resposta:
 *   • recebe no máximo a raridade "Incomum" (teto anti-abuso);
 *   • vai para a fila de revisão (tabela unmatched_answers) para curadoria.
 * Se a IA falhar, demorar ou não estiver configurada, a resposta é inválida —
 * o jogo nunca depende dela para funcionar.
 */
export interface SemanticVerdict {
  valid: boolean;
  confidence: number;
  canonical?: string;
}

export interface SemanticJudge {
  readonly name: string;
  judge(input: { prompt: string; category: string; answer: string }, signal: AbortSignal): Promise<SemanticVerdict | null>;
}

export const AI_MIN_CONFIDENCE = 0.9;

export class AnthropicJudge implements SemanticJudge {
  readonly name = 'anthropic';
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async judge(input: { prompt: string; category: string; answer: string }, signal: AbortSignal): Promise<SemanticVerdict | null> {
    const system =
      'Você é o juiz rigoroso de um jogo de conhecimento. Decida se a resposta do jogador é um exemplo REAL e CORRETO ' +
      'da categoria pedida. Rejeite piadas, palavras genéricas, coisas inventadas, ou itens apenas relacionados ao tema. ' +
      'Responda SOMENTE com JSON: {"valid": boolean, "confidence": número de 0 a 1, "canonical": "nome correto"}.';
    const body = {
      model: this.model,
      max_tokens: 100,
      system,
      messages: [
        {
          role: 'user',
          content: `Categoria: ${input.prompt} (nicho: ${input.category})\nResposta do jogador: ${JSON.stringify(input.answer)}`,
        },
      ],
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
    return parseVerdict(text);
  }
}

export function parseVerdict(text: string): SemanticVerdict | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Partial<SemanticVerdict>;
    if (typeof j.valid !== 'boolean' || typeof j.confidence !== 'number') return null;
    return {
      valid: j.valid,
      confidence: Math.max(0, Math.min(1, j.confidence)),
      canonical: typeof j.canonical === 'string' ? j.canonical.slice(0, 60) : undefined,
    };
  } catch {
    return null;
  }
}
