# Atalhos Progress ABL

118 modelos de código, com descrições em português, sugestões por prefixo e campos editáveis.

## Uso

1. Abra um arquivo no modo **OpenEdge ABL**.
2. No início de uma linha, após a indentação, digite um prefixo como `defvar`, `foreach`, `forfirst`, `dowhile` ou `function`.
3. Escolha a sugestão com as setas e aceite com **Tab** ou **Enter**, conforme as configurações padrão do VS Code.
4. Preencha os campos destacados. **Tab** avança; **Shift+Tab** retorna. O último ponto leva ao corpo ou ao fim do modelo.
5. **Esc** fecha a lista de sugestões.

Os prefixos não diferenciam maiúsculas de minúsculas. Também existem aliases por palavras, como `define variable`, `for each` e `do while`.

As sugestões aparecem automaticamente conforme as configurações do IntelliSense. **Ctrl+Espaço** abre a lista manualmente. Se não aparecerem, confira `editor.quickSuggestions.other` e `editor.suggest.showSnippets` nas configurações do editor.

A extensão usa a aceitação padrão do VS Code, sem adicionar atalhos de teclado nem alterar o comportamento da tecla Espaço.

Os modelos não são sugeridos dentro de strings, comentários de linha (`//`), comentários de bloco (`/* ... */`, inclusive aninhados), nem no meio de expressões. Eles podem ser usados em arquivos `.p`, `.w`, `.i`, `.cls` e demais arquivos cujo modo de linguagem seja `abl`.

## Configuração

As sugestões vêm habilitadas e podem ser desativadas nas configurações do VS Code, pesquisando `abl-linter.shortcuts`:

```json
{
  "abl-linter.shortcuts.enabled": true
}
```

A extensão não altera preferências globais do IntelliSense.

## Exemplos

`defvar` permite escolher nome e tipo:

```abl
DEFINE VARIABLE nome AS CHARACTER NO-UNDO.
```

`foreach` permite editar tabela, campo, valor e corpo; referências à tabela são atualizadas juntas:

```abl
FOR EACH tabela NO-LOCK
    WHERE tabela.campo = valor:

END.
```

`dowhile` gera:

```abl
DO WHILE condicao:

END.
```

## Convenções ABL

- Variáveis e temp-tables usam `NO-UNDO`; avalie a necessidade de desfazer seus valores dentro de transações.
- Consultas de leitura usam `NO-LOCK`. Alterações exigem contexto de escrita apropriado; `findlock` fornece busca com `EXCLUSIVE-LOCK NO-WAIT NO-ERROR` e verificações de bloqueio/disponibilidade.
- `FOR FIRST` e `FOR LAST` selecionam pelo índice antes de ordenar. Para processar o primeiro de uma ordenação, use `FOR EACH ... BY ...` com `LEAVE` no ponto adequado.
- Laço por contador usa `DO ... TO ... BY`; o contador precisa estar declarado. Laço condicional usa `DO WHILE` ou `REPEAT WHILE`.
- Modelos são pontos de partida: substitua tabelas, campos, condições e valores. Eles não consultam o schema do banco.
- `FIELD` e `INDEX` pertencem a uma definição de temp-table; ajuste o ponto final conforme a posição do campo/índice.
- `CATCH` e `FINALLY` devem ficar no fim de um bloco elegível, antes de seu `END`. `onerror` e `transaction` fornecem blocos com tratamento de erro.
- `errorstatus`/`errormessages` devem ser usados após a operação com `NO-ERROR`; outras operações podem alterar `ERROR-STATUS`.
- `class`, `constructor`, `destructor`, `method` e `property` dependem do contexto de classe e dos nomes/caminhos do projeto.
- `runpersistent` cria uma procedure persistente; use `deleteprocedure` quando o handle não for mais necessário.
- `INPUT FROM` e `OUTPUT TO` incluem fechamento no fluxo normal. Para garantir fechamento em erros, organize o recurso em um bloco com `FINALLY`.
- Widgets e frames dos modelos de interface devem existir. Ajuste os modelos à versão OpenEdge e ao tipo de aplicação (GUI, console ou servidor).

## Catálogo completo

O primeiro prefixo de cada linha é o atalho principal. Os demais são aliases equivalentes.

### Variáveis

| Prefixos | Estrutura / uso |
|---|---|
| `defvar`, `define variable` | Variável com tipo e NO-UNDO. |
| `defchar` | Variável CHARACTER com NO-UNDO. |
| `defint` | Variável INTEGER com NO-UNDO. |
| `defint64` | Variável INT64 com NO-UNDO. |
| `defdec` | Variável DECIMAL com NO-UNDO. |
| `deflog` | Variável LOGICAL com NO-UNDO. |
| `defdate` | Variável DATE com NO-UNDO. |
| `defdatetime` | Variável DATETIME com NO-UNDO. |
| `defdatetimetz` | Variável DATETIME-TZ com NO-UNDO. |
| `defhandle` | Variável HANDLE com NO-UNDO. |
| `deflongchar` | Variável LONGCHAR com NO-UNDO. |
| `defmemptr` | Variável MEMPTR com NO-UNDO. |
| `defraw` | Variável RAW com NO-UNDO. |
| `deflike` | Variável com tipo herdado de um campo. |
| `definitial` | Variável com valor inicial. |
| `defextent` | Variável array com EXTENT. |

