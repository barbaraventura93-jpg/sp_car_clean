# Incidente: banco Firebase inacessível desde 10/11/2026

> Registro feito em 14/11/2026, a partir dos logs do CloudWatch e de testes
> diretos nos endpoints. Enquanto não houver acesso ao console do Google, isto é
> o que se sabe com evidência.

## O que está acontecendo

O Realtime Database `sp-car-clean-default-rtdb` **não responde mais**. Toda
requisição devolve HTTP 404 com a mensagem do Firebase *"Please ensure that you
have the URL of your Firebase Realtime Database instance configured correctly"* —
que é a resposta para instância que não existe, não para segredo errado (esse
daria 401) nem para regra que proíbe (daria 401/403).

A chave web pública do projeto (`AIza…`, que está no site em produção e
funcionava) agora devolve **"API key not valid"** no Identity Toolkit. Chave de
API morre junto com o projeto que a emitiu.

## Quando começou

| Data | Evidência |
|---|---|
| 09/11 06:17 UTC | último backup **bem-sucedido** (20 nós, 286 KB) |
| 09/11 11:01 UTC | última execução de agentes: 3 rodaram (relatório semanal entre eles) |
| **10/11 06:17 UTC** | `firebase-backup: Firebase respondeu HTTP 404` — e todo dia desde então |
| 10/11 11:00 UTC | `ai-dispatcher: 0 agente(s) executado(s)` — e todo dia desde então |

A janela em que o banco morreu é entre **09/11 11:01** e **10/11 06:17 UTC**.

## O que quebrou e o que não quebrou

**Funciona:** o site abre (HTML/CSS/JS no S3+CloudFront), mostra o carrossel (as
7 fotos estáticas) e a tabela de preços (valores padrão do `app.js`, não do
banco). Nada disso prova que o sistema está de pé — é tudo estático.

**Não funciona:**

- **Consultar agendamento** devolve `{"ok":false}` para qualquer código. Por
  desenho, a resposta de "não encontrado" é idêntica à de código inválido
  (anti-enumeração), então o cliente vê *"não encontrado"* e não um erro — o que
  esconde a falha.
- **Novo agendamento** não pode ser gravado.
- **Login de cliente** (Firebase Auth) está fora.
- **Agentes de IA**: nenhum roda desde 10/11. O relatório semanal saiu pela
  última vez em 09/11.
- **Backup diário**: o último é de 09/11.

### Por que os agentes somem em silêncio

`config.getAgentConfig()` lê `/aiConfig/<agente>` com `try/catch` que devolve
`null` no erro, e o despachante trata `null` como desligado:
`if (!cfg?.enabled || !cfg.schedule) continue;` — sem log, sem alerta. Com o
banco em 404, todos os 11 agentes são pulados sem deixar rastro além do
`0 agente(s) executado(s)`.

**Isto não é o defeito dos DEFAULTS** (corrigido no PR #67): o backup de 09/11
mostra os 11 agentes com `enabled: true` e nenhum `disabledReason`. O PR #67
melhora o comportamento, mas **não ressuscita os agentes** — eles voltam só
quando o banco voltar.

## O backup existe e está íntegro

`s3://sp-car-clean-backups-442042534458/firebase/2026/11/09/firebase-2026-11-09T06-17-18-353Z.json.gz`

Verificado em 14/11: gzip íntegro, JSON válido, 20 nós —
`bookings` 14, `services` 13, `stock` 20, `stockRecipes` 9, `portfolio` 8,
`gallery` 5, `clientProfiles` 2, `coupons` 2, `combos` 2, `config` 5,
`aiConfig` 11, `aiUsage` 5, `aiLogs` 156, `blocked` 12130, e os demais.

**Perda possível:** só o que foi escrito entre 09/11 06:17 e a morte do banco —
no máximo um dia. Depois disso nada foi gravado, porque não havia onde gravar.

## O que fazer, na ordem

1. **Descobrir qual conta Google é dona do projeto `sp-car-clean`**
   (número 726947312422). Ele nunca apareceu no console da Bárbara — é o item 5
   do backlog, que deixou de ser incômodo e virou bloqueio de produção.
   Candidatas já levantadas: `sidrpeixoto@` e `spcarclean0@`.
2. **Com acesso ao console**, ver se o projeto está em "recursos pendentes de
   exclusão". Projeto apagado é recuperável por cerca de 30 dias; a contagem
   começou em 10/11.
3. **Se o projeto voltar:** recriar a instância do Realtime Database com o mesmo
   nome (`sp-car-clean-default-rtdb`), republicar as regras
   (`docs/database.rules.anterior.json`) e importar o backup de 09/11.
4. **Se o projeto não voltar:** criar projeto novo, importar o backup, e trocar
   `FIREBASE_DATABASE_URL`/`FIREBASE_DATABASE_SECRET` no SSM
   (`/sp-car-clean/`) e a config do Firebase no `app.js`. Os agendamentos e o
   histórico se preservam pelo backup; o **login dos clientes não** — contas do
   Firebase Auth não vão no backup do banco.

## Buracos que este incidente expôs

- **Nada avisou.** Quatro dias de banco fora, backup falhando todo dia, e o
  único sinal foi um log. `admin-alerts` roda de manhã, mas também lê o banco:
  com o banco fora, ele não tem o que comparar e não grita. Um alerta que
  dependa do próprio banco não serve para avisar que o banco caiu.
- **Falha silenciosa por desenho.** Tanto `booking-status` (anti-enumeração)
  quanto `getAgentConfig` (`catch → null`) transformam erro de infraestrutura em
  "não encontrado"/"desligado". É seguro para o cliente e cego para a dona.
- **Ponto único de falha confirmado.** O acesso ao projeto depende de um segredo
  no SSM e de uma conta Google que ninguém sabe qual é.
