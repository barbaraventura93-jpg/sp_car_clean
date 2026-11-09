# Ações que só a Bárbara pode fazer

Lista viva. Cada item diz por que é necessário, o passo a passo e o que você
deve ver quando der certo. Atualizado em 09/11/2026.

Nunca cole senha, chave ou token em conversa, e-mail ou arquivo do repositório.

---

## 1. Renovar o acesso da revisão à AWS — pendente

**Por quê:** a revisão não conseguiu ler nada na AWS (a credencial da sessão
está expirada). Sem isso ficam **não verificados**: o projeto e o plano
(FREE/PAID), as permissões de cada serviço, o estado do Terraform, o
`terraform plan`, os alarmes, os logs e o item S-12 do relatório.

**Permissão mínima necessária:** somente leitura, credencial temporária.
Nenhuma permissão de escrita é necessária para o diagnóstico.

**Passo a passo:**
1. Abra o Claude e vá nas configurações de conectores/plugins.
2. Localize o conector da AWS e refaça o login (entrar de novo).
3. Volte à conversa da revisão e escreva: "acesso AWS renovado".

**Resultado esperado:** a revisão roda a checagem de identidade e preenche a
tabela "Ambiente da revisão" em `docs/revisao-2026-11-09.md`.

Se depois de renovar aparecer "Access Denied" em algo que antes funcionava,
confira em **AWS Settings > Billing** se há um spend limit configurado e se ele
foi atingido.

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

## 4. Itens que entram aqui conforme os PRs forem aprovados

- Publicar as regras novas do banco (depende do PR de regras).
- Aplicar o Terraform (cabeçalhos de segurança, alarmes).
- Item 1 do backlog (Drive): continua pausado por decisão sua.
- Item 5 do backlog (acesso ao projeto Firebase/Google Cloud).
