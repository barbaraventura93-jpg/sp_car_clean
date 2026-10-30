# sp_car_clean — Contexto para Claude Code

## Convenções desta conta AWS

- **Região AWS padrão: `sa-east-1`.** É a região padrão de **todo projeto novo**
  desta conta e a deste projeto (`infra/variables.tf` → `aws_region` default
  `sa-east-1`; backend do state em `sa-east-1`). Ao criar recursos novos, use
  `sa-east-1` salvo motivo documentado.
  - O provider-alias `us-east-1` em `infra/versions.tf` **não** é exceção: é
    obrigatório só para o certificado ACM do CloudFront (que a AWS exige em
    `us-east-1`). Não "corrija" para `sa-east-1`.
  - Exceção na conta: o `Planejamento_Financeiro` roda inteiro em `us-east-1`
    de propósito (mais barata) — decisão documentada no repo dele.
