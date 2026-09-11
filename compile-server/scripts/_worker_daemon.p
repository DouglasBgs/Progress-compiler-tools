/* OpenEdge 12.8: sessao persistente, um job por vez, protocolo JSON/linha.
   READ-AVAILABLE bloqueia sem consumir CPU ate chegar um comando.
   Fontes e relatorio usam arquivos UTF-8; o socket recebe somente ASCII. */
USING Progress.Json.ObjectModel.* FROM PROPATH.
BLOCK-LEVEL ON ERROR UNDO, THROW.

DEFINE VARIABLE hSocket AS HANDLE NO-UNDO.
DEFINE VARIABLE cPort AS CHARACTER NO-UNDO INITIAL "9095".
DEFINE VARIABLE cWorkerId AS CHARACTER NO-UNDO.
DEFINE VARIABLE cOriginalPropath AS CHARACTER NO-UNDO.
DEFINE VARIABLE cBuffer AS CHARACTER NO-UNDO.
DEFINE VARIABLE cLine AS CHARACTER NO-UNDO.
DEFINE VARIABLE cEntry AS CHARACTER NO-UNDO.
DEFINE VARIABLE i AS INTEGER NO-UNDO.
DEFINE VARIABLE iPos AS INTEGER NO-UNDO.
DEFINE VARIABLE iBytes AS INTEGER NO-UNDO.
DEFINE VARIABLE mRead AS MEMPTR NO-UNDO.
DEFINE VARIABLE lRunning AS LOGICAL NO-UNDO INITIAL TRUE.
DEFINE VARIABLE lRead AS LOGICAL NO-UNDO.
DEFINE VARIABLE oParser AS ObjectModelParser NO-UNDO.
DEFINE VARIABLE oRegister AS JsonObject NO-UNDO.

PROCEDURE sendMessage:
    DEFINE INPUT PARAMETER poMessage AS JsonObject NO-UNDO.
    DEFINE VARIABLE lcJson AS LONGCHAR NO-UNDO.
    DEFINE VARIABLE mOutput AS MEMPTR NO-UNDO.
    DEFINE VARIABLE iLength AS INTEGER NO-UNDO.
    DEFINE VARIABLE iOffset AS INTEGER NO-UNDO.
    DEFINE VARIABLE lWritten AS LOGICAL NO-UNDO.

    poMessage:Write(INPUT-OUTPUT lcJson, FALSE, "UTF-8").
    lcJson = lcJson + CHR(10).
    COPY-LOB FROM lcJson TO mOutput CONVERT TARGET CODEPAGE "UTF-8".
    iLength = GET-SIZE(mOutput).
    /* COPY-LOB pode adicionar terminador NUL; ele nao faz parte do frame. */
    IF iLength > 0 AND GET-BYTE(mOutput, iLength) = 0 THEN iLength = iLength - 1.
    iOffset = 1.
    DO WHILE iOffset <= iLength:
        lWritten = hSocket:WRITE(mOutput, iOffset, iLength - iOffset + 1).
        IF NOT lWritten OR hSocket:BYTES-WRITTEN <= 0 THEN
            UNDO, THROW NEW Progress.Lang.AppError("Falha ao escrever no socket.", 0).
        iOffset = iOffset + hSocket:BYTES-WRITTEN.
    END.
    FINALLY:
        SET-SIZE(mOutput) = 0.
    END FINALLY.
END PROCEDURE.

