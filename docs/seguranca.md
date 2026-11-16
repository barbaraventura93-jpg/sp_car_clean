# Segurança — SP Car Clean

Resumo de quem pode fazer o quê, o que protege o site, o que foi corrigido na
revisão de novembro/2026, quais riscos continuam abertos e como trocar cada
segredo. Última atualização: 15/11/2026.

O detalhe de cada achado está em `docs/revisao-2026-11-09.md`. Como o
repositório é público, falhas ainda abertas aparecem lá só com identificador e
estado; o detalhe entra depois da correção.

---

## 1. O que precisa ser protegido

| O quê | Por quê |
|---|---|
| Dinheiro | Pagamentos, gift cards, cupons e pontos viram desconto ou serviço |
| Dados de clientes | Nome, telefone, e-mail, endereço, placa e fotos do carro (LGPD) |
| O painel | Quem entra como admin vê e altera tudo |
| A marca | E-mails e mensagens saem em nome da SP Car Clean |
| A conta na AWS | Quem a controla pode apagar o site ou gerar custo |

## 2. De quem

| Quem | O que tentaria |
|---|---|
| Visitante sem login | Agendar sem pagar, ler dados de outros clientes, apagar dados, mandar spam em nome da marca |
| Cliente logado | Ver ou alterar o agendamento de outro cliente, fabricar pontos ou desconto |
| Alguém com um código (de agendamento ou gift card) | Reusar pagamento, reativar gift card, cancelar o agendamento alheio |
| Quem obtiver uma credencial | Qualquer coisa que a credencial permita |

## 3. O que protege o site hoje

- **Login pelo Amazon Cognito.** O servidor confere a assinatura de cada
  token. Admin é quem está no grupo `admin`, definido na AWS; o navegador não
  consegue se declarar admin.
- **Painel pelo servidor.** O painel grava por uma função que só aceita os
  caminhos previstos e só de quem é admin.
- **Dados do cliente pelo servidor.** O cliente só acessa o que é dele; a
  identidade vem do token, nunca do que o navegador envia.
- **Pagamento conferido na origem.** O servidor não acredita no aviso de
  pagamento: consulta o InfinitePay antes de confirmar, compara o valor, e só
  confirma pedido que ainda aguardava pagamento.
- **Entrada pública com limite.** Chat, orçamento por foto, indicação e
  notificações têm checagem de origem e teto por IP; a IA tem teto de tamanho e
  orçamento mensal.
- **Frente do site.** Tudo passa pelo CloudFront com WAF (regras gerenciadas e
  limite por IP), só HTTPS. Os buckets não têm acesso público. A API só
  responde ao CloudFront.
- **Publicação.** O GitHub publica com um papel temporário, restrito a este
  repositório e à branch `main`, e só depois que os testes passam.
- **Testes.** Cada regra acima tem teste que reprova se ela for removida
  (`docs/testes.md`).

## 4. O que foi corrigido na revisão (novembro/2026)

| Achado | O que era | Estado |
|---|---|---|
| S-01 | Aviso de pagamento repetido reativava gift card já usado | Corrigido e publicado |
| S-02 | Dado digitado pelo cliente rodava como código no painel | Corrigido e publicado |
| S-03 | Aviso de pagamento repetido reconfirmava agendamento cancelado | Corrigido e publicado |
| S-09 | Função de indicação servia para spam e para gerar cupom | Corrigido e publicado |
| S-12, M-01 | Servidor confundia um código interno com o e-mail do cliente; login antigo ainda concedia admin | Corrigido e publicado |
| M-02 | Agente de IA de uso interno chamável por qualquer um; chat sem teto | Corrigido e publicado |
| S-04 (parte), S-06, S-07 (parte), S-10 | Regras do banco abertas demais | Corrigido no arquivo, mas **sem efeito**: o Firebase foi removido. Ver o risco "proteções no servidor" abaixo |
| B-01, B-02 | Publicação sem testes; dependência vulnerável sem uso | Corrigido |

## 5. Riscos que continuam abertos