### Parâmetros

| Prefixos | Estrutura / uso |
|---|---|
| `definput`, `define input parameter` | Parâmetro INPUT. |
| `defoutput`, `define output parameter` | Parâmetro OUTPUT. |
| `definout`, `define input-output parameter` | Parâmetro INPUT-OUTPUT. |
| `paramtable` | Parâmetro de temp-table já definida. |
| `paramdataset` | Parâmetro de dataset já definido. |

### Condições e laços

| Prefixos | Estrutura / uso |
|---|---|
| `if` | Condição com bloco. |
| `ifelse` | Condição com alternativa. |
| `case` | Seleção CASE com alternativa padrão. |
| `when` | Alternativa dentro de CASE. |
| `otherwise` | Alternativa padrão dentro de CASE. |
| `do` | Bloco simples. |
| `dowhile`, `while`, `do while` | Laço enquanto uma condição for verdadeira. |
| `dofor`, `do to` | Laço por contador; declare o contador antes. |
| `repeat` | Repetição; inclua condição de saída ou LEAVE. |
| `repeatwhile`, `repeat while` | Repetição condicional. |
| `leave` | Sai do laço atual. |
| `next` | Avança para a próxima iteração. |

### Banco de dados: consultas

| Prefixos | Estrutura / uso |
|---|---|
| `foreach`, `for each` | Percorre registros de leitura. |
| `forfirst`, `for first` | Primeiro registro segundo o índice; BY não escolhe o primeiro após ordenar. |
| `forlast`, `for last` | Último registro segundo o índice; BY não escolhe o último após ordenar. |
| `forby` | Leitura ordenada por campo. |
| `forbreak`, `for each break` | Agrupamento com FIRST-OF e LAST-OF. |
| `forjoin` | Relaciona duas tabelas com condição explícita. |
| `find` | Busca sem bloqueio e verifica disponibilidade. |
| `findfirst`, `find first` | Busca sem bloqueio e verifica disponibilidade. |
| `findlast`, `find last` | Busca sem bloqueio e verifica disponibilidade. |
| `findnext`, `find next` | Busca sem bloqueio e verifica disponibilidade. |
| `findprev`, `find prev` | Busca sem bloqueio e verifica disponibilidade. |
| `ifavail`, `if available` | Verifica disponibilidade do buffer. |
| `canfind`, `can-find` | Testa existência sem carregar o registro no buffer. |

### Banco de dados: escrita e transações

| Prefixos | Estrutura / uso |
|---|---|
| `create` | Cria registro no buffer informado. |
| `assign` | Atribui valores. |
| `delete` | Exclui registro disponível; requer bloqueio de escrita. |
| `validate` | Valida registro e índices. |
| `release` | Libera o buffer; bloqueios dependem do escopo da transação. |
| `findlock` | Busca para alteração sem aguardar bloqueios; trata indisponibilidade. |
| `iflocked` | Verifica registro bloqueado após FIND NO-WAIT. |
| `transaction`, `do transaction` | Transação com propagação de erro. |
| `onerror` | Bloco com propagação de erro. |
| `undo` | Desfaz bloco e sai dele. |
| `defbuffer`, `define buffer` | Buffer alternativo para tabela. |
| `buffercopy`, `buffer-copy` | Copia campos compatíveis entre buffers. |
| `buffercompare`, `buffer-compare` | Compara buffers; declare variável LOGICAL para resultado. |

### Temp-tables e datasets

| Prefixos | Estrutura / uso |
|---|---|
| `deftt`, `define temp-table` | Temp-table com campo e índice. |
| `defttlike` | Temp-table baseada em tabela existente. |
| `field` | Campo dentro de DEFINE TEMP-TABLE; pontuação pertence à definição. |
| `index` | Índice dentro de DEFINE TEMP-TABLE; ponto encerra a definição. |
| `emptytt`, `empty temp-table` | Esvazia temp-table. |
| `defdataset`, `define dataset` | Dataset para temp-table já definida. |

### Queries

| Prefixos | Estrutura / uso |
|---|---|
| `defquery`, `define query` | Query estática para buffer existente. |
| `openquery`, `open query` | Abre query estática. |
| `queryloop` | Ciclo completo de query estática. |
| `getfirst`, `get first` | Primeiro registro da query. |
| `getnext`, `get next` | Próximo registro da query. |
| `getprev`, `get prev` | Registro anterior da query. |
| `getlast`, `get last` | Último registro da query. |
| `closequery`, `close query` | Fecha query. |
| `dynamicquery` | Query dinâmica com limpeza do objeto em FINALLY. |

