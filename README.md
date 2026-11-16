# ABYSS — o jogo em que respostas raras valem mais

Jogo de conhecimento multiplayer online para 2 a 35 jogadores. A cada rodada aparece uma categoria (“Animal marinho”, “Vencedor do Oscar de Melhor Filme”, “Pokémon”…). Todo mundo responde ao mesmo tempo, e **quanto mais rara a resposta, mais fundo ela desce no oceano e mais pontos vale**.

| Raridade | Profundidade | Pontos |
|---|---|---|
| Muito comum | Superfície | 50 |
| Comum | Águas rasas | 100 |
| Incomum | Zona intermediária | 200 |
| Rara | Zona profunda | 350 |
| Muito rara | Abismo | 500 |

![Resultado da rodada](docs/screenshots/13-resultado-r1-desktop.png)

---

## Como rodar

Requisito: **Node.js 22.5 ou mais novo** (usa o SQLite nativo do Node). Nenhum outro serviço é obrigatório.

```bash
npm install            # instala tudo (monorepo com workspaces)
npm run build          # compila o cliente (Vite) e o servidor (esbuild)
npm start              # http://localhost:3000
```

Abra `http://localhost:3000` em dois navegadores (ou no celular, na mesma rede, usando o IP do computador). Crie a sala em um e entre com o código, ou pelo link de convite, no outro.

**Desenvolvimento** (recarga automática): `npm run dev`. O cliente sobe em `:5173` e o servidor em `:3000`, com proxy do Vite.

### Variáveis de ambiente (todas opcionais)

| Variável | Para quê | Padrão |
|---|---|---|
| `PORT` | Porta HTTP | `3000` |
| `DATABASE_URL` | Usa **PostgreSQL** (`postgres://usuario:senha@host:5432/banco`). As tabelas são criadas sozinhas. | vazio ⇒ SQLite |
| `SQLITE_FILE` | Caminho do banco SQLite embutido | `server/data/abyss.sqlite` |
| `ANTHROPIC_API_KEY` | Liga a camada complementar de validação por IA (ver abaixo) | desligada |
| `ABYSS_AI_MODEL` | Modelo usado pela camada de IA | `claude-haiku-5-5` |
| `ABYSS_PRIOR_STRENGTH` | Peso da raridade cadastrada frente ao histórico real | `40` |
| `ABYSS_TIME_SCALE` | Acelera/desacelera os tempos (útil em testes; `0.5` = metade) | `1` |
| `CORS_ORIGIN` | Origem permitida se o cliente for servido de outro domínio | mesma origem |

---

## Arquitetura

```
abyss/
├── shared/   tipos e contrato de eventos (cliente ⇄ servidor), personagens, escala de profundidade
├── server/   Node + TypeScript + Express + Socket.IO
│   ├── src/questions/    parser e verificador do banco de perguntas
│   ├── src/validation/   normalização, fuzzy, validador híbrido, juiz de IA opcional
│   ├── src/scoring/      raridade baseada em dados + pontuação da rodada
│   ├── src/rooms/        Room (motor da partida) e RoomManager (salas, sessões, reconexão)
│   ├── src/realtime/     handlers Socket.IO, validação zod, limitação de taxa
│   ├── src/persistence/  PostgreSQL · SQLite · memória (mesmo contrato)
│   ├── data/questions/   151 perguntas em arquivos .abyss
│   └── test/             69 testes (unidade, integração multiplayer, persistência)
├── client/   React + TypeScript + Vite + Tailwind CSS + Framer Motion
└── e2e/      teste com dois navegadores reais (Playwright + Chrome)
```

**O servidor é a única autoridade.** O cliente só envia intenções (criar, entrar, responder). Relógio, fases, validação, raridade e pontos são decididos no servidor. O cliente recebe a pergunta (nunca o gabarito) e um prazo absoluto `phaseEndsAt`. A contagem regressiva é desenhada com o relógio sincronizado (mediana de 5 medições de ida e volta), mas quem bloqueia respostas atrasadas é o servidor.