PROCEDURE compileRequest:
    DEFINE INPUT PARAMETER pcRequestPath AS CHARACTER NO-UNDO.
    DEFINE INPUT PARAMETER pcJobId AS CHARACTER NO-UNDO.
    DEFINE VARIABLE oRequest AS JsonObject NO-UNDO.
    DEFINE VARIABLE oSources AS JsonArray NO-UNDO.
    DEFINE VARIABLE oReport AS JsonArray NO-UNDO.
    DEFINE VARIABLE oRow AS JsonObject NO-UNDO.
    DEFINE VARIABLE oMessages AS JsonArray NO-UNDO.
    DEFINE VARIABLE cBase AS CHARACTER NO-UNDO.
    DEFINE VARIABLE cReport AS CHARACTER NO-UNDO.
    DEFINE VARIABLE cSource AS CHARACTER NO-UNDO.
    DEFINE VARIABLE cFullSource AS CHARACTER NO-UNDO.
    DEFINE VARIABLE cSavePath AS CHARACTER NO-UNDO.
    DEFINE VARIABLE cMessage AS CHARACTER NO-UNDO.
    DEFINE VARIABLE iSource AS INTEGER NO-UNDO.
    DEFINE VARIABLE iMessage AS INTEGER NO-UNDO.
    DEFINE VARIABLE lCompileError AS LOGICAL NO-UNDO.
    DEFINE VARIABLE lSaved AS LOGICAL NO-UNDO.

    oRequest = CAST(oParser:ParseFile(pcRequestPath), JsonObject).
    IF oRequest:GetCharacter("jobId") <> pcJobId THEN
        UNDO, THROW NEW Progress.Lang.AppError("Manifest de outro job.", 0).
    ASSIGN
        cBase = oRequest:GetCharacter("baseTempPath")
        cReport = oRequest:GetCharacter("reportPath")
        oSources = oRequest:GetJsonArray("sources")
        oReport = NEW JsonArray()
        PROPATH = cBase + "," + cOriginalPropath.

    DO iSource = 1 TO oSources:Length:
        ASSIGN
            cSource = oSources:GetCharacter(iSource)
            cFullSource = cBase + "/" + cSource
            cSavePath = cBase + "/resultado"
            oRow = NEW JsonObject()
            oMessages = NEW JsonArray().
        IF NOT cSource MATCHES "*.cls" AND R-INDEX(cSource, "/") > 0 THEN
            cSavePath = cSavePath + "/" + SUBSTRING(cSource, 1, R-INDEX(cSource, "/") - 1).

        COMPILE VALUE(cFullSource) SAVE INTO VALUE(cSavePath) NO-ERROR.
        lCompileError = COMPILER:ERROR.
        IF lCompileError THEN
            oMessages:Add("[Linha " + STRING(COMPILER:ERROR-ROW)
                + " / Col " + STRING(COMPILER:ERROR-COL) + "] Falha na compilacao.").
        DO iMessage = 1 TO ERROR-STATUS:NUM-MESSAGES:
            cMessage = ERROR-STATUS:GET-MESSAGE(iMessage).
            IF cMessage <> ? THEN DO:
                cMessage = REPLACE(cMessage, cBase + "/", "").
                cMessage = REPLACE(cMessage, REPLACE(cBase, "/", CHR(92)) + CHR(92), "").
                oMessages:Add("[Mensagem] " + cMessage).
            END.
        END.
        oRow:Add("file", cSource).
        oRow:Add("success", NOT lCompileError).
        oRow:Add("messages", oMessages).
        oReport:Add(oRow).
    END.
    lSaved = oReport:WriteFile(cReport, FALSE, "UTF-8").
    IF NOT lSaved THEN UNDO, THROW NEW Progress.Lang.AppError("Falha ao gravar relatorio.", 0).

    FINALLY:
        PROPATH = cOriginalPropath.
        /* Libera referencias para o GC, inclusive quando a compilacao falha. */
        ASSIGN oRequest = ? oSources = ? oReport = ? oRow = ? oMessages = ?.
    END FINALLY.
END PROCEDURE.

