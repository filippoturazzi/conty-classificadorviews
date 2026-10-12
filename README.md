# Conty. Views que não parecem humanas

Classificador **explicável** para uma série de views por hora. Ele devolve uma de três respostas, com um motivo em português e os sinais que usou:

- **suspeito**: pelo menos um sinal forte, com volume suficiente para não ser ruído;
- **inconclusivo**: só sinais na zona cinza. **Preferimos não acusar** e pedimos revisão humana;
- **legitimo**: nenhum sinal disparou.

Não há modelo treinado: são três regras com limiares escritos em `src/classifier.ts` (também expostos em `GET /criteria`). O dataset é sintético, gerado com seed fixa, e não depende de rede social real.

## Como rodar

Node 22.18 ou mais novo. Não há dependências para instalar: o projeto usa só `node:http` e `node:test`, e o Node roda os `.ts` direto.

```bash
npm test                 # 23 testes, incluindo o que compara este README com o medido
npm run evaluate         # gera data/dataset.jsonl e mede o classificador
npm run evaluate:write   # o mesmo, e reescreve o bloco de métricas abaixo
npm start                # API em http://127.0.0.1:3009
```

## Métricas no dataset sintético

O bloco abaixo é escrito pelo `npm run evaluate:write`, nunca à mão. O teste `test/readme-metrics.test.ts` mede de novo e falha se o bloco divergir.

<!-- metricas:inicio (gerado por npm run evaluate:write; não editar à mão) -->
- Séries: **800** (500 legítimas, 300 suspeitas)
- **Taxa de falso positivo: 0.2%** (legítimas classificadas como suspeitas)
- Detecção: 96.0% das suspeitas classificadas como suspeitas
- Legítimas em "inconclusivo" (preferimos não acusar): 31.8%
- Suspeitas que passaram como legítimas: 0.3%

| Tipo de série | Rótulo verdadeiro | → legítimo | → inconclusivo | → suspeito |
|---|---|---|---|---|
| `organico_estavel` | legitimo | 97 | 3 | 0 |
| `organico_viral` | legitimo | 92 | 8 | 0 |
| `organico_pico_curto` | legitimo | 56 | 43 | 1 |
| `organico_falha_coleta` | legitimo | 13 | 87 | 0 |
| `organico_baixo_volume` | legitimo | 82 | 18 | 0 |
| `comprado_pico` | suspeito | 0 | 9 | 91 |
| `comprado_plato` | suspeito | 1 | 2 | 97 |
| `comprado_repeticao` | suspeito | 0 | 0 | 100 |
<!-- metricas:fim -->

"Inconclusivo" não conta como acusação: é a resposta de quem prefere não acusar. Por isso o falso positivo considera só as legítimas que receberam "suspeito".

## O critério

O **normal** de uma série é a **mediana** das views por hora. Um pico, comprado ou orgânico, quase não mexe na mediana.

### 1. Pico comprado e queda abrupta: o corte de 1 hora

A ideia central é que **views orgânicas caem aos poucos, e views compradas param de uma vez.** Um vídeo que viralizou perde alcance por perda gradual de distribuição: a cada hora, perde uma fração do excesso. Uma entrega comprada termina quando o pacote acaba, e a série volta ao normal na hora seguinte.

O sinal procura uma hora em que a série:
1. estava em **5× o normal ou mais**;
2. perdeu **90% ou mais do excesso** (o que estava acima do normal) **em 1 hora**;
3. **ficou abaixo de 2× o normal nas 2 horas seguintes**.

Com as três condições, o sinal é **forte**. Se a perda ficou entre 70% e 90%, ou a série voltou a subir logo depois, ou acabou antes de dar para confirmar, é **zona cinza**.

O nome do sinal depende da duração do episódio elevado: até 3 h é **pico comprado**, e de 4 h para cima é **queda abrupta depois de platô**.

