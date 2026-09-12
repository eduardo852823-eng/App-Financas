# FinanHub — como rodar

## O que mudou
- O app agora tem um **backend de verdade** (Node.js + Express) com um
  **banco de dados SQLite** (`backend/finanhub.db`), que é criado
  automaticamente na primeira vez que você rodar o servidor.
- O banco guarda: usuários (nome, e-mail, senha criptografada ou login
  Google), preferências (tema), quais bancos estão conectados e todas
  as transações.
- O front-end (`frontend/`) só guarda o **token de login** no navegador
  — todo o resto vem do servidor.

## 1. Instalar o backend
Você precisa ter o [Node.js](https://nodejs.org) instalado (versão 18+).

```bash
cd backend
npm install
cp .env.example .env
```

Abra o `.env` e troque `JWT_SECRET` por um texto aleatório qualquer
(pode ser uma frase longa sem sentido — isso é o que protege os
tokens de login).

## 2. Rodar o backend
```bash
npm start
```
Isso sobe o servidor em `http://localhost:3001`. Na primeira execução
o arquivo `finanhub.db` é criado automaticamente na pasta `backend/`
— não precisa instalar MySQL, PostgreSQL nem nada externo.

## 3. Rodar o front-end
O front-end é só HTML/CSS/JS puro. Mais fácil abrir com um servidor
local simples (não pode ser `file://` por causa do login Google), por
exemplo:
```bash
cd frontend
npx serve .
```
Isso abre em algo como `http://localhost:3000`.

Se o endereço do backend não for `http://localhost:3001`, edite o
início do arquivo `frontend/script.js`:
```js
const API_BASE = "http://SEU_ENDERECO:3001/api";
```

## 4. Testar
- Crie uma conta pelo botão "Criar conta" (nome, e-mail, senha) ou
  entre com o Google.
- Ao criar a conta, dois bancos (Inter e Nubank) já vêm conectados
  com um histórico de transações de exemplo — não fica "zerado".
- Marque "Modo teste" antes de conectar um banco ou usar os dados de
  demonstração para ver valores bem menores (mais fácil de conferir
  os cálculos).
- Ao conectar um novo banco em "Minhas instituições", ele já entra
  com um extrato de exemplo (assim como acontecerá de verdade quando
  o Open Finance for integrado).

## 5. Sobre o Open Finance (próximo passo)
O backend já tem, comentado no `server.js`, o ponto onde entra a
verificação periódica: uma função roda a cada 5 minutos
(`setInterval(..., 5 * 60 * 1000)`) e, quando o Open Finance oficial
for integrado, é ali que ela vai chamar a API de cada banco
conectado, comparar com a última sincronização e inserir só as
transações novas. Hoje essa parte só imprime um log — é o lugar
certo para plugar a integração real quando ela existir.

## 6. Colocando em produção
- Troque o SQLite por PostgreSQ/MySQL se o volume de usuários
  crescer (o código do `server.js` fica bem parecido, trocando só a
  camada de banco).
- Hospede o backend em algum serviço (Railway, Render, Fly.io, uma
  VPS) e o front-end em algo como Vercel/Netlify/GitHub Pages.
- No Google Cloud Console, adicione o domínio final do front-end em
  "Authorized JavaScript origins" do client ID usado, senão o login
  Google dá erro `origin_mismatch`.
- Nunca suba o arquivo `.env` nem o `finanhub.db` para um repositório
  público — eles têm a chave secreta e os dados dos usuários.
