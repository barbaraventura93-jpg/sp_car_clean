# Guia Completo: Configurar Netlify + Firebase + GitHub Actions

## PARTE 1: NETLIFY

### Passo 1.1: Criar conta e site no Netlify

1. Acesse https://netlify.com
2. Clique em **"Sign Up"** (ou faça login se já tem conta)
3. Escolha **"Connect with GitHub"**
4. Autorize o Netlify a acessar seus repositórios
5. Selecione o repositório **`baventura`**
6. Configure:
   - **Build command**: `mkdir -p dist && cp index.html dist/`
   - **Publish directory**: `dist`
   - Clique em **"Deploy site"**

### Passo 1.2: Gerar Access Token do Netlify

1. No Netlify, vá para **User Settings** (canto superior direito)
2. Clique em **"Applications"** → **"Personal access tokens"**
3. Clique em **"New access token"**
4. Dê um nome: `github-actions`
5. Copie o token (guarde em local seguro)
6. ⚠️ Você vai usar este token como **NETLIFY_AUTH_TOKEN**

### Passo 1.3: Pegar o Site ID do Netlify

1. No dashboard do Netlify, clique no seu site
2. Vá para **Site settings** → **General**
3. Procure por **"Site ID"** (copie)
4. ⚠️ Você vai usar como **NETLIFY_SITE_ID**

---

## PARTE 2: FIREBASE

### Passo 2.1: Criar projeto Firebase

1. Acesse https://console.firebase.google.com
2. Clique em **"Add project"** ou use um projeto existente
3. Digite um nome (ex: `sp-car-clean-site`)
4. Habilite Google Analytics (opcional)
5. Clique em **"Create project"**

### Passo 2.2: Configurar Firebase Hosting

1. No console Firebase, clique em **"Hosting"** (menu esquerdo)
2. Clique em **"Get Started"**
3. Instale Firebase CLI (próxima seção)

### Passo 2.3: Gerar Token CI do Firebase

Abra o terminal/PowerShell e execute:

```bash
npx firebase-tools login:ci
```

Isso vai:
1. Abrir uma aba no navegador
2. Pedir para autenticar com sua conta Google
3. Retornar um **FIREBASE_TOKEN** único
4. ⚠️ Copie este token (guarde em local seguro)

**Comando para Windows (se não funcionar acima):**
```powershell
npm install -g firebase-tools
firebase login:ci
```

### Passo 2.4: Verificar firebase.json

Seu projeto já tem `firebase.json` configurado:

```json
{
  "hosting": {
    "public": "dist",
    "ignore": [...]
  }
}
```

✅ Está correto! O Firebase vai servir os arquivos da pasta `dist/`

---

## PARTE 3: GITHUB SECRETS

### Passo 3.1: Adicionar Secrets no GitHub

1. Vá para seu repositório: https://github.com/barbaraventura93-jpg/baventura
2. Clique em **Settings** (abas no topo)
3. Menu esquerdo → **"Secrets and variables"** → **"Actions"**
4. Clique em **"New repository secret"** (3 vezes)

### Passo 3.2: Adicionar cada Secret

Crie estes 3 secrets (copie os valores que guardou):

| Name | Value |
|------|-------|
| `NETLIFY_AUTH_TOKEN` | Token do Passo 1.2 |
| `NETLIFY_SITE_ID` | Site ID do Passo 1.3 |
| `FIREBASE_TOKEN` | Token do Passo 2.3 |

**Exemplo de como adicionar:**
1. Clique em **"New repository secret"**
2. **Name**: `NETLIFY_AUTH_TOKEN`
3. **Value**: Cole o token copiado
4. Clique em **"Add secret"**
5. Repita para os outros 2

---

## PARTE 4: FAZER O PRIMEIRO DEPLOY

### Passo 4.1: Adicionar mudanças ao Git

```bash
cd c:\Users\barba\Local\baventura\sp-car-clean
git add -A
git commit -m "Configurar GitHub Actions para Netlify e Firebase"
```

### Passo 4.2: Push para o GitHub

```bash
git push origin main
```

### Passo 4.3: Acompanhar o Deploy

1. Vá para seu repositório no GitHub
2. Clique em **"Actions"** (abas no topo)
3. Veja o workflow rodando
4. Espere terminar (~ 1-2 minutos)

---

## RESUMO DOS LINKS

Depois de configurado, seus sites estarão em:

- **Netlify**: https://sp-car-clean.netlify.app/#
- **Firebase**: sp-car-clean.web.app

---

## ✅ CHECKLIST

- [ ] Conta Netlify criada
- [ ] Token Netlify gerado (NETLIFY_AUTH_TOKEN)
- [ ] Site ID Netlify copiado (NETLIFY_SITE_ID)
- [ ] Projeto Firebase criado
- [ ] Token Firebase gerado (FIREBASE_TOKEN)
- [ ] 3 Secrets adicionados no GitHub
- [ ] Push feito para main
- [ ] Deploy concluído ✅

---

## ❓ Dúvidas Comuns

**P: Onde vejo meu site ao vivo?**
R: Dashboard do Netlify ou Firebase Hosting → Site URL

**P: Como atualizar o site?**
R: Basta fazer `git push`. O GitHub Actions fará o deploy automaticamente!

**P: Token expirou?**
R: Firebase: execute `firebase login:ci` novamente. Netlify: crie um novo no painel.

**P: Deploy falhou?**
R: Verifique em GitHub → Actions → clique no workflow para ver logs de erro.

---

Pronto! Faça os passos acima e nos avise quando terminar! 🚀
