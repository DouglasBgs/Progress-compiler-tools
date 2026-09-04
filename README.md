# OpenEdge ABL Remote Compiler

Extensão para Visual Studio Code que oferece compilação remota de arquivos **OpenEdge ABL** (Progress) `.p`, `.py`, `.w`, `.cls` e `.i` diretamente do editor.

---

## 📋 Índice

- [Funcionalidades](#-funcionalidades)
- [Pré-requisitos](#-pré-requisitos)
- [Instalação](#-instalação)
- [Repositório e CI/CD](#-repositório-e-cicd)
- [Configuração do Servidor de Compilação](#-configuração-do-servidor-de-compilação)
- [Configuração da Extensão no VSCode](#-configuração-da-extensão-no-vscode)
- [Como Usar](#-como-usar)
- [Estrutura de Armazenamento de Servidores](#-estrutura-de-armazenamento-de-servidores)
- [Comandos Disponíveis](#-comandos-disponíveis)
- [Atalhos de Teclado](#-atalhos-de-teclado)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Fluxo Completo de Compilação](#-fluxo-completo-de-compilação)
- [CI/CD e Releases Automáticos](#-cicd-e-releases-automáticos)
- [Solução de Problemas](#-solução-de-problemas)

---

## ✨ Funcionalidades

### 🔨 Compilação Remota
- Compilação de um ou **múltiplos arquivos** selecionados no Explorer ou Git (Source Control)
- Acionamento via menu de contexto (clique direito) ou tecla **F5**
- Suporte a quatro tipos de compilação/bancos de dados: **Progress**, **SQL Server**, **Oracle** e **Patch**
- Envio dos fontes em Base64 ao servidor — **sem dependência de drives de rede** no cliente
- Retorno dos binários `.r` compilados diretamente para o VSCode
- Resumo dos fontes enviados exibido no canal **ABL Compiler** enquanto aguarda a fila de compilação
- Opção para incluir automaticamente includes (`.i`) modificadas no Git durante a compilação
- Exibição detalhada de erros de compilação no canal **ABL Compiler** (Output)
- Exclusão automática de `.r` inválidos em caso de falha de compilação

### 📋 Análise Estática de Logs OpenEdge
- Análise local de arquivos `.lst`, `.log`, `.lg` e `.txt`, sem envio do conteúdo para serviços externos
- Suporte automático a logs AVM/4GL de cliente (`[DD/MM/YY@...] P-... T-...`) e AppServer Agent (`ISO-8601 PID THREAD AS-...`)
- Detecção do formato e normalização para timestamp, processo, thread, categoria e mensagem
- Leitura de arquivos UTF-8 e ISO-8859-1, comum em logs OpenEdge legados
- Identificação de erros técnicos, warnings de negócio (`RowErrors`, `tt_log_erros`), procedures lentas e chamadas frequentes
- Visão de conexões de bancos, arquivos abertos via `FILEID` e carga por processo/thread
- Parâmetros entre aspas presentes nos traces são omitidos no relatório

### 📊 Dashboard de Rastreamento de Compilação
- Fila com até **3 compilações concorrentes** e notificação de status por WebSocket
- Persistência de métricas de jobs em **SQLite**, gerenciada por **TypeORM**
- Histórico de job, hostname, IP, banco/repositório, quantidade de arquivos e fontes ABL, resultado, erros e duração
- Dashboard protegido por login com senha em hash **bcrypt**, token **JWT** (expiração de 1 hora) e limitação de tentativas de login
- Indicadores de total de jobs e arquivos, máquinas distintas, média de arquivos por job e duração média
- Gráficos de jobs por status, máquina e banco de dados, além da lista dos jobs recentes
- Importação idempotente de histórico a partir do `output.log`, sem duplicar jobs já armazenados

### 📦 Destinos Flexíveis e Inteligentes para os `.r`
Ao iniciar a compilação, você escolhe primeiro onde salvar os binários. Caso o servidor escolhido possua um **banco de dados de preferência pré-configurado**, a compilação é iniciada automaticamente poupando cliques:

| Opção | Descrição |
|-------|-----------|
| 🏠 **Workspace Local** | Salva na estrutura de pastas do projeto, mantendo o caminho original (com `src/`) |
| 🖥️ **Servidor Cadastrado** | Salva em um servidor previamente configurado (Linux ou Windows), podendo possuir um banco de preferência associado |
| 📁 **Selecionar Pasta...** | Abre o seletor de pasta do sistema (uso único, não salva) |
| ➕ **Configurar Novo Servidor...** | Adiciona o servidor permanentemente à lista, permitindo definir seu banco de preferência |

### ⚙️ Gerenciamento de Servidores de Destino
- Adicionar, editar e remover servidores com interface guiada
- Seleção de pasta via **diálogo gráfico** ou digitação manual (para caminhos UNC Windows `\\servidor\share`)
- Suporte a servidores **por plataforma**: Linux 🐧, Windows 💻 ou Ambas 🌐
- Cada usuário vê apenas os servidores compatíveis com seu sistema operacional
- Configuração armazenada em arquivo JSON dedicado, **separado do `settings.json`** do VSCode
- Validação automática de host UNC confiável (`security.allowedUNCHosts`) ao adicionar/editar servidor
- Solicitação de reinício do VSCode **somente após salvar** toda a configuração do servidor

### 🧭 Menu Lateral da Extensão
- Container **ABL** na barra lateral do VSCode (Activity Bar)
- Ações rápidas no menu da extensão:
  - Selecionar Arquivos e Compilar
  - Ajustar Configurações
  - Adicionar Servidor
  - Excluir Servidor
  - Gerenciar Servidores

---

## 📌 Pré-requisitos

### Cliente (VSCode)
- Visual Studio Code `>= 1.85.0`
- Workspace aberto (pasta de projeto)
- Estrutura de fontes ABL preferencialmente dentro de uma pasta **`src/`** na raiz do workspace

### Servidor de Compilação
- Node.js `>= 18`
- OpenEdge / Progress instalado na máquina do servidor
- Variável de ambiente `DLC` apontando para o diretório de instalação do Progress
  - Windows: `C:\dlc128` (ou o caminho correto da sua instalação)
  - Linux: `/usr/dlc` (ou equivalente)

---

## 🚀 Instalação

### 1. Instalar a extensão no VSCode

```bash
# Baixe a versão mais recente (.vsix) direto do GitHub:
# https://github.com/DouglasBgs/Progress-compiler-tools/releases

# No VSCode: Extensions (Ctrl+Shift+X) → ··· → Install from VSIX...
```

---

## 🔗 Repositório e CI/CD

O projeto conta com automação completa de versionamento e release via **GitHub Actions**.

### Ciclo de Release (Patch Automático)
Sempre que um novo commit é enviado para a branch `main`:
1. **Versionamento**: O número da versão é incrementado automaticamente no `package.json` (ex: `0.0.1` → `0.0.2`).
2. **Tagging**: Uma nova tag de versão (ex: `v0.0.2`) é criada no repositório.
3. **Build**: O pacote `.vsix` é gerado utilizando Node.js 24.
4. **Deploy**: Uma nova **Release** é publicada automaticamente no GitHub contendo o arquivo de instalação.

**🔗 Repositório Oficial:** [GitHub - DouglasBgs/Progress-compiler-tools](https://github.com/DouglasBgs/Progress-compiler-tools)

---

### 2. Instalar e iniciar o Servidor de Compilação

O servidor de compilação é um processo Node.js separado que deve rodar na máquina onde o OpenEdge está instalado.

```bash
# Acesse a pasta do servidor
cd compile-server

# Instale as dependências
npm install

# Configure o ambiente (veja a seção abaixo)
# Edite o arquivo .env com seus valores

# Build de produção
npm run build

# Inicie o servidor
npm start

# OU inicie em modo desenvolvimento (com ts-node, sem build)
npm run dev
```

---

## 🖥️ Configuração do Servidor de Compilação

### Arquivo `.env`

Localizado em `compile-server/.env`:

```env
# Porta em que o servidor vai escutar
PORT=8080

# Caminho de instalação do OpenEdge/Progress (DLC)
# Windows:
DLC=C:\dlc128
# Linux:
# DLC=/usr/dlc

# Credenciais do dashboard
# Gere JWT_SECRET com: openssl rand -hex 32
JWT_SECRET=troque-por-um-segredo-aleatorio-forte
DASHBOARD_USER=admin
# Gere o hash com: npm run hash-password -- <senha>
DASHBOARD_PASSWORD_HASH=
```

> **Segurança:** nunca versione o arquivo `.env`. Em produção, publique o dashboard somente sob HTTPS por meio de um reverse proxy e utilize um `JWT_SECRET` aleatório e exclusivo por ambiente.

### Arquivo `server.config.json`

Localizado em `compile-server/server.config.json`. Define os parâmetros de conexão para cada banco de dados suportado. Cada banco precisa de um arquivo `.pf` (parameter file) e opcionalmente um `.ini`.

Os caminhos de `.pf` e `.ini` suportam o placeholder **`{repository}`**, que será substituído dinamicamente pelo repositório de compilação enviado pela extensão (ex: `EMS2.08`, `CRM`, etc.).

```json
{
  "defaultRepository": "EMS2.08",
  "databases": {
    "Progress": {
      "pf": "\\\\meu-servidor\\compilacao\\{repository}\\connect.pf",
      "ini": "\\\\meu-servidor\\compilacao\\{repository}\\progress.ini"
    },
    "SQL Server": {
      "pf": "\\\\meu-servidor\\compilacao\\sql\\{repository}\\connect.pf",
      "ini": "\\\\meu-servidor\\compilacao\\sql\\{repository}\\progress.ini"
    },
    "Oracle": {
      "pf": "\\\\meu-servidor\\compilacao\\oracle\\{repository}\\connect.pf",
      "ini": "\\\\meu-servidor\\compilacao\\oracle\\{repository}\\progress.ini"
    }
  },
  "patchConfig": {
    "baseDir": "\\\\meu-servidor\\arquivos\\patches",
    "baseShortcut": "\\\\meu-servidor\\arquivos\\atalhos"
  }
}
```

| Campo | Descrição |
|-------|-----------|
| `defaultRepository` | Repositório padrão utilizado quando a extensão não envia o campo (retrocompatibilidade). |
| `{repository}` | Placeholder que será substituído pelo valor do repositório escolhido na extensão. |

> **Importante:** Apenas os bancos configurados aqui estarão disponíveis para seleção no VSCode. A chave `patchConfig` é obrigatória caso deseje utilizar a compilação no modo **Patch**.

### Funcionamento do `patchConfig`

O modo Patch resolve caminhos dinamicamente com base na versão informada.
- **baseDir**: Diretório raiz onde os patches estão descompactados.
- **baseShortcut**: Diretório onde estão os arquivos de configuração (.ini) dos ambientes.

A lógica de busca de arquivos segue o padrão:
- **PF**: `{baseDir}/{patchVersion}/{subType}/connect-ems2.pf`
- **INI**: `{baseShortcut}/{versao_reduzida}/{subType}/{repository}/progress-12.ini`

> O valor de `{repository}` é dinâmico e depende da configuração da extensão.


### Scripts disponíveis no servidor

| Script | Descrição |
|--------|-----------|
| `npm run dev` | Execução em desenvolvimento (ts-node, sem build) |
| `npm run build` | Compila TypeScript para `dist/` e copia os arquivos estáticos do dashboard |
| `npm start` | Inicia a partir do build compilado (`dist/server.js`) |
| `npm run watch` | Assiste e recompila TypeScript automaticamente |
| `npm run db:migrate` | Cria/atualiza o banco SQLite e as tabelas em desenvolvimento |
| `npm run db:migrate:prod` | Cria/atualiza o banco SQLite a partir do build de produção |
| `npm run hash-password -- <senha>` | Gera o hash bcrypt para `DASHBOARD_PASSWORD_HASH` |
| `npm run hash-password:prod -- <senha>` | Gera o hash bcrypt usando o build de produção |
| `npm run logs:import -- <arquivo>` | Importa o histórico de jobs de um `output.log` em desenvolvimento |
| `npm run logs:import:prod -- <arquivo>` | Importa o histórico de jobs a partir do build de produção |
| `npm run test:logs` | Executa os testes do parser de logs |

### Dashboard, métricas e histórico

O servidor registra uma métrica para cada job recebido e a atualiza quando a compilação é concluída ou falha. Os dados são gravados em `compile-server/data/dashboard.sqlite`; esse arquivo deve receber backup conforme a política operacional do ambiente.

Depois de instalar as dependências e configurar o `.env`, inicialize a base e, se houver histórico anterior, importe o arquivo de log antes de iniciar o servidor:

```bash
# Desenvolvimento
npm run db:migrate
npm run logs:import -- output.log
npm run dev

# Produção, após npm ci --omit=dev e npm run build
npm run db:migrate:prod
npm run logs:import:prod -- C:\compile-server-progress\output.log
npm start
```

A importação usa o `jobId` como chave lógica: reexecutar o mesmo comando atualiza os registros existentes e não cria duplicidades. O parser recupera hostname, IP, tipo de banco, repositório, quantidades de arquivos/fontes, resultado, erros e duração quando esses eventos estão presentes no log.

O dashboard fica disponível em:

```text
http://ip-do-servidor:8080/dashboard/login.html
```

As rotas abaixo são registradas no boot e exibidas no log do servidor:

| Método | Rota | Acesso |
|--------|------|--------|
| `POST` | `/compile` | Extensão VSCode |
| `GET` | `/result/:jobId` | Extensão VSCode |
| `POST` | `/api/auth/login` | Público, limitado a 5 tentativas por 15 minutos/IP |
| `GET` | `/api/dashboard/metrics` | JWT obrigatório |
| `GET` | `/api/dashboard/jobs` | JWT obrigatório |
| `GET` | `/dashboard/*` | Arquivos estáticos do dashboard |

> **LGPD:** o dashboard armazena IP e hostname para monitoramento operacional e segurança do serviço. São persistidos apenas metadados e contadores, nunca os nomes ou conteúdos dos arquivos enviados. Restrinja o acesso ao dashboard às pessoas que precisam desses dados e defina a rotina interna de backup, retenção e descarte do banco SQLite.

---

## ⚙️ Configuração da Extensão no VSCode

### URL do Servidor de Compilação

Na primeira vez que você acionar a compilação remota, a extensão solicitará automaticamente o URL do servidor:

```
http://ip-do-servidor:8080/compile
```

Ou configure manualmente via `Arquivo → Preferências → Configurações`:

```json
{
  "abl-linter.compilerUrl": "http://meu-servidor:8080/compile"
}
```

> O URL é salvo globalmente no `settings.json` do usuário e funciona em qualquer workspace.

| Configuração | Tipo | Padrão | Descrição |
|---|---|---|---|
| `abl-linter.compilerUrl` | `string` | `""` | URL do servidor de compilação ABL |
| `abl-linter.autoDetectRepository` | `boolean` | `true` | Identifica automaticamente o repositório/compilador (EMS2, EMS5, FONDATION, CRM, HCM, etc.) com base na pasta raiz que precede `progress/src/` |
| `abl-linter.enableCompilationRepository` | `boolean` | `false` | Habilita a seleção manual do repositório de compilação |
| `abl-linter.compilationRepository` | `string` | `"EMS2.08"` | Repositório padrão / fallback |
| `abl-linter.includeGitChangedIncludes` | `boolean` | `false` | Inclui automaticamente includes (`.i`) modificadas no Git quando encontradas nas referências dos fontes compilados |

### Identificação Automática de Pastas e Multipastas

A extensão identifica automaticamente o ambiente/compilador com base no nome da pasta raiz que precede `progress/src/` (ou `src/`):

- `EMS2/progress/src/...` $\rightarrow$ **EMS 2.08** (`EMS2.08`)
- `EMS5/progress/src/...` $\rightarrow$ **EMS 5.08** (`EMS5.08`)
- `FONDATION/progress/src/...` $\rightarrow$ **FND 1.02** (`FND1.02`)
- `CRM/progress/src/...` $\rightarrow$ **CRM**
- `HCM/progress/src/...` $\rightarrow$ **HCM 2.11A** (`HCM2.11A`)
- `GP/progress/src/...` $\rightarrow$ **GP 3.50** (`GP3.50`)
- `EAI/progress/src/...` $\rightarrow$ **EAI 1.00** (`EAI1.00`)
- `HUB/progress/src/...` $\rightarrow$ **HUB**

#### Suporte a Multipastas e Priorização de Compilação
Caso você selecione arquivos ou pastas pertencentes a produtos distintos ao mesmo tempo (ex: `FONDATION` e `EMS2`):
1. A extensão identifica todos os arquivos e extrai os caminhos relativos limpos após `progress/src/`, enviando todos conjuntamente no mesmo lote de compilação.
2. Um diálogo de seleção (**QuickPick**) é apresentado para você definir qual compilador/ambiente priorizar para a compilação (ex: priorizar `FONDATION` ou `EMS2`).
3. Ao finalizar, cada arquivo `.r` compilado é gravado diretamente no diretório original do respectivo fonte local (`FONDATION/...` ou `EMS2/...`).

A barra de status inferior exibe em tempo real o repositório/pasta ativa detectada no editor (`$(repo) ABL: EMS2`, `$(repo) ABL: FONDATION`).


---

## 📖 Como Usar

---

### Compilação Remota

#### Opção 1: Menu de Contexto (Explorer)

1. Selecione um ou mais arquivos `.p` / `.py` / `.w` / `.cls` / `.i` no Explorer  
   (use `Ctrl+Click` para selecionar múltiplos)
2. Clique com o botão direito → **ABL Compilar**
3. Siga o assistente guiado

#### Opção 2: Tecla de Atalho F5

1. Com um arquivo ABL aberto e focado no editor, pressione **`F5`**
2. O arquivo atual será enviado para compilação

#### Opção 3: Menu Lateral (Selecionar Arquivos e Compilar)

1. Abra o menu lateral da extensão em **ABL**
2. Clique em **Selecionar Arquivos e Compilar**
3. Selecione um ou mais arquivos no diálogo do sistema
4. Siga o assistente de destino/banco normalmente

#### Fluxo do Assistente (Ordem Atualizada)

Para agilizar o fluxo, agora você informa primeiro o **destino** da compilação. Se o destino possuir um banco preferencial pré-configurado, a compilação ocorre **instantaneamente** sem novas perguntas!

```
┌────────────────────────────────────────────────┐
│  1. Onde salvar os arquivos .r?                │
│     ○ 🏠 Workspace Local                       │
│     ○ 🖥️ 🐧 Servidor Linux   /mnt/prod/bin     │
│     ○ 🖥️ 💻 Servidor Windows   \\srv\hom\bin   │
│     ○ 📁 Selecionar Pasta...                   │
│     ○ ➕ Configurar Novo Servidor...           │
└────────────────────────────────────────────────┘
               ↓ (Se o servidor NÃO tiver banco padrão configurado)
┌────────────────────────────────────────────────┐
│  2. Selecione o Banco de Dados                 │
│     ○ Progress                                 │
│     ○ SQL Server                               │
│     ○ Oracle                                   │
│     ○ Patch                                    │
└────────────────────────────────────────────────┘
```

#### Estrutura de Pastas do Workspace

> ℹ️ **Recomendado:** manter os arquivos-fonte ABL em uma pasta **`src/`** na raiz do workspace para preservar o mapeamento de caminhos esperado no envio e no retorno dos `.r`.

A extensão utiliza a pasta `src/` como referência para montar os caminhos de compilação e destino dos binários `.r`. A estrutura esperada é:

```
meu-projeto/                   ← Workspace aberto no VSCode
├── src/                       ← Pasta obrigatória para os fontes
│   ├── modulo-a/
│   │   ├── programa1.p
│   │   └── programa2.w
│   ├── modulo-b/
│   │   ├── classe.cls
│   │   └── include.i
│   └── utils/
│       └── helper.p
└── ...
```

Arquivos fora da pasta `src/` podem ser compilados, mas o mapeamento de caminho final pode variar conforme a estrutura do projeto.

#### Comportamento do caminho dos arquivos `.r`

Após a compilação, o destino dos binários `.r` varia conforme a opção escolhida:

| Destino | Exemplo de entrada | Exemplo de saída `.r` |
|---------|-------------------|----------------------|
| Workspace Local | `src/modulo/programa.p` | `src/modulo/programa.r` |
| Servidor Externo | `src/modulo/programa.p` | `modulo/programa.r` (sem prefixo `src/`) |

> O prefixo `src/` é removido automaticamente ao enviar para servidores externos, permitindo deploy direto na estrutura de produção.

---

### Compilação de Múltiplos Fontes

A extensão suporta a **compilação em lote** de múltiplos arquivos-fonte selecionados diretamente pelo Explorer do VSCode.

#### Como usar

1. No **Explorer** do VSCode, selecione os arquivos desejados:  
   - Mantenha `Ctrl` pressionado e clique em cada arquivo para seleção individual  
   - Ou use `Shift+Click` para selecionar um intervalo contínuo de arquivos
2. Clique com o **botão direito** sobre a seleção
3. Selecione **ABL Compilar** no menu de contexto
4. Escolha o destino dos `.r` e o banco de dados normalmente

> Todos os arquivos selecionados serão enviados ao servidor de compilação em uma **única requisição**, otimizando o tempo total de compilação.

#### Extensões suportadas para seleção múltipla

| Extensão | Tipo |
|----------|------|
| `.p` | Procedure |
| `.py` | Código / Script (.py) |
| `.w` | Window / Persistent Procedure |
| `.cls` | Classe ABL |
| `.i` | Include |

---

### Compilação via Git (Source Control)

Além do Explorer, é possível compilar fontes diretamente pela **aba de Source Control (Git)** do VSCode. Isso é especialmente útil para compilar rapidamente os arquivos que foram modificados no controle de versão.

#### Como usar

1. Abra a aba **Source Control** (`Ctrl+Shift+G`)
2. Na seção **Changes**, selecione os arquivos que deseja compilar:  
   - Clique no arquivo para selecionar um único fonte  
   - Use `Ctrl+Click` para selecionar múltiplos arquivos modificados
3. Clique com o **botão direito** sobre a seleção
4. Selecione **ABL Compilar** no menu de contexto
5. Siga o assistente normalmente (destino dos `.r` → banco de dados se necessário)

> O botão **ABL Compilar** também aparece como um ícone **inline** ao lado de cada arquivo na lista de mudanças, permitindo compilar rapidamente um único fonte com um clique.

#### Includes modificadas no Git (opcional)

Quando a configuração `abl-linter.includeGitChangedIncludes` estiver habilitada, a extensão:

1. Lê os fontes selecionados para compilação.
2. Identifica referências de include no padrão ABL (ex: `{abl/file.i}`).
3. Usa o buscador de arquivos do próprio VSCode para localizar o caminho real da include no workspace.
4. Verifica no Git (`staged` e `unstaged`) se essa include está modificada.
5. Adiciona automaticamente a include modificada ao payload da compilação.

#### Cenários de uso

| Cenário | Ação |
|---------|------|
| Compilar um fonte modificado | Clique no ícone inline ao lado do arquivo na aba Git |
| Compilar vários fontes alterados | Selecione múltiplos com `Ctrl+Click` → botão direito → **ABL Compilar** |
| Compilar todas as mudanças | Clique direito no grupo **Changes** → **ABL Compilar** |

---

### Compilação de Patches

Ideal para compilar correções pontuais em ambientes de patch específicos sem precisar configurar cada banco manualmente no servidor.

1. Acione a compilação remota (`F5` ou Menu de Contexto).
2. Selecione um destino sem banco de preferência associado (ex: Workspace Local ou um Servidor sem banco padrão).
3. Selecione a opção **Patch** na lista de Bancos de Dados.
4. Informe a **Versão do Patch** (Ex: `12.1.2024.1`).
   - *A extensão lembrará da última versão informada para facilitar.*
5. Selecione o **Tipo de Banco** (Progress, SQL Server ou Oracle).

O servidor então localizará os arquivos `.pf` e `.ini` correspondentes na estrutura de diretórios configurada no `patchConfig`.

---�as, permitindo compilar rapidamente um único fonte com um clique.

#### Cenários de uso

| Cenário | Ação |
|---------|------|
| Compilar um fonte modificado | Clique no ícone inline ao lado do arquivo na aba Git |
| Compilar vários fontes alterados | Selecione múltiplos com `Ctrl+Click` → botão direito → **ABL Compilar** |
| Compilar todas as mudanças | Clique direito no grupo **Changes** → **ABL Compilar** |

---

### Compilação de Patches

Ideal para compilar correções pontuais em ambientes de patch específicos sem precisar configurar cada banco manualmente no servidor.

1. Acione a compilação remota (`F5` ou Menu de Contexto).
2. Selecione a opção **Patch** na lista de Bancos de Dados.
3. Informe a **Versão do Patch** (Ex: `12.1.2024.1`).
   - *A extensão lembrará da última versão informada para facilitar.*
4. Selecione o **Tipo de Banco** (Progress, SQL Server ou Oracle).

O servidor então localizará os arquivos `.pf` e `.ini` correspondentes na estrutura de diretórios configurada no `patchConfig`.

---

### Gerenciar Servidores de Destino

Acesse via **Paleta de Comandos** (`Ctrl+Shift+P`):

```
OpenEdge ABL: Gerenciar Servidores de Destino
```

#### ➕ Adicionar Servidor

1. Selecione **Adicionar Novo Servidor**
2. Informe o **nome** (ex: `Produção`, `Homologação`)
3. Escolha a **plataforma** de visibilidade:

| Opção | Quem vê |
|-------|---------|
| 🐧 Linux | Apenas usuários com VSCode no Linux |
| 💻 Windows | Apenas usuários com VSCode no Windows |
| 🌐 Ambas | Todos os usuários |

4. Informe o **caminho** de destino:
   - **Selecionar Pasta** → abre o explorador de arquivos nativo do sistema operacional
   - **Digitar Caminho** → digitação manual (necessário para caminhos UNC: `\\servidor\share\bin`)
5. Se o caminho for UNC e o host ainda não estiver confiável:
  - A extensão solicita autorização para adicionar o host em `security.allowedUNCHosts`
  - Após salvar a configuração do servidor, a extensão informa a necessidade de reiniciar o VSCode
  - Você pode escolher **Reiniciar Agora** ou **Depois**

#### ✏️ Editar Servidor

1. Selecione **Editar Servidor**
2. Escolha o servidor na lista
3. Atualize nome, plataforma e/ou caminho

#### 🗑️ Remover Servidor

1. Selecione **Remover Servidor**
2. Marque um ou mais servidores com `Espaço` (seleção múltipla)
3. Pressione `Enter` para confirmar

#### 📄 Edição Manual do JSON

1. Selecione **Abrir Arquivo de Configuração**
2. O arquivo `servers.json` abrirá diretamente no editor para edição livre

---

## 💾 Estrutura de Armazenamento de Servidores

Os servidores são armazenados em um **arquivo dedicado da extensão**, completamente separado do `settings.json` do VSCode:

```
Linux:   ~/.config/Code/User/globalStorage/douglasbarbosa.progress-compiler-tools/servers.json
Windows: %APPDATA%\Code\User\globalStorage\douglasbarbosa.progress-compiler-tools\servers.json
```

### Formato do `servers.json`

```json
[
  {
    "name": "Produção Linux",
    "path": "/mnt/producao/bin",
    "platform": "linux"
  },
  {
    "name": "Servidor App Windows",
    "path": "\\\\servidor\\share\\bin",
    "platform": "windows"
  },
  {
    "name": "Homologação",
    "path": "/mnt/homologacao/bin",
    "platform": "any"
  }
]
```

| Campo | Tipo | Valores | Descrição |
|-------|------|---------|-----------|
| `name` | string | — | Nome de exibição do servidor |
| `path` | string | — | Caminho absoluto do diretório de destino |
| `platform` | string | `linux` \| `windows` \| `any` | Sistema operacional que verá este servidor |

---

## 📟 Comandos Disponíveis

| Paleta de Comandos | ID interno | Descrição |
|--------------------|------------|-----------|
| `OpenEdge ABL: ABL Compilar` | `abl-linter.compileRemote` | Compila arquivo(s) selecionado(s) ou aberto no editor |
| `OpenEdge ABL: Gerenciar Servidores de Destino` | `abl-linter.manageServers` | Abre o gerenciador de servidores |
| `OpenEdge ABL: Adicionar Servidor de Destino` | `abl-linter.addServer` | Abre diretamente o fluxo de adição de servidor |
| `OpenEdge ABL: Excluir Servidor de Destino` | `abl-linter.removeServer` | Abre diretamente o fluxo de remoção de servidor |
| `OpenEdge ABL: Abrir Configurações da Extensão` | `abl-linter.openSettings` | Abre as configurações da extensão filtradas por `abl-linter` |
| `OpenEdge ABL: Selecionar Arquivos e Compilar` | `abl-linter.selectFilesAndCompile` | Permite escolher arquivos no diálogo e enviar para compilação |
| `OpenEdge ABL: Analisar Log` | `abl-linter.analyzeLog` | Gera análise estática local de erros, performance, bancos, arquivos e processos de um log OpenEdge |

---

## ⌨️ Atalhos de Teclado

| Atalho | Ação | Condição |
|--------|------|----------|
| `F5` | Compilar arquivo ABL ativo | Editor com arquivo `.p`, `.w` ou `.cls` focado |

> Para personalizar: `Ctrl+K Ctrl+S` → pesquise por `abl-linter.compileRemote`

---

## 🗂️ Estrutura do Projeto

```
/
├── src/                          # Código-fonte da extensão VSCode
│   ├── extension.ts              # Ponto de entrada (activate/deactivate)
│   ├── config/
│   │   └── serversConfig.ts      # Gerenciador do arquivo servers.json
│   ├── commands/
│   │   ├── remoteCompile.ts      # Comando de compilação remota
│   │   └── manageServers.ts      # Comando de gerenciamento de servidores
│   ├── views/
│   │   └── sidebarMenu.ts        # Menu lateral (Activity Bar) e atalhos de ação
│
├── compile-server/               # Servidor de compilação Node.js (separado)
│   ├── src/
│   │   └── server.ts             # API Express + integração com Progress
│   ├── server.config.json        # Configuração dos bancos de dados
│   ├── .env                      # Porta e caminho DLC
│   └── package.json
│
├── package.json                  # Manifesto da extensão VSCode
└── language-configuration.json   # Configuração da linguagem ABL
```

---

## 🔄 Fluxo Completo de Compilação

```
VSCode (Cliente)                        Servidor (Node.js + Progress)
────────────────────────────────        ─────────────────────────────────────
1. Seleciona arquivo(s) ABL
2. Escolhe banco de dados
3. Lê arquivo(s) em disco → Base64
4. POST /compile ──────────────────────→ Recebe payload JSON
                                          5. Cria pasta temp/UUID/
                                          6. Desempacota os fontes
                                          7. Gera _mass_compile.p dinamicamente
                                          8. Executa:
                                             prowin -b -pf connect.pf -p _mass_compile.p
                                          9. Lê compile_report.json gerado
                                         10. Coleta binários .r de resultado/
                                         11. Remove pasta temp/UUID/
                   ←────────────────────  12. Retorna { compiledFiles[], errors[] }
13. SE erros → exibe no Output
    SE sucesso → pergunta destino
14. Grava .r no destino escolhido
```

---

## 🛠️ Solução de Problemas

### ❌ "Falha na Compilação Remota: connect ECONNREFUSED"
O servidor de compilação não está acessível. Verifique:
- O processo `node dist/server.js` está rodando na máquina servidor
- A porta `8080` (ou configurada no `.env`) está liberada no firewall
- O URL em `abl-linter.compilerUrl` está correto (sem barra no final)

### ❌ "O banco de dados 'X' não está mapeado no server.config.json"
O `server.config.json` não possui a chave para o banco selecionado. Edite o arquivo no servidor e adicione a configuração correspondente.

### ❌ Compilador Progress não encontrado
Defina a variável `DLC` no sistema ou no `.env` do servidor:
```env
DLC=C:\dlc128         # Windows
DLC=/usr/dlc          # Linux
```

### ❌ Servidores não aparecem após reiniciar o VSCode
Verifique se o arquivo `servers.json` existe e está acessível:
- **Linux:** `~/.config/Code/User/globalStorage/douglasbarbosa.progress-compiler-tools/servers.json`
- **Windows:** `%APPDATA%\Code\User\globalStorage\douglasbarbosa.progress-compiler-tools\servers.json`

Use `OpenEdge ABL: Gerenciar Servidores de Destino → Abrir Arquivo de Configuração` para inspecionar o arquivo diretamente.

### ❌ Arquivo `.i` não aparece no menu de contexto
O menu de contexto do Explorer suporta `.p`, `.w`, `.cls` e `.i`. Certifique-se de que a extensão está ativada (abra qualquer arquivo `.p` para forçar a ativação).

---

## 🧑‍💻 Desenvolvimento

```bash
# Instalar dependências da extensão
cd /raiz-do-projeto
npm install

# Compilar extensão
npm run compile

# Modo watch (recompila automaticamente)
npm run watch

# Abrir no Extension Development Host
# Pressione F5 no VSCode com o projeto aberto
```

---

## 📄 Licença

Este projeto está licenciado sob a **Licença MIT** — consulte o texto abaixo para mais detalhes.

```
Licença MIT

Copyright (c) 2026 Douglas Barbosa

A permissão é concedida, gratuitamente, a qualquer pessoa que obtenha uma cópia
deste software e dos arquivos de documentação associados (o "Software"), para
lidar com o Software sem restrições, incluindo, sem limitação, os direitos de
usar, copiar, modificar, mesclar, publicar, distribuir, sublicenciar e/ou vender
cópias do Software, e permitir que as pessoas a quem o Software é fornecido o
façam, sujeitas às seguintes condições:

O aviso de copyright acima e este aviso de permissão devem ser incluídos em
todas as cópias ou partes substanciais do Software.

O SOFTWARE É FORNECIDO "COMO ESTÁ", SEM GARANTIA DE QUALQUER TIPO, EXPRESSA OU
IMPLÍCITA, INCLUINDO, MAS NÃO SE LIMITANDO ÀS GARANTIAS DE COMERCIALIZAÇÃO,
ADEQUAÇÃO A UM DETERMINADO FIM E NÃO VIOLAÇÃO. EM NENHUM CASO OS AUTORES OU
TITULARES DOS DIREITOS AUTORAIS SERÃO RESPONSÁVEIS POR QUALQUER REIVINDICAÇÃO,
DANOS OU OUTRA RESPONSABILIDADE, SEJA EM AÇÃO CONTRATUAL, DELITUAL OU DE OUTRA
FORMA, DECORRENTE DE, OU EM CONEXÃO COM O SOFTWARE OU O USO OU OUTRAS
NEGOCIAÇÕES NO SOFTWARE.
```

