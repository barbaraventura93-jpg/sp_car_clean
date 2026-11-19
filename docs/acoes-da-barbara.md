# Ações que só a Bárbara pode fazer

Lista viva. Cada item diz por que é necessário, o passo a passo e o que você
deve ver quando der certo. Atualizado em 14/11/2026.

Nunca cole senha, chave ou token em conversa, e-mail ou arquivo do repositório.

---

## 1. Trocar a chave de acesso da AWS que está no ambiente — recomendado (risco aceito em 14/11/2026)

**Feito em 18/11/2026**, depois do aviso da AWS de "conta possivelmente
acessada por terceiros" (o Lambda ficou bloqueado na conta inteira):
- a chave de maio (…WCX7) foi excluída;
- a chave de agosto (…YVWI) foi **desativada**, não excluída: se nada parar
  até 25/11, pode excluir;
- a chave nova (…YTCL) foi criada pelo `barbara-admin` e está no ambiente;
- o usuário perdeu o poder de criar permissões (`IAMFullAccess` trocado por
  `IAMReadOnlyAccess`).

Falta ainda o passo 3 acima (usuário só de leitura para a revisão), se quiser.

**Situação:** o ambiente de desenvolvimento do Claude guarda uma chave de
acesso da AWS que não expira e tem permissão quase total (inclusive para criar
outras permissões). Em 14/11/2026 você decidiu mantê-la para o desenvolvimento
não parar. Fica registrado como risco aceito.

**Por que ainda vale trocar:** quem obtiver essa chave pode apagar o site, o
banco e os backups, ou criar recursos que geram custo. O deploy não depende
dela.

**Passo a passo, quando decidir trocar:**
1. No console da AWS, abra **IAM > Usuários > github-actions-tracker > Credenciais de segurança**.
2. Em **Chaves de acesso** há duas. A mais antiga (de maio) foi usada pela
   última vez em 31/10: clique em **Ações > Desativar** e observe por uma
   semana se algo para de funcionar. Se nada parar, exclua.
3. Crie um usuário novo só para a revisão, com a política pronta
   **ReadOnlyAccess**, gere uma chave para ele e coloque-a no ambiente do
   Claude no lugar da atual.
4. Desative a chave atual do `github-actions-tracker`.

**Resultado esperado:** o site e o deploy continuam funcionando, e a revisão
continua lendo a AWS, mas sem poder alterar nada.

**Custo:** nenhum.

---

## 1a. Ativar MFA no `barbara-admin` — FEITO em 18/11/2026

**Por quê:** o `barbara-admin` tem acesso total (`AdministratorAccess`) e senha
de console, sem MFA. Quem descobrir a senha entra como administradora.

**Passo a passo:** entre como `barbara-admin` > nome no canto superior direito
> **Security credentials** > **Assign MFA device** (app autenticador ou passkey).

**Resultado esperado:** o login do `barbara-admin` pede o segundo fator.

---

## 1b. Liberar custos para o `barbara-admin` — FEITO em 18/11/2026

**Por quê:** a AWS esconde custos de todo usuário que não é root até o root
liberar ("IAM user access not activated"). Liberado, o root fica só para
emergência.

**Passo a passo:** como root > nome da conta > **Account** > **IAM user and role
access to Billing information** > **Edit** > **Activate IAM Access** > **Update**.
Se a tela não estiver lá, procure em AWS Settings > Billing.

**Resultado esperado:** o `barbara-admin` abre o Cost Explorer sem erro.

---

## 2. Trocar a senha antiga do painel onde ela tiver sido reutilizada — pendente

**Por quê:** o histórico do repositório, que é público, guarda em texto puro a
senha que o painel usava antes de 08/11/2026. Ela não abre mais o painel, mas
qualquer pessoa pode lê-la.

**Passo a passo:**
1. Pense se aquela senha (ou uma variação dela) é usada em qualquer outro
   lugar: e-mail do negócio, InfinitePay, Telegram, Google, Instagram, a conta
   de admin do site.
2. Em cada lugar onde for, troque por uma senha nova e diferente.
3. Ative a verificação em duas etapas no e-mail do negócio e na InfinitePay.

**Resultado esperado:** a senha antiga não dá acesso a nada.

O histórico não foi reescrito: reescrever não "despublica" o que já foi
copiado, e quebraria os PRs abertos.

---

## 3. Decidir se o repositório continua público — pendente

**Por quê:** hoje qualquer pessoa lê o código, as regras do banco e o
histórico. Não é falha por si só, mas facilita a vida de quem procura brecha, e
é o motivo de o relatório completo não estar no repositório.

**Recomendação:** tornar privado. É gratuito, o deploy continua funcionando e
nada muda para os clientes.

**Passo a passo (se concordar):**
1. No GitHub, abra o repositório `sp_car_clean`.
2. **Settings** > role até **Danger Zone** > **Change repository visibility**.
3. Escolha **Make private** e confirme digitando o nome do repositório.

**Resultado esperado:** um cadeado ao lado do nome do repositório. Abrindo o
endereço numa janela anônima, aparece "404".

**Trade-off:** privado, o limite gratuito de minutos do GitHub Actions passa a
valer (2.000 min/mês; cada deploy leva cerca de 1 minuto, então há folga).

---

## 4. Publicar as regras novas do banco — pendente (depois do merge do PR das regras)

**Por quê:** o arquivo `database.rules.json` do repositório é só o texto das
regras. Enquanto não for publicado no Firebase, o banco continua com as regras
antigas, que deixam um visitante apagar a lista de espera, ler todas as
avaliações e todos os cupons, e criar agendamento já "confirmado".

**O que as regras novas mudam para o cliente:** nada. Foram testadas num
emulador local com 88 casos, incluindo agendar, cancelar, entrar na lista de
espera, avaliar e usar cupom e gift card exatamente como o site faz.

**Como publicar.** O console do Firebase não está acessível (item 5 do
backlog), então a publicação é feita com o segredo do banco, que está guardado
na AWS. Há dois caminhos:

- **Recomendado:** quando o acesso da revisão à AWS voltar (item 1), você me
  autoriza e eu publico e confiro, sem o segredo passar pelo chat.
- **Alternativa:** uma pessoa técnica de sua confiança, com acesso à AWS, roda
  a publicação. O segredo nunca deve ser colado em conversa ou e-mail.

**Resultado esperado:** logo após publicar, um agendamento de teste feito pelo
site continua funcionando, e a lista de espera aceita uma entrada nova.

**Se algo der errado:** as regras anteriores estão guardadas no histórico do
repositório e podem ser republicadas do mesmo jeito, em um minuto.

**Custo:** nenhum.

---

## 5. Itens que entram aqui conforme os PRs forem aprovados

- Aplicar o Terraform (cabeçalhos de segurança, alarmes).
- Item 1 do backlog (Drive): continua pausado por decisão sua.
- Item 5 do backlog (acesso ao projeto Firebase/Google Cloud).