PROCEDURE handleCommand:
    DEFINE INPUT PARAMETER pcLine AS CHARACTER NO-UNDO.
    DEFINE VARIABLE oCommand AS JsonObject NO-UNDO.
    DEFINE VARIABLE oResponse AS JsonObject NO-UNDO.
    DEFINE VARIABLE cAction AS CHARACTER NO-UNDO.
    DEFINE VARIABLE cJobId AS CHARACTER NO-UNDO.

    oCommand = CAST(oParser:Parse(pcLine), JsonObject).
    cAction = oCommand:GetCharacter("action").
    CASE cAction:
        WHEN "COMPILE" THEN DO:
            cJobId = oCommand:GetCharacter("jobId").
            oResponse = NEW JsonObject().
            oResponse:Add("action", "DONE").
            oResponse:Add("jobId", cJobId).
            DO ON ERROR UNDO, THROW:
                RUN compileRequest(oCommand:GetCharacter("requestPath"), cJobId).
                oResponse:Add("success", TRUE).
                CATCH err AS Progress.Lang.Error:
                    oResponse:Add("success", FALSE).
                    oResponse:Add("error", SUBSTRING(err:GetMessage(1), 1, 4000)).
                END CATCH.
            END.
            RUN sendMessage(oResponse).
        END.
        WHEN "PING" THEN DO:
            oResponse = NEW JsonObject().
            oResponse:Add("action", "PONG").
            RUN sendMessage(oResponse).
        END.
        WHEN "QUIT" THEN lRunning = FALSE.
        OTHERWISE UNDO, THROW NEW Progress.Lang.AppError("Comando desconhecido.", 0).
    END CASE.
    FINALLY:
        ASSIGN oCommand = ? oResponse = ?.
    END FINALLY.
END PROCEDURE.

/* O PF/INI ja foi aplicado pelo AVM na inicializacao. */
DO i = 1 TO NUM-ENTRIES(SESSION:PARAMETER):
    cEntry = ENTRY(i, SESSION:PARAMETER).
    iPos = INDEX(cEntry, "=").
    IF iPos > 0 THEN DO:
        CASE SUBSTRING(cEntry, 1, iPos - 1):
            WHEN "PORT" THEN cPort = SUBSTRING(cEntry, iPos + 1).
            WHEN "WORKER_ID" THEN cWorkerId = SUBSTRING(cEntry, iPos + 1).
        END CASE.
    END.
END.
ASSIGN cOriginalPropath = PROPATH oParser = NEW ObjectModelParser().

DO ON ERROR UNDO, THROW:
    CREATE SOCKET hSocket.
    IF NOT hSocket:CONNECT("-H 127.0.0.1 -S " + cPort) THEN
        UNDO, THROW NEW Progress.Lang.AppError("Falha ao conectar ao servidor de compilacao.", 0).
    hSocket:SET-SOCKET-OPTION("TCP-NODELAY", "TRUE").
    oRegister = NEW JsonObject().
    oRegister:Add("action", "REGISTER").
    oRegister:Add("workerId", cWorkerId).
    RUN sendMessage(oRegister).

    SET-SIZE(mRead) = 8192.
    DO WHILE lRunning AND hSocket:CONNECTED():
        /* 1 = READ-AVAILABLE: espera pelo menos um byte, nao pelo buffer inteiro. */
        lRead = hSocket:READ(mRead, 1, 8192, 1).
        iBytes = hSocket:BYTES-READ.
        IF NOT lRead OR iBytes <= 0 THEN LEAVE.
        cBuffer = cBuffer + GET-STRING(mRead, 1, iBytes).
        DO WHILE INDEX(cBuffer, CHR(10)) > 0 AND lRunning:
            iPos = INDEX(cBuffer, CHR(10)).
            IF iPos > 16384 THEN UNDO, THROW NEW Progress.Lang.AppError("Comando muito grande.", 0).
            cLine = SUBSTRING(cBuffer, 1, iPos - 1).
            cBuffer = SUBSTRING(cBuffer, iPos + 1).
            IF cLine <> "" THEN RUN handleCommand(cLine).
        END.
        IF LENGTH(cBuffer) > 16384 THEN UNDO, THROW NEW Progress.Lang.AppError("Comando muito grande.", 0).
    END.
    CATCH err AS Progress.Lang.Error:
        MESSAGE "Worker " cWorkerId ": " err:GetMessage(1).
    END CATCH.
    FINALLY:
        SET-SIZE(mRead) = 0.
        IF VALID-HANDLE(hSocket) THEN DO:
            IF hSocket:CONNECTED() THEN hSocket:DISCONNECT() NO-ERROR.
            DELETE OBJECT hSocket NO-ERROR.
        END.
    END FINALLY.
END.
QUIT.