### Rotinas

| Prefixos | Estrutura / uso |
|---|---|
| `procedure` | Procedure interna com parâmetro. |
| `function` | Função com parâmetro e retorno. |
| `forward` | Declaração antecipada de função. |
| `run` | Executa programa ou procedure. |
| `runpersistent` | Executa procedure persistente; libere handle ao terminar. |
| `runin` | Executa rotina em procedure persistente. |
| `deleteprocedure` | Libera procedure persistente válida. |
| `return` | Retorna valor de função; adapte ao tipo declarado. |
| `returnerror`, `return error` | Retorna erro ao chamador. |

### Classes

| Prefixos | Estrutura / uso |
|---|---|
| `class` | Classe ABL; ajuste nome e caminho do arquivo .cls. |
| `constructor` | Construtor dentro de classe. |
| `destructor` | Destrutor dentro de classe. |
| `method` | Método sem retorno dentro de classe. |
| `property` | Propriedade com acesso de leitura e escrita. |
| `using` | Importa namespace ou classe. |
| `new` | Instancia classe em variável previamente declarada. |

### Erros

| Prefixos | Estrutura / uso |
|---|---|
| `catch` | CATCH dentro de bloco com tratamento de erro. |
| `finally` | Limpeza no fim de bloco elegível, após os CATCHs. |
| `throw` | Lança erro de aplicação. |
| `errorstatus` | Verifica erros e mensagens após operação NO-ERROR. |
| `errormessages` | Percorre mensagens de ERROR-STATUS após NO-ERROR. |

### Arquivos e streams

| Prefixos | Estrutura / uso |
|---|---|
| `defstream`, `define stream` | Declara stream nomeado. |
| `inputfrom`, `input from` | Entrada por arquivo com fechamento. |
| `outputto`, `output to` | Saída por arquivo com fechamento. |
| `inputstream` | Entrada usando stream nomeado. |
| `outputstream` | Saída usando stream nomeado. |
| `import` | Importa campos delimitados da entrada atual. |
| `importline` | Importa uma linha inteira. |
| `export` | Exporta campos delimitados para saída atual. |
| `put`, `put unformatted` | Escreve texto sem formatação e quebra de linha. |
| `inputclose`, `input close` | Fecha entrada padrão. |
| `outputclose`, `output close` | Fecha saída padrão. |

### Mensagens e interface

| Prefixos | Estrutura / uso |
|---|---|
| `message` | Mensagem informativa. |
| `confirm` | Confirmação com resposta LOGICAL. |
| `display` | Exibe campos. |
| `update` | Solicita edição de campos. |
| `enable` | Habilita widgets em frame existente. |
| `waitfor`, `wait-for` | Aguarda evento de widget existente. |
| `on` | Trigger de evento em widget existente. |

### Includes e preprocessador

| Prefixos | Estrutura / uso |
|---|---|
| `include` | Inclui fonte ABL. |
| `includeargs` | Include com argumento nomeado. |
| `scopeddefine`, `&scoped-define` | Constante de preprocessador no escopo atual. |
| `globaldefine`, `&global-define` | Constante global de preprocessador. |
| `preif`, `&if` | Compilação condicional. |

## Verificação manual no VS Code

Após compilar a extensão e iniciar o Extension Development Host:

- Digite `defvar` e aceite a sugestão com Tab ou Enter, conforme suas configurações. Preencha nome/tipo com Tab.
- Digite `foreach` em uma linha indentada: expanda e confira a indentação e a repetição do nome da tabela.
- Repita em comentário, string, arquivo de outra linguagem e com a lista fechada: Espaço deve permanecer normal.
- Desative `abl-linter.shortcuts.enabled` e confira que a mudança vale sem reiniciar.
- Durante um campo editável, digite espaços: nenhuma expansão adicional deve ocorrer.
- Com a lista aberta, pressione Espaço: a extensão não deve aceitar a sugestão por essa tecla.

Os testes automatizados exercitam análise de contexto, catálogo, provider e ausência de comandos adicionais de aceitação. A interface real do IntelliSense e a compilação dos modelos no AVM devem ser verificadas no ambiente OpenEdge de destino.

Referências: [FOR](https://docs.progress.com/bundle/openedge-abl-reference-122/page/FOR-statement.html), [DO](https://docs.progress.com/bundle/openedge-abl-basic-guided-journey-128/page/DO-statement.html), [CATCH](https://docs.progress.com/bundle/openedge-abl-reference-128/page/CATCH-statement.html), [FINALLY](https://docs.progress.com/bundle/openedge-abl-error-handling/page/FINALLY-block-syntax-and-usage.html), [API de sugestões do VS Code](https://code.visualstudio.com/api/references/vscode-api#CompletionItem).
