# Configuração do Instagram Feed

## O que foi feito
- ✅ Link do Instagram adicionado no footer
- ✅ Carrossel de posts do Instagram substituindo o quadrado azul
- ✅ Biblioteca Instafeed.js integrada

## Como ativar o feed do Instagram

### Passo 1: Criar aplicação Facebook/Instagram Graph API

1. Acesse [Meta Developers](https://developers.facebook.com/)
2. Clique em "Meus Apps" → "Criar App"
3. Escolha tipo: **Empresa** (Business)
4. Adicione o produto **Instagram Graph API**

### Passo 2: Gerar Access Token

1. No painel do App, vá para **Tools** → **Graph API Explorer**
2. Mude de "Get Started" para seu app criado (dropdown superior direito)
3. Selecione **Instagram Graph API** 
4. Adicione a permissão: `instagram_basic` + `pages_read_engagement`
5. Clique em "Generate Access Token"
6. Copie o token gerado

### Passo 3: Colocar o token no site

Abra o arquivo `index.html` e procure por:

```javascript
const accessToken = 'INSTAGRAM_ACCESS_TOKEN_AQUI';
```

Substitua por:

```javascript
const accessToken = 'seu_token_aqui';
```

### Passo 4: Configurar variáveis de ambiente (opcional)

Para não deixar o token exposto no código, você pode:

1. Criar um arquivo `.env` na raiz:
```
INSTAGRAM_TOKEN=seu_token_aqui
```

2. No seu build/deploy, usar essa variável

## Alternativa: Token Long-Lived

Access tokens expiram em ~1 hora. Para um token de longa duração (60 dias):

1. Graph API → GET `/access_token`
2. Parâmetro: `grant_type=ig_refresh_token`
3. Use esse token long-lived no código

## Testando localmente

- O feed mostra apenas se o token for válido
- Se não houver token, exibe mensagem "Siga-nos no Instagram"
- Verifica 8 posts mais recentes do perfil
- Clique em cada imagem para abrir no Instagram

## User ID do perfil

O ID `17841400949832994` é o da conta `@spcarclean` no Instagram. Para mudar de perfil, encontre o ID em [Instagrapi](https://www.instagrapi.com/).

## Dúvidas?

- Documentação oficial: https://developers.facebook.com/docs/instagram-graph-api
- Teste tokens: https://developers.facebook.com/tools/explorer/