Ciclo da partida: `lobby → starting (3,5 s) → [question → reveal → leaderboard] × 10 → finished`. Quando todos os conectados já responderam, a rodada fecha antes do tempo.

---

## Validação de respostas

Cada resposta passa por camadas, em ordem. **Na dúvida, rejeita**: falso positivo é pior que falso negativo.

1. **Normalização**: acentos, caixa, pontuação, hífens e artigo inicial (“O Tubarão” ≡ “tubarao”). `C++` e `C#` não colapsam para `C`.
2. **Base de conhecimento**: nome canônico mais sinônimos, nomes populares, regionais, científicos e siglas (`baleia-assassina` → orca, `Mola mola` → peixe-lua, `CR7`, `EUA`, `Fe`), mais forma singular (“tubarões”) e forma junta (“cavalomarinho”).
3. **Chave fonética** PT-BR, só se apontar para uma única resposta: `brazil` → Brasil, `xita` → chita.
4. **Guarda semântica**: se o texto é uma entidade *conhecida* de outra categoria (há ~32 mil no léxico global, mais palavras comuns em `data/lexicon.txt`), é recusado e o fuzzy nem roda. Assim “Carro” em “Animal marinho” é inválido, e “rato” não vira “pato” em “Ave”.
5. **Fuzzy controlado**: Damerau-Levenshtein com limite pelo tamanho (até 4 letras exige grafia exata; até 7, 1 erro; até 13, 2 erros). Recusa se há empate entre duas respostas ou se algo de outra categoria está igualmente perto.
6. **Rejeições explicadas** cadastradas por pergunta: “tubarão” em *Mamífero marinho* → “é um peixe”; “Rio de Janeiro” em *Capital de país* → “foi capital até 1960; hoje é Brasília”. O jogador vê a explicação.
7. **IA (opcional, desligada por padrão)**: só é consultada para o que não está na base e não é entidade conhecida. Aprovação exige confiança ≥ 0,9, recebe no máximo a raridade “Incomum” (teto anti-abuso), tem timeout de 2,5 s e vai para a fila de curadoria. Sem chave, ou se a API falhar, o jogo funciona normalmente.

Toda resposta não reconhecida é registrada em `unmatched_answers` (contagem, exemplo, veredito da IA). É a fila para curadores adicionarem respostas válidas que faltaram.

**Números medidos nos testes automatizados:**
- **Falsos positivos**: 1 em 4.342 tentativas (0,02%) de responder uma pergunta com nomes de outra categoria.
- **Erros de digitação recuperados**: 96,2% (1.162 de 1.208) apagando uma letra de respostas com 8+ caracteres.

## Raridade baseada em dados

Cada resposta tem uma raridade cadastrada (1 a 5), que funciona como *prior* bayesiano. Toda rodada jogada grava a frequência real de cada resposta (`answer_stats`), e essa frequência sobrevive a reinícios.

```
evidência(i) = K · prior(i) + contagem_histórica(i)        (K = ABYSS_PRIOR_STRENGTH)
r(i)         = evidência(i) / max(evidência)               popularidade relativa
r ≥ 0,50 Superfície · ≥ 0,20 Águas rasas · ≥ 0,08 Intermediária · ≥ 0,03 Profunda · abaixo: Abismo
```

Sem histórico, a escala reproduz a curadoria. Com o tempo, os dados mandam: se todo mundo começar a responder “narval”, ele sobe e deixa de valer 500. A frequência só é atualizada **depois** de pontuar a rodada.

**Respostas repetidas na mesma rodada** (configurável pelo anfitrião):
- *Dividir o oceano* (padrão): multiplicador `1 / (1 + 0,35·(n−1))`, com piso de 0,3.
- *Sem penalidade*: mantém a pontuação integral.
- *Só o que é único*: resposta repetida vale zero.

Respostas inválidas valem zero e não contam como repetição.

---

## Banco de perguntas

**151 perguntas, 24 nichos, 32.561 respostas e 8.670 aliases.** Média de ~215 respostas por pergunta, mínimo de 20. Distribuição de raridade 1→5: 1.579 / 9.176 / 12.574 / 6.809 / 2.423.

