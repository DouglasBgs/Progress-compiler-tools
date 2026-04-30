# OpenEdge ABL Linter & Remote Compiler

Extensão para Visual Studio Code que oferece análise estática de código **OpenEdge ABL** (Progress) em tempo real e compilação remota de arquivos `.p`, `.w`, `.cls` e `.i` diretamente do editor.

---

## 📋 Índice

- [Funcionalidades](#-funcionalidades)
- [Pré-requisitos](#-pré-requisitos)
- [Instalação](#-instalação)
- [Repositório e CI/CD](#-repositório-e-cicd)
- [Configuração do Servidor de Compilação](#-configuração-do-servidor-de-compilação)
- [Configuração da Extensão no VSCode](#-configuração-da-extensão-no-vscode)
- [Como Usar](#-como-usar)
  - [Linter em Tempo Real](#linter-em-tempo-real)
  - [Compilação Remota](#compilação-remota)
  - [Compilação de Múltiplos Fontes](#compilação-de-múltiplos-fontes)
  - [Compilação via Git (Source Control)](#compilação-via-git-source-control)
  - [Compilação de Patches](#compilação-de-patches)
  - [Gerenciar Servidores de Destino](#gerenciar-servidores-de-destino)
- [Estrutura de Armazenamento de Servidores](#-estrutura-de-armazenamento-de-servidores)
- [Comandos Disponíveis](#-comandos-disponíveis)
- [Atalhos de Teclado](#-atalhos-de-teclado)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Fluxo Completo de Compilação](#-fluxo-completo-de-compilação)
- [Regras do Linter](#-regras-do-linter)
- [CI/CD e Releases Automáticos](#-cicd-e-releases-automáticos)
- [Solução de Problemas](#-solução-de-problemas)

---

## ✨ Funcionalidades

### 🔍 Linter Estático (ABL)
- Análise de código em tempo real ao **salvar** arquivos ABL
- Detecção automática de arquivos `.p`, `.w`, `.cls` e `.i`
- Exibição de erros e avisos direto na aba **Problems** do VSCode
- Limpeza automática de diagnósticos ao fechar o arquivo

### 🔨 Compilação Remota
- Compilação de um ou **múltiplos arquivos** selecionados no Explorer
- Acionamento via menu de contexto (clique direito) ou tecla **F5**
- Suporte a três tipos de banco de dados: **Progress**, **SQL Server** e **Oracle**
- Envio dos fontes em Base64 ao servidor — **sem dependência de drives de rede** no cliente
- Retorno dos binários `.r` compilados diretamente para o VSCode
- Exibição detalhada de erros de compilação no canal **ABL Compiler** (Output)
- Exclusão automática de `.r` inválidos em caso de falha de compilação

### 📦 Destinos Flexíveis para os `.r`
Após compilação bem-sucedida, você escolhe onde salvar os binários:

| Opção | Descrição |
|-------|-----------|
| 🏠 **Workspace Local** | Salva na estrutura de pastas do projeto, mantendo o caminho original (com `src/`) |
| 🖥️ **Servidor Cadastrado** | Salva em um servidor previamente configurado (Linux ou Windows) |
| 📁 **Selecionar Pasta...** | Abre o seletor de pasta do sistema (uso único, não salva) |
| ➕ **Configurar Novo Servidor...** | Adiciona o servidor permanentemente à lista e salva os `.r` |

### ⚙️ Gerenciamento de Servidores de Destino
- Adicionar, editar e remover servidores com interface guiada
- Seleção de pasta via **diálogo gráfico** ou digitação manual (para caminhos UNC Windows `\\servidor\share`)
- Suporte a servidores **por plataforma**: Linux 🐧, Windows 🪟 ou Ambas 🌐
- Cada usuário vê apenas os servidores compatíveis com seu sistema operacional
- Configuração armazenada em arquivo JSON dedicado, **separado do `settings.json`** do VSCode

---

## 📌 Pré-requisitos

### Cliente (VSCode)
- Visual Studio Code `>= 1.85.0`
- Workspace aberto (pasta de projeto)

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
```

### Arquivo `server.config.json`

Localizado em `compile-server/server.config.json`. Define os parâmetros de conexão para cada banco de dados suportado. Cada banco precisa de um arquivo `.pf` (parameter file) e opcionalmente um `.ini`.

```json
{
  "databases": {
    "Progress": {
      "pf": "\\\\servidor\\share\\Compilacao\\Progress\\connect.pf",
      "ini": "\\\\servidor\\share\\Compilacao\\Progress\\progress.ini"
    },
    "SQL Server": {
      "pf": "\\\\servidor\\share\\Compilacao\\SQLServer\\connect.pf",
      "ini": "\\\\servidor\\share\\Compilacao\\SQLServer\\progress.ini"
    },
    "Oracle": {
      "pf": "\\\\servidor\\share\\Compilacao\\Oracle\\connect.pf",
      "ini": "\\\\servidor\\share\\Compilacao\\Oracle\\progress.ini"
    }
  },
  "patchConfig": {
    "baseDir": "\\\\servidor\\patches",
    "baseShortcut": "\\\\servidor\\atalhos"
  }
}
```

> **Importante:** Apenas os bancos configurados aqui estarão disponíveis para seleção no VSCode. A chave `patchConfig` é obrigatória caso deseje utilizar a compilação no modo **Patch**.

### Funcionamento do `patchConfig`

O modo Patch resolve caminhos dinamicamente com base na versão informada.
- **baseDir**: Diretório raiz onde os patches estão descompactados.
- **baseShortcut**: Diretório onde estão os arquivos de configuração (.ini) dos ambientes.

A lógica de busca de arquivos segue o padrão:
- **PF**: `{baseDir}/{patchVersion}/{subType}/connect-ems2.pf`
- **INI**: `{baseShortcut}/{versao_reduzida}/{subType}/EMS2.08/progress-12.ini`


### Scripts disponíveis no servidor

| Script | Descrição |
|--------|-----------|
| `npm run dev` | Execução em desenvolvimento (ts-node, sem build) |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Inicia a partir do build compilado (`dist/server.js`) |
| `npm run watch` | Assiste e recompila TypeScript automaticamente |

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
  "abl-linter.compilerUrl": "http://192.168.1.100:8080/compile"
}
```

> O URL é salvo globalmente no `settings.json` do usuário e funciona em qualquer workspace.

---

## 📖 Como Usar

### Linter em Tempo Real

O linter é ativado **automaticamente** ao abrir ou salvar qualquer arquivo com extensão `.p`, `.w`, `.cls` ou `.i`. Os erros aparecem na aba **Problems** (`Ctrl+Shift+M`) do VSCode.

Nenhuma configuração adicional é necessária.

---

### Compilação Remota

#### Opção 1: Menu de Contexto (Explorer)

1. Selecione um ou mais arquivos `.p` / `.w` / `.cls` / `.i` no Explorer  
   (use `Ctrl+Click` para selecionar múltiplos)
2. Clique com o botão direito → **ABL Compilar**
3. Siga o assistente guiado

#### Opção 2: Tecla de Atalho F5

1. Com um arquivo ABL aberto e focado no editor, pressione **`F5`**
2. O arquivo atual será enviado para compilação

#### Fluxo do Assistente

```
┌────────────────────────────────────────────────┐
│  1. Selecione o Banco de Dados                 │
│     ○ Progress                                 │
│     ○ SQL Server                               │
│     ○ Oracle                                   │
└────────────────────────────────────────────────┘
               ↓ (envia para compilação no servidor)
┌────────────────────────────────────────────────┐
│  2. Onde salvar os arquivos .r?                │
│     ○ 🏠 Workspace Local                        │
│     ○ 🖥️ 🐧 Servidor Linux   /mnt/prod/bin  │
│     ○ 🖥️ 🪟 Servidor Windows   \\srv\hom\bin  │
│     ○ 📁 Selecionar Pasta...                   │
│     ○ ➕ Configurar Novo Servidor...            │
└────────────────────────────────────────────────┘
```

#### Comportamento do caminho dos arquivos `.r`

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
4. Escolha o banco de dados e o destino dos `.r` normalmente

> Todos os arquivos selecionados serão enviados ao servidor de compilação em uma **única requisição**, otimizando o tempo total de compilação.

#### Extensões suportadas para seleção múltipla

| Extensão | Tipo |
|----------|------|
| `.p` | Procedure |
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
5. Siga o assistente normalmente (banco de dados → destino dos `.r`)

> O botão **ABL Compilar** também aparece como um ícone **inline** ao lado de cada arquivo na lista de mudanças, permitindo compilar rapidamente um único fonte com um clique.

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
| 🪟 Windows | Apenas usuários com VSCode no Windows |
| 🌐 Ambas | Todos os usuários |

4. Informe o **caminho** de destino:
   - **Selecionar Pasta** → abre o explorador de arquivos nativo do sistema operacional
   - **Digitar Caminho** → digitação manual (necessário para caminhos UNC: `\\servidor\share\bin`)

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
Linux:   ~/.config/Code/User/globalStorage/douglasbarbosa.openedge-abl-linter/servers.json
Windows: %APPDATA%\Code\User\globalStorage\douglasbarbosa.openedge-abl-linter\servers.json
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
│   ├── diagnostics.ts            # Motor do linter estático ABL
│   ├── config/
│   │   └── serversConfig.ts      # Gerenciador do arquivo servers.json
│   ├── commands/
│   │   ├── remoteCompile.ts      # Comando de compilação remota
│   │   └── manageServers.ts      # Comando de gerenciamento de servidores
│   └── rules/                    # Regras individuais do linter ABL
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

## 🔍 Regras do Linter

| Regra | Severidade | Descrição |
|-------|------------|-----------|
| **Falta de ponto final** | 🔴 Error | Statements que não terminam com `.` |
| **Blocos END desbalanceados** | 🔴 Error | Blocos `DO`, `FOR`, `REPEAT` sem `END` correspondente |
| **IF sem THEN** | 🔴 Error | `IF` sem a palavra-chave `THEN` |
| **Variável não definida** | 🟡 Warning | Variáveis usadas sem `DEFINE VARIABLE` ou `VAR` |
| **String não fechada** | 🔴 Error | Aspas abertas sem fechamento |
| **= em condição** | 🟡 Warning | Uso de `=` em vez de `EQ` em `IF`/`WHERE` |
| **FIND sem NO-ERROR** | 🟡 Warning | `FIND` sem tratamento `NO-ERROR` |
| **DO vazio** | 🔴 Error | Blocos `DO:` seguidos imediatamente de `END.` |
| **FOR EACH sem lock explícito** | 🟡 Warning | `FOR EACH`/`FIRST`/`LAST` sem `NO-LOCK`, `SHARE-LOCK` ou `EXCLUSIVE-LOCK` |
| **CASE sem WHEN** | 🔴 Error | `CASE` sem nenhuma cláusula `WHEN` |
| **DEFINE VARIABLE sem NO-UNDO** | 🟡 Warning | `DEFINE VARIABLE` sem a flag `NO-UNDO` |
| **DELETE OBJECT sem NO-ERROR** | 🟡 Warning | `DELETE OBJECT` sem tratamento de erro |
| **CASE sem OTHERWISE** | 🔵 Info | Sugestão de adicionar `OTHERWISE` em blocos `CASE` |
| **FUNCTION sem RETURN** | 🟡 Warning | `FUNCTION` sem statement de `RETURN` |
| **RUN sem NO-ERROR** | 🟡 Warning | `RUN` de procedures sem `NO-ERROR` |
| **CAN-FIND com EXCLUSIVE-LOCK** | 🔴 Error | `EXCLUSIVE-LOCK` inválido dentro de `CAN-FIND` |
| **MESSAGE sem VIEW-AS** | 🔵 Info | `MESSAGE` sem `VIEW-AS ALERT-BOX` |
| **Falta de Diretiva de Erro** | 🟡 Warning | Ausência de `BLOCK-LEVEL/ROUTINE-LEVEL ON ERROR UNDO, THROW` |

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
- **Linux:** `~/.config/Code/User/globalStorage/douglasbarbosa.openedge-abl-linter/servers.json`
- **Windows:** `%APPDATA%\Code\User\globalStorage\douglasbarbosa.openedge-abl-linter\servers.json`

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