**Por que um pico orgânico não cai no mesmo balde:** o teste "mesma altura" em `test/classifier.test.ts` monta dois picos de ~20 000 views/h na mesma série. O viral perde no máximo ~30% do excesso por hora e sai **legítimo**. O bloco comprado perde 100% de uma vez e sai **suspeito**. Mesmo um viral de 50× com meia-vida de 2 h continua legítimo.

### 2. Repetição mecânica

Pessoas não assistem em ritmo constante: mesmo no horário mais estável, a audiência real oscila de hora em hora. O sinal é:
- **forte** com 8 horas seguidas com média de 50/h ou mais variando **2% ou menos** (desvio ÷ média), ou com 4 horas seguidas com **exatamente o mesmo número**;
- **zona cinza** com variação entre 2% e 4%.

Abaixo de 50 views/h a regra nem é avaliada, porque números pequenos se repetem por acaso.

### 3. Volume mínimo para acusar

Sinal forte com menos de **200 views/h** no trecho suspeito vira zona cinza. Em conta pequena, a forma da curva é dominada pelo acaso.

### Série curta

Com menos de 24 horas, a resposta é sempre "inconclusivo": não há o que comparar.

## Exemplos de resposta

`POST /classify` com `{"hourly_views": [ …72 números… ]}`. As respostas abaixo são reais, encurtadas com `…`.

**Pico comprado → suspeito**

```json
{
  "classification": "suspeito",
  "reason": "Pico sem cauda (pico comprado): nas horas 30–31 (2 h) as views chegaram a 28.1× o normal e na hora 32 perderam 100% do excesso de uma vez, e ficaram no nível normal depois. O normal desta série é 723 views por hora.",
  "signals": [
    {
      "id": "pico_comprado",
      "status": "forte",
      "evidence": "nas horas 30–31 (2 h) as views chegaram a 28.1× o normal e na hora 32 perderam 100% do excesso de uma vez, e ficaram no nível normal depois",
      "hours": [30, 32],
      "measured": { "ratio_before": 28.1, "excess_lost_in_1h": 1, "episode_hours": 2 },
      "rule": "nível ≥ 5× o normal que perde ≥ 90% do excesso em 1 hora …"
    },
    { "id": "queda_abrupta", "status": "ausente", "…": "…" },
    { "id": "repeticao_mecanica", "status": "ausente", "evidence": "a janela mais estável de 8 h ainda varia 10%, ritmo normal de audiência real", "…": "…" }
  ],
  "stats": { "hours": 72, "baseline_per_hour": 722.5, "peak_per_hour": 20301, "peak_hour": 31, "peak_ratio": 28.1, "peak_max_hourly_loss": 1 }
}
```

**Viral da mesma altura → legítimo**

```json
{
  "classification": "legitimo",
  "reason": "Nenhum sinal de view artificial: sem queda de 1 hora de volta ao normal e sem ritmo constante demais. O maior pico (22.5× o normal, hora 30) caiu aos poucos, perdendo no máximo 30% do excesso por hora, como um vídeo que viralizou de verdade.",
  "…": "…"
}
```

### Um caso em que o classificador prefere não acusar

Um pico orgânico curtíssimo, como um repost ou um story que bombou por uma hora, sobe a 21× o normal e perde **81%** do excesso na hora seguinte. É rápido demais para um viral típico, mas não chega aos 90% de um corte de entrega comprada:

```json
{
  "classification": "inconclusivo",
  "reason": "Preferimos não acusar. Pico sem cauda (pico comprado): na hora 30 (1 h) as views chegaram a 21.2× o normal e na hora 31 perderam 81% do excesso de uma vez, uma queda rápida, mas abaixo de 90%: pode ser um pico orgânico curto. Vale uma revisão humana antes de decidir.",
  "…": "…"
}
```

Outros casos em que o classificador prefere não acusar, todos com teste:
- uma hora **zerada** no meio de um viral (falha de coleta: a série volta a subir na hora seguinte);
- forma de pico comprado em **conta pequena** (abaixo de 200 views/h);
- um corte nas **últimas horas da série**, sem horas depois para confirmar.