Os arquivos ficam em `server/data/questions/*.abyss`, num formato de texto feito para curadores:

```
categoria: Oceanos e vida marinha             ← padrão para o arquivo inteiro
fonte: WoRMS — World Register of Marine Species

@ mar-animal-marinho                           ← ID único
enunciado: Animal marinho
revisao: revisado                              ← revisado | pendente
rejeitar: boto (o boto-cor-de-rosa vive em rios); jacaré (vive em água doce)
1: tubarão|shark; baleia|whale; polvo           ← raridade 1 = muito comum
5: peixe-ogro|anoplogaster|anoplogaster cornuta ← raridade 5 = muito rara
```

O primeiro nome é o exibido; os demais (separados por `|`) são sinônimos e aliases. **Para adicionar perguntas ou respostas, basta editar os arquivos**, sem tocar no código. Depois rode:

```bash
npm run questions:check   # IDs, mínimo de respostas, alias ambíguo, conflito aceito×rejeitado, fonte…
```

O servidor se recusa a subir se o banco tiver erro. Avisos (por exemplo, pergunta sem resposta de raridade 4–5) não bloqueiam.

> **Sobre o status de revisão:** o conteúdo foi montado por mim (Claude) a partir de conhecimento geral, citando a referência de cada pergunta. Removi automaticamente os itens que marquei como incertos durante a escrita (mais de 4.700). `revisado` quer dizer que passou por essa curadoria e pelo verificador; não é uma revisão humana item a item. Uma pergunta (“Vencedor do Oscar de Melhor Filme”) está como `pendente` porque a lista vai só até a cerimônia de 2025. Recomendo uma revisão humana das perguntas de pessoas (jogadores, técnicos, atletas), que são as mais sujeitas a erro, usando a fila `unmatched_answers` para descobrir lacunas.

---

## Multiplayer e segurança

- Salas com código de 5 caracteres sem ambiguidade (`0/O`, `1/I/L` excluídos), gerado com `crypto.randomInt`. O criador é o anfitrião.
- Mínimo de 2 e máximo de 35 jogadores. Ninguém entra depois do início (o 36º recebe `ROOM_FULL`; um atrasado recebe `MATCH_IN_PROGRESS`).
- Cada jogador tem um `playerId` público e um `sessionToken` secreto (192 bits) que nunca é enviado aos outros. Nomes iguais são permitidos; nome vazio vira **ANÔNIMO**.
- **Reconexão**: o token fica no `sessionStorage`. Ao reconectar (queda de rede ou recarregar a página), o jogador volta com a mesma identidade, pontos e resposta da rodada. Abrir a mesma sessão em outra aba derruba a anterior. O cliente detecta `offline` do navegador e mostra “Reconectando…” na hora.
- Desconectado no lobby por mais de 45 s sai da sala. Na partida, a vaga é mantida (quem não responde recebe zero). Se o anfitrião sai, outro jogador assume. Sala sem ninguém conectado por 5 min é encerrada.
- Todo evento do cliente exige callback de confirmação, é validado com **zod** (payload malformado ⇒ `INVALID_PAYLOAD`) e passa por **limitação de taxa** (token bucket por socket; criação de salas limitada por IP; `/api` limitado por IP).
- Uma resposta por jogador por rodada (`ALREADY_ANSWERED`); resposta fora do prazo ou da rodada certa ⇒ `ROUND_CLOSED`.
- Texto livre é sanitizado (caracteres de controle e invisíveis removidos, tamanho limitado). React escapa a saída. Helmet com CSP restritiva. Mensagens Socket.IO limitadas a 8 KB.
- O estado público nunca contém respostas, aliases ou raridades. Isso é verificado em teste.

---

## Testes

```bash
npm test                                              # 69 testes (vitest)
PG_TEST_URL=postgres://u:s@localhost/db npm test      # inclui o teste de PostgreSQL
npm run build && npm start                            # em outro terminal:
python3 e2e/full_match.py                             # E2E com 2 navegadores (requer playwright + Chrome)
```