| Risco | Situação | Decisão |
|---|---|---|
| **Banco em migração** | O Firebase foi removido em 10/11/2026 pela dona do projeto; os dados foram importados para o DynamoDB (PR #67), mas o site ainda não lê nem grava lá | Em andamento, a cargo de outra sessão de trabalho |
| **As proteções das regras do banco precisam ir para o servidor** | As regras de `database.rules.json` (PR #64) valiam só para o Firebase, que não existe mais. No DynamoDB não há regras no navegador: a mesma proteção tem de existir nas funções que gravam (agendamento só nasce pendente, lista de espera só cria, avaliação pública só aprovada, cupons não listáveis) | Aberto: deve entrar junto com o endpoint público de dados do PR #67 |
| **Preço, cupom, gift card e pontos decididos no navegador** (S-05, S-07, S-08) | O servidor ainda não recalcula | Aberto (backlog, item 7). Hoje a barreira é a conferência manual de cada pedido |
| **Chave de acesso ampla e permanente no ambiente de desenvolvimento** (A-01) | Poder quase total sobre o projeto na AWS | **Aceito pela dona do projeto em 14/11/2026**, para não parar o desenvolvimento. Recomendação mantida: trocar |
| **Senha antiga do painel no histórico público do repositório** (S-11) | Não abre mais o painel; o risco é reuso | Pendente: trocar onde tiver sido reutilizada |
| **Repositório público** | Código, regras e histórico legíveis por qualquer pessoa | Pendente de decisão |
| **Sem alarme, sem CSP, sem segunda etapa no login admin** (M-04, M-07) | Falhas passam em silêncio; falta a segunda barreira do S-02 | Aberto (backlog, item 8) |
| **Projeto Google sem dono acessível** (M-12) | Encerrado: o projeto foi excluído | — |
| **Limite por IP em memória** (M-10) | Zera quando a função reinicia | Aceito: o WAF cobre o grosso |
| **Fotos de check-in públicas por endereço** (M-05) | Endereço imprevisível, mas sem login | Aceito por ora; documentado |

## 6. Dados pessoais (LGPD)

- **O que é coletado:** nome, e-mail, telefone, bairro e CEP, modelo e placa do
  veículo, observações, data de nascimento (opcional) e fotos do veículo no
  check-in.
- **Onde fica:** no banco de dados e, as fotos, no bucket de mídia. O backup
  diário contém tudo e é guardado por 180 dias.
- **Nos registros (logs):** guardados por 14 dias. Uma função (a do e-mail de
  aniversário) ainda grava o e-mail do cliente no log; está anotado para
  correção.
- **Pedido de exclusão:** não há fluxo automático. Hoje é manual, pelo painel.
  Lembrar que o dado continua nos backups por até 180 dias.
- **Testes e documentação** nunca usam dado real de cliente.

## 7. Como trocar cada segredo

Regra geral: gerar o valor novo, gravar no lugar certo, conferir que o site
continua funcionando, e só então invalidar o antigo. Nunca colar segredo em
conversa, e-mail ou arquivo do repositório.

Os segredos das funções ficam no **SSM Parameter Store**, na Região
sa-east-1, sob `/sp-car-clean/`. Para trocar um: console da AWS > **Systems
Manager > Parameter Store** > abrir o parâmetro > **Editar** > colar o valor
novo > salvar. Cada função lê os segredos quando inicia, então o valor novo só
vale depois que ela reiniciar. Para garantir, publique o site de novo (a
publicação atualiza todas as funções) e confira o funcionamento.

| Segredo | Onde se gera o novo | Parâmetro | Observação |
|---|---|---|---|
| Chave da API de IA | Painel do fornecedor do modelo | `ANTHROPIC_API_KEY` | Revogar a antiga lá depois |
| Bot do Telegram | Conversa com o BotFather (`/revoke`) | `TELEGRAM_BOT_TOKEN` | O número do chat (`TELEGRAM_CHAT_ID`) não muda |
| E-mail (EmailJS) | Painel do EmailJS | `EMAILJS_PRIVATE_KEY` | A chave pública vai nos segredos do GitHub e exige publicar o site |
| Identificador do InfinitePay | Painel do InfinitePay | `INFINITEPAY_HANDLE` | Não é senha, mas trocar muda para onde vai o dinheiro: conferir duas vezes |
| Segredo do banco (Firebase) | — | `FIREBASE_DATABASE_SECRET` | Sem uso desde a remoção do Firebase; apagar do SSM quando a migração terminar |
| Segredo da sincronização do Drive | Gerar um texto aleatório longo | `DRIVE_SYNC_SECRET` | Trocar também no Apps Script. Recurso pausado |
| Chave das notificações (VAPID) | Gerada pelo Terraform | `WEB_PUSH_VAPID_PRIVATE_KEY` | Trocar invalida as inscrições: todos precisam aceitar as notificações de novo |
| Segredo entre CloudFront e API | Gerado pelo Terraform | (interno) | Trocar exige aplicar o Terraform |
| Senha de admin | Tela de login > "Esqueci minha senha" | (Cognito) | Cada admin troca a própria |
| Chave de acesso da AWS do ambiente | Console da AWS > IAM | (fora do SSM) | Passo a passo em `docs/acoes-da-barbara.md` |

Os nomes dos parâmetros acima vêm do código das funções. A lista do que existe
de fato no SSM **não foi verificada**: a credencial da revisão não lê o SSM.