## O dataset sintético

`src/dataset.ts` gera 100 séries de 72 horas para cada tipo, com seed fixa (`20261012`). O resultado fica em `data/dataset.jsonl`, uma série por linha com `id`, `kind`, `label` e `hourly_views`. Um teste regenera o arquivo e confere que ele bate byte a byte.

| Tipo | Rótulo | Como é gerado |
|---|---|---|
| `organico_estavel` | legítimo | lançamento que decai devagar, ciclo dia/noite (pico às 20h), ruído de 15–30% |
| `organico_viral` | legítimo | sobe a 8–40× em 1–3 h e cai com meia-vida de 3–12 h |
| `organico_pico_curto` | legítimo | 6–15×, meia-vida de 0,5–1,5 h: **o caso mais difícil** |
| `organico_falha_coleta` | legítimo | viral com uma hora zerada no meio |
| `organico_baixo_volume` | legítimo | 3–30 views/h, ruído de 30–50% |
| `comprado_pico` | suspeito | bloco de 1–3 h a 8–40× que some de uma vez |
| `comprado_plato` | suspeito | platô de 6–14 h a 5–12× com corte brusco |
| `comprado_repeticao` | suspeito | 10–30 h com número idêntico ou variando ±0,5% |

Os casos legítimos foram escolhidos de propósito para **tentar** provocar falso positivo: viral alto, pico orgânico curtíssimo e falha de coleta.

## O que o classificador NÃO detecta

- **Compra pequena:** pacotes abaixo de 5× o normal não disparam o sinal de corte.
- **Compra que imita curva orgânica:** entrega gradual com subida, decaimento e ruído, ou distribuída para seguir o ciclo dia/noite. Só se vê a forma da série, então uma entrega bem disfarçada passa.
- **Compra no lançamento sem corte:** views compradas misturadas ao pico natural das primeiras horas de um vídeo, decaindo junto.
- **Repetição com ruído:** robôs que variam o número em 5% ou mais por hora passam pela regra de repetição.
- **Fraude fora das views:** curtidas, comentários ou seguidores comprados, e views de pessoas reais pagas para assistir (fazenda de cliques). Para isso seriam precisos outros dados: retenção, origem do tráfego, proporção de engajamento.
- **Granularidade:** com dado por hora, nada abaixo de 1 hora é visto. Um pacote entregue em 20 minutos e outro em 3 horas parecem iguais se cabem no mesmo bloco.

Os limites, como os 5×, os 90% e os 2%, foram escolhidos a partir do dataset sintético. Com dados reais rotulados, eu recalibraria cada um olhando a distribuição dos casos legítimos.

## Testes

- `test/classifier.test.ts`:
  - **casos óbvios**: audiência normal, pico comprado, platô, número repetido, variação abaixo de 1% e série curta;
  - **pico orgânico × pico comprado da mesma altura**;
  - viral de 50×;
  - **quando prefere não acusar**: pico curtíssimo, hora zerada, conta pequena, corte no fim;
  - motivo legível.
- `test/readme-metrics.test.ts`: **falha se o README divergir do medido**, tanto no bloco quanto em qualquer menção à taxa no texto.
- `test/dataset.test.ts`:
  - reproduzível;
  - arquivo em `data/` igual ao gerado;
  - seeds diferentes geram séries diferentes;
  - formato.
- `test/api.test.ts`: classificação, validação e critérios expostos.

## Uso de IA

A IA foi responsável por gerar o código dessa solução, após a implementação, revisei o seu funcionamento, rodando uma serie de testes e rodando o script evaluate para conferir o seu resultado, o resultado apresentado foi agradável, com 96% das suspeitas sendo classificadas como suspeitas, e apenas 0.2% de falso positivo e 0.3% suspeitas que passaram como legitima, isso em um dataset de 800 casos. Também conferi se a stack utilizada foi a mesma dos outros desafios e se tudo aquilo que foi solicitado no desafio foi entregue corretamente.