| Área | O que é testado |
|---|---|
| Validação (41) | os 11 exemplos do enunciado, “Carro” inválido, sinônimos, nomes científicos, acentos, plural, siglas, grafia junta, erros de digitação, C/C++/C#, respostas raras, fora da categoria, rejeições explicadas, lixo/vazio, ambiguidade, varredura de falsos positivos e de recall, integridade do banco, IA (aprovação, teto, timeout, erro, nunca consultada para entidades conhecidas) |
| Pontuação (9) | prior reproduz a curadoria, histórico muda a raridade, carga de estatísticas, limiares, comum × rara × inválida, três regras de duplicadas |
| Multiplayer (16) | criação e entrada por código, nomes iguais, ANÔNIMO, saída, **35 entram e o 36º é recusado**, permissões do anfitrião, mínimo de 2, entrada após início, payload forjado, evento sem ack, rate limit, **partida de 2 jogadores com 10 rodadas** (mesma pergunta e prazo para todos, sem vazamento de gabarito, resposta repetida, rodada errada, inválida = 0, soma dos pontos = placar final, pódio, persistência, reiniciar), **35 respondendo simultaneamente** com duplicadas penalizadas e resultado idêntico para os 35, resposta após o tempo, desconexão e reconexão mantendo pontos, token inválido, sessão em outra aba, remoção no lobby, troca de anfitrião, **35 jogadores jogando as 10 rodadas até o pódio** |
| Persistência (3) | SQLite (inclusive após reabrir), PostgreSQL 16 real, partida completa gravando e recarregando o histórico |
| **E2E** | Desktop e celular em Chrome real: tela inicial, personagem, nome, menu, criar sala, convite por link, lobby, contagem, 10 rodadas (resposta rara em caixa alta, erro de digitação, resposta absurda recusada), **queda de rede no meio da rodada 5 e volta**, classificação, pódio, jogar de novo, sair |

---

## Registro do desenvolvimento

**Concluído**
- Monorepo com tipos compartilhados; servidor autoritativo com Socket.IO; 12 telas no cliente
- Motor de validação híbrido em 7 camadas, com IA opcional e fila de curadoria
- Raridade bayesiana alimentada pelo histórico real e três regras de duplicadas
- 151 perguntas em 24 nichos, mais verificador de banco
- Persistência PostgreSQL, SQLite e memória, com o mesmo contrato
- 12 personagens low-poly originais em SVG; oceano animado com a profundidade dirigindo cor, luz, partículas, bioluminescência, cânion e leito marinho; animação própria para cada zona (ondas na superfície, cardume, águas-vivas, faíscas bioluminescentes, peixe-abissal no Abismo); pódio com subida dos personagens
- Responsivo (pensado primeiro para celular), foco visível, `prefers-reduced-motion`
- 69 testes automatizados mais o E2E com 2 navegadores, todos passando

**Limitações conhecidas e próximos passos**
- As salas ficam na memória de um único processo: reiniciar o servidor encerra partidas em andamento (o histórico de raridade fica salvo). Para escalar horizontalmente: adaptador Redis do Socket.IO com sessões fixas, ou estado das salas no Redis.
- A camada de IA foi testada com um juiz simulado; a chamada real à API não foi exercitada neste ambiente.
- O conteúdo precisa de revisão humana (ver “Sobre o status de revisão”).
- Optei por SQL direto (`pg` + `node:sqlite`) em vez de Prisma para não depender de binários baixados no `npm install` e manter o modo sem serviços externos. O esquema está em `server/src/persistence/repository.ts`.

## Telas

| | |
|---|---|
| ![](docs/screenshots/01-inicial-desktop.png) | ![](docs/screenshots/02-personagem-desktop.png) |
| ![](docs/screenshots/08-lobby-desktop.png) | ![](docs/screenshots/21-podio-desktop.png) |

| | | | |
|---|---|---|---|
| ![](docs/screenshots/11-pergunta-celular.png) | ![](docs/screenshots/14-resultado-r1-celular.png) | ![](docs/screenshots/19-reconectando-celular.png) | ![](docs/screenshots/22-podio-celular.png) |
