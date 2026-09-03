# Dashboard de Rastreamento de Compilação

## Dados pessoais coletados
- IP do cliente (texto plano) e hostname (`machineName`) de cada job de compilação.


## Minimização
- Apenas contadores agregados de arquivos são armazenados; nomes/paths de arquivos não são persistidos.

## Controle de acesso
- Acesso ao dashboard e à API somente mediante login (usuário único configurado via variáveis de ambiente) e token JWT com expiração de 1 hora.

## Variáveis de ambiente necessárias
- `JWT_SECRET`: segredo usado para assinar os tokens JWT.
- `DASHBOARD_USER`: usuário único do dashboard.
- `DASHBOARD_PASSWORD_HASH`: hash bcrypt da senha (gerar com `npm run hash-password -- <senha>`).

## Setup inicial
1. `npm install`
2. `npm run hash-password -- <senha-desejada>` e copiar o hash para `.env`
3. `npm run db:migrate` (cria as tabelas SQLite)
4. `npm run dev`
5. Acessar `http://localhost:8080/dashboard/login.html`
