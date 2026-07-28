import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

// =====================================================
// INTERFACES
// =====================================================

interface LogError {
    line: number;
    timestamp: string;
    errorCode: string;
    message: string;
    procedure?: string;
    agent?: string;
    severity: 'error' | 'warning' | 'info';
    context?: string[]; // linhas de contexto ao redor do erro
}

interface ProcedureTiming {
    name: string;
    calls: number;
    totalTime: number;
    avgTime: number;
    maxTime: number;
    percentage: number;
}

interface ConnectionInfo {
    connectionId: string;
    agent: string;
    connectTime: Date;
    disconnectTime?: Date;
    duration?: number;
    procedures: string[];
}

interface AgentStats {
    agent: string;
    totalRequests: number;
    totalProcedures: number;
    errors: number;
}

interface LogAnalysisResult {
    fileName: string;
    totalLines: number;
    timeRange: { start: string; end: string; durationMinutes: number };
    errors: LogError[];
    warnings: LogError[];
    procedureTimings: ProcedureTiming[];
    totalExecutionTime: number;
    slowProcedures: ProcedureTiming[];
    connections: { total: number; avgDuration: number; maxDuration: number };
    agentStats: AgentStats[];
    aiAnalysis?: string;
}

// =====================================================
// PARSER DO LOG DO APPSERVER PROGRESS OPENEDGE
// Formato: TIMESTAMP PID THREAD LEVEL AGENT REQUEST TYPE MESSAGE
// Ex: 2026-05-27T18:09:07.495-0300 3532993 3532998 3 AS-24 ?:?:? 4GLTRACE ...
// =====================================================

const LOG_LINE_REGEX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[-+]\d{4})\s+(\d+)\s+(\d+)\s+(\d+)\s+(AS-\d+)\s+(\S+)\s+(.+)$/;

function parseTimestamp(ts: string): Date {
    return new Date(ts);
}

// =====================================================
// EXTRATOR DE ERROS E FALHAS
// =====================================================

function extractErrors(lines: string[]): { errors: LogError[]; warnings: LogError[] } {
    const errors: LogError[] = [];
    const warnings: LogError[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) { continue; }

        // loadProc() failed - Falha ao carregar procedure no AppServer
        if (line.includes('loadProc() failed')) {
            const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[-+]\d{4})\s+\d+\s+\d+\s+\d+\s+(AS-\d+)\s+\S+\s+AS -- TRACE: cso4GL: loadProc\(\) failed\. \((\d+)\)/);
            if (match) {
                errors.push({
                    line: i + 1,
                    timestamp: match[1],
                    errorCode: match[3],
                    message: 'loadProc() failed - Falha ao carregar procedure',
                    agent: match[2],
                    severity: 'error',
                    context: getContextLines(lines, i, 3)
                });
            }
            continue;
        }

        // RowErrors nos retornos - indica erro de negócio
        if (line.includes('4GLTRACE') && line.includes('Return from') && line.includes('RowErrors')) {
            const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[-+]\d{4})\s+\d+\s+\d+\s+\d+\s+(AS-\d+)\s+\S+\s+4GLTRACE\s+Return\s*\n?\s*from\s+(\S+)\s+".*?RowErrors.*?"\s+\[(.+?)\]/);
            if (match) {
                warnings.push({
                    line: i + 1,
                    timestamp: match[1],
                    errorCode: 'RowErrors',
                    message: `Retorno com RowErrors em ${match[3]}`,
                    procedure: match[4],
                    agent: match[2],
                    severity: 'warning',
                    context: getContextLines(lines, i, 2)
                });
            } else {
                // Tenta match simplificado (linhas podem estar quebradas)
                const simpleMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[-+]\d{4})\s+\d+\s+\d+\s+\d+\s+(AS-\d+)/);
                const procMatch = line.match(/Return\s*(?:\n\s*)?from\s+(\S+).*?\[(.+?)\]/);
                if (simpleMatch) {
                    warnings.push({
                        line: i + 1,
                        timestamp: simpleMatch[1],
                        errorCode: 'RowErrors',
                        message: `Retorno com RowErrors${procMatch ? ' em ' + procMatch[1] : ''}`,
                        procedure: procMatch ? procMatch[2] : undefined,
                        agent: simpleMatch[2],
                        severity: 'warning',
                        context: getContextLines(lines, i, 2)
                    });
                }
            }
            continue;
        }

        // tt_log_erros nos retornos
        if (line.includes('4GLTRACE') && line.includes('Return from') && line.includes('tt_log_erros')) {
            const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[-+]\d{4})\s+\d+\s+\d+\s+\d+\s+(AS-\d+)/);
            const procMatch = line.match(/\[(.+?)\]/);
            if (match) {
                warnings.push({
                    line: i + 1,
                    timestamp: match[1],
                    errorCode: 'tt_log_erros',
                    message: 'Retorno com tt_log_erros',
                    procedure: procMatch ? procMatch[1] : undefined,
                    agent: match[2],
                    severity: 'warning'
                });
            }
            continue;
        }

        // STOP condition ou erro de runtime
        if (line.includes('STOP condition') || line.includes('abnormally')) {
            const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[-+]\d{4})\s+\d+\s+\d+\s+\d+\s+(AS-\d+)/);
            if (match) {
                errors.push({
                    line: i + 1,
                    timestamp: match[1],
                    errorCode: 'STOP',
                    message: line.substring(line.indexOf(match[2]) + match[2].length).trim(),
                    agent: match[2],
                    severity: 'error',
                    context: getContextLines(lines, i, 3)
                });
            }
        }
    }

    return { errors, warnings };
}

/** Extrai N linhas antes e depois de uma posição no array de linhas */
function getContextLines(lines: string[], index: number, radius: number): string[] {
    const start = Math.max(0, index - radius);
    const end = Math.min(lines.length - 1, index + radius);
    const context: string[] = [];
    for (let j = start; j <= end; j++) {
        const prefix = j === index ? '>>> ' : '    ';
        const lineNum = (j + 1).toString().padStart(6, ' ');
        context.push(`${lineNum} ${prefix}${lines[j]}`);
    }
    return context;
}

// =====================================================
// EXTRATOR DE TIMINGS DE PROCEDURES (4GLTRACE)
// Padrão Run: 4GLTRACE       Run PROC [caller - source.p @ LINE]
// Padrão Func: 4GLTRACE       Func FUNC in PROC "params" [caller - source.p @ LINE]
// Padrão Return: 4GLTRACE       Return from PROC "result" [source.p]
// =====================================================

interface ProcedureCall {
    name: string;
    startTime: Date;
    threadId: string;
}

function extractProcedureTimings(lines: string[]): ProcedureTiming[] {
    const callStack: Map<string, ProcedureCall[]> = new Map(); // key: threadId
    const timingMap: Map<string, { calls: number; totalTime: number; maxTime: number }> = new Map();

    for (const line of lines) {
        if (!line.includes('4GLTRACE')) { continue; }

        // Detecta início: "Run PROC", "Func FUNC", "Invoke METHOD", "New CLASS"
        const runMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[-+]\d{4})\s+\d+\s+(\d+)\s+\d+\s+AS-\d+\s+\S+\s+4GLTRACE\s+(?:Run|Func|Invoke|New)\s+(\S+)/);
        if (runMatch) {
            const threadId = runMatch[2];
            const call: ProcedureCall = {
                name: runMatch[3],
                startTime: parseTimestamp(runMatch[1]),
                threadId
            };

            if (!callStack.has(threadId)) {
                callStack.set(threadId, []);
            }
            callStack.get(threadId)!.push(call);
            continue;
        }

        // Detecta retorno: "Return from PROC"
        const returnMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[-+]\d{4})\s+\d+\s+(\d+)\s+\d+\s+AS-\d+\s+\S+\s+4GLTRACE\s+Return\s*\n?\s*from\s+(\S+)/);
        if (returnMatch) {
            const threadId = returnMatch[2];
            const returnTime = parseTimestamp(returnMatch[1]);
            const procName = returnMatch[3];
            const stack = callStack.get(threadId);

            if (stack && stack.length > 0) {
                // Busca no stack (de cima pra baixo) a procedure correspondente
                let foundIdx = -1;
                for (let j = stack.length - 1; j >= 0; j--) {
                    if (stack[j].name === procName) {
                        foundIdx = j;
                        break;
                    }
                }

                if (foundIdx >= 0) {
                    const call = stack[foundIdx];
                    const elapsed = (returnTime.getTime() - call.startTime.getTime()) / 1000;

                    if (elapsed >= 0 && elapsed < 3600) { // ignora timings > 1h (provavelmente erro)
                        const existing = timingMap.get(procName);
                        if (existing) {
                            existing.calls++;
                            existing.totalTime += elapsed;
                            if (elapsed > existing.maxTime) {
                                existing.maxTime = elapsed;
                            }
                        } else {
                            timingMap.set(procName, {
                                calls: 1,
                                totalTime: elapsed,
                                maxTime: elapsed
                            });
                        }
                    }

                    stack.splice(foundIdx, 1);
                }
            }
        }
    }

    // Converte para array
    const totalTime = Array.from(timingMap.values()).reduce((sum, t) => sum + t.totalTime, 0);
    const timings: ProcedureTiming[] = [];

    for (const [name, data] of timingMap.entries()) {
        timings.push({
            name,
            calls: data.calls,
            totalTime: data.totalTime,
            avgTime: data.totalTime / data.calls,
            maxTime: data.maxTime,
            percentage: totalTime > 0 ? (data.totalTime / totalTime) * 100 : 0
        });
    }

    timings.sort((a, b) => b.totalTime - a.totalTime);
    return timings;
}

// =====================================================
// EXTRATOR DE CONEXÕES DO APPSERVER
// Padrão connect: AS Application Server connected with connection id: CONNID. (8358)
// Padrão disconnect: AS Application Server disconnected with connection id: CONNID. (8359)
// =====================================================

function extractConnections(lines: string[]): ConnectionInfo[] {
    const connections: Map<string, ConnectionInfo> = new Map();

    for (const line of lines) {
        if (!line.includes('Application Server')) { continue; }

        // Conexão
        const connectMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[-+]\d{4})\s+\d+\s+\d+\s+\d+\s+(AS-\d+)\s+\S+\s+AS Application Server connected with connection id: (\S+?)\./);
        if (connectMatch) {
            connections.set(connectMatch[3], {
                connectionId: connectMatch[3],
                agent: connectMatch[2],
                connectTime: parseTimestamp(connectMatch[1]),
                procedures: []
            });
            continue;
        }

        // Desconexão
        const disconnectMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[-+]\d{4})\s+\d+\s+\d+\s+\d+\s+(AS-\d+)\s+\S+\s+AS Application Server disconnected with connection id: (\S+?)\./);
        if (disconnectMatch) {
            const conn = connections.get(disconnectMatch[3]);
            if (conn) {
                conn.disconnectTime = parseTimestamp(disconnectMatch[1]);
                conn.duration = (conn.disconnectTime.getTime() - conn.connectTime.getTime()) / 1000;
            }
        }
    }

    return Array.from(connections.values());
}

// =====================================================
// ESTATÍSTICAS POR AGENT
// =====================================================

function extractAgentStats(lines: string[]): AgentStats[] {
    const agentMap: Map<string, { requests: number; procedures: number; errors: number }> = new Map();

    for (const line of lines) {
        const agentMatch = line.match(/\s+(AS-\d+)\s+/);
        if (!agentMatch) { continue; }
        const agent = agentMatch[1];

        if (!agentMap.has(agent)) {
            agentMap.set(agent, { requests: 0, procedures: 0, errors: 0 });
        }
        const stats = agentMap.get(agent)!;

        if (line.includes('MSGSTATE_INITRQ')) {
            stats.requests++;
        }
        if (line.includes('4GLTRACE') && (line.includes(' Run ') || line.includes(' Func ') || line.includes(' Invoke '))) {
            stats.procedures++;
        }
        if (line.includes('failed') || line.includes('STOP condition') || line.includes('abnormally')) {
            stats.errors++;
        }
    }

    return Array.from(agentMap.entries())
        .map(([agent, data]) => ({
            agent,
            totalRequests: data.requests,
            totalProcedures: data.procedures,
            errors: data.errors
        }))
        .sort((a, b) => b.totalProcedures - a.totalProcedures);
}

// =====================================================
// ANÁLISE COM IA (OpenAI / Azure / Ollama compatible)
// =====================================================

async function analyzeWithAI(result: LogAnalysisResult, apiKey: string, apiUrl: string, model: string): Promise<string> {
    const prompt = buildAIPrompt(result);

    try {
        const response = await axios.post(
            apiUrl,
            {
                model,
                messages: [
                    {
                        role: 'system',
                        content: `Você é um especialista em Progress OpenEdge ABL, AppServer e análise de performance de sistemas TOTVS.
Analise os dados do log de AppServer fornecidos e retorne um relatório conciso em Markdown com:
1. **Resumo Geral** - visão geral do estado do AppServer (agents ativos, conexões, período analisado)
2. **Erros Críticos** - falhas de loadProc(), RowErrors frequentes, procedures com problemas
3. **Gargalos de Performance** - procedures mais lentas, procedures chamadas excessivamente, tempo médio elevado
4. **Análise de Agents** - distribuição de carga entre agents, possíveis agents sobrecarregados
5. **Recomendações** - ações prioritárias para melhorar a performance e estabilidade
Considere que este é um log de AppServer Progress OpenEdge com agents multithreaded executando procedures 4GL.
Responda em português brasileiro.`
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 3000
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );

        return response.data.choices?.[0]?.message?.content || 'Sem resposta da IA.';
    } catch (error: any) {
        if (error.response?.status === 401) {
            return '❌ API Key inválida. Configure a chave corretamente em `abl-linter.aiApiKey`.';
        }
        if (error.code === 'ECONNABORTED') {
            return '❌ Timeout na requisição à IA. Tente novamente ou reduza o tamanho do log.';
        }
        return `❌ Erro ao consultar IA: ${error.message}`;
    }
}

function buildAIPrompt(result: LogAnalysisResult): string {
    let prompt = `## Dados do Log AppServer: ${path.basename(result.fileName)}\n\n`;
    prompt += `- Total de linhas: ${result.totalLines}\n`;
    prompt += `- Período: ${result.timeRange.start} até ${result.timeRange.end} (${result.timeRange.durationMinutes.toFixed(1)} minutos)\n`;
    prompt += `- Erros encontrados: ${result.errors.length}\n`;
    prompt += `- Warnings (RowErrors/tt_log_erros): ${result.warnings.length}\n`;
    prompt += `- Conexões totais: ${result.connections.total}\n`;
    prompt += `- Duração média de conexão: ${result.connections.avgDuration.toFixed(3)}s\n`;
    prompt += `- Duração máxima de conexão: ${result.connections.maxDuration.toFixed(3)}s\n`;
    prompt += `- Agents ativos: ${result.agentStats.length}\n\n`;

    if (result.errors.length > 0) {
        prompt += `### Erros:\n`;
        const errorGroups = new Map<string, number>();
        for (const err of result.errors) {
            const key = `[${err.errorCode}] ${err.message}`;
            errorGroups.set(key, (errorGroups.get(key) || 0) + 1);
        }
        for (const [msg, count] of Array.from(errorGroups.entries()).slice(0, 15)) {
            prompt += `- (${count}x) ${msg}\n`;
        }
        prompt += '\n';
    }

    if (result.warnings.length > 0) {
        prompt += `### Warnings - Agrupados por Procedure:\n`;
        const warnGroups = new Map<string, number>();
        for (const w of result.warnings) {
            const key = w.procedure || w.message;
            warnGroups.set(key, (warnGroups.get(key) || 0) + 1);
        }
        for (const [proc, count] of Array.from(warnGroups.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
            prompt += `- (${count}x) ${proc}\n`;
        }
        prompt += '\n';
    }

    if (result.slowProcedures.length > 0) {
        prompt += `### Top 20 Procedures Mais Lentas:\n`;
        prompt += `| Procedure | Chamadas | Tempo Total (s) | Tempo Médio (s) | Máximo (s) | % Total |\n`;
        prompt += `|-----------|----------|-----------------|-----------------|------------|--------|\n`;
        for (const proc of result.slowProcedures.slice(0, 20)) {
            prompt += `| ${proc.name} | ${proc.calls} | ${proc.totalTime.toFixed(3)} | ${proc.avgTime.toFixed(3)} | ${proc.maxTime.toFixed(3)} | ${proc.percentage.toFixed(1)}% |\n`;
        }
        prompt += '\n';
    }

    if (result.agentStats.length > 0) {
        prompt += `### Agents:\n`;
        prompt += `| Agent | Requests | Procedures | Erros |\n`;
        prompt += `|-------|----------|------------|-------|\n`;
        for (const a of result.agentStats.slice(0, 15)) {
            prompt += `| ${a.agent} | ${a.totalRequests} | ${a.totalProcedures} | ${a.errors} |\n`;
        }
        prompt += '\n';
    }

    return prompt;
}

// =====================================================
// WEBVIEW PANEL
// =====================================================

function createResultsWebview(context: vscode.ExtensionContext, result: LogAnalysisResult): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
        'ablLogAnalysis',
        `Análise: ${path.basename(result.fileName)}`,
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    panel.webview.html = generateWebviewHTML(result);
    return panel;
}

function generateWebviewHTML(result: LogAnalysisResult): string {
    const errorsHtml = result.errors.length > 0
        ? result.errors.slice(0, 100).map((e, idx) => `
            <tr class="error-row clickable" onclick="toggleContext('err-ctx-${idx}')">
                <td>${e.line}</td>
                <td class="ts">${formatTimestamp(e.timestamp)}</td>
                <td><code>${escapeHtml(e.errorCode)}</code></td>
                <td>${e.agent || ''}</td>
                <td>${escapeHtml(e.message)} <span class="expand-hint">▶</span></td>
            </tr>
            <tr id="err-ctx-${idx}" class="context-row" style="display:none;">
                <td colspan="5"><pre class="context-block">${e.context ? e.context.map(l => escapeHtml(l)).join('\n') : 'Sem contexto disponível'}</pre></td>
            </tr>`).join('')
        : '<tr><td colspan="5" class="empty">Nenhum erro encontrado ✓</td></tr>';

    const warningsHtml = result.warnings.length > 0
        ? groupWarnings(result.warnings).map(w => `
            <tr class="warning-row">
                <td>${w.count}</td>
                <td>${escapeHtml(w.procedure)}</td>
                <td>${escapeHtml(w.message)}</td>
                <td>${w.agent || ''}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" class="empty">Nenhum warning encontrado ✓</td></tr>';

    const timingsHtml = result.slowProcedures.length > 0
        ? result.slowProcedures.slice(0, 50).map((p, i) => `
            <tr class="${p.percentage > 20 ? 'critical' : p.percentage > 10 ? 'slow' : ''}">
                <td>${i + 1}</td>
                <td title="${escapeHtml(p.name)}">${escapeHtml(truncate(p.name, 55))}</td>
                <td>${p.calls.toLocaleString()}</td>
                <td>${p.totalTime.toFixed(3)}s</td>
                <td>${p.avgTime.toFixed(4)}s</td>
                <td>${p.maxTime.toFixed(3)}s</td>
                <td>
                    <div class="bar-container">
                        <div class="bar" style="width: ${Math.min(p.percentage * 2, 100)}%"></div>
                        <span>${p.percentage.toFixed(1)}%</span>
                    </div>
                </td>
            </tr>`).join('')
        : '<tr><td colspan="7" class="empty">Nenhum dado de timing encontrado</td></tr>';

    const agentsHtml = result.agentStats.length > 0
        ? result.agentStats.map(a => `
            <tr class="${a.errors > 0 ? 'has-errors' : ''}">
                <td><strong>${a.agent}</strong></td>
                <td>${a.totalRequests.toLocaleString()}</td>
                <td>${a.totalProcedures.toLocaleString()}</td>
                <td class="${a.errors > 0 ? 'error-count' : ''}">${a.errors}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" class="empty">Sem dados de agents</td></tr>';

    const aiHtml = result.aiAnalysis
        ? `<div class="ai-content">${markdownToHtml(result.aiAnalysis)}</div>`
        : `<p class="empty">Configure <code>abl-linter.aiApiKey</code> nas configurações para habilitar a análise inteligente com IA.</p>`;

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Análise de Log - ${escapeHtml(path.basename(result.fileName))}</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            line-height: 1.5;
            margin: 0;
        }
        h1 { border-bottom: 2px solid var(--vscode-activityBar-activeBorder, #007acc); padding-bottom: 10px; margin-bottom: 20px; }
        h2 { margin-top: 0; color: var(--vscode-foreground); }
        .header-info { color: var(--vscode-descriptionForeground); margin-bottom: 20px; font-size: 0.9em; }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 12px;
            margin: 20px 0;
        }
        .card {
            background: var(--vscode-editor-inactiveSelectionBackground, #2d2d2d);
            padding: 14px;
            border-radius: 8px;
            text-align: center;
            border: 1px solid var(--vscode-widget-border, #454545);
        }
        .card .value { font-size: 1.7em; font-weight: bold; color: var(--vscode-activityBar-activeBorder, #007acc); }
        .card .label { font-size: 0.82em; color: var(--vscode-descriptionForeground); margin-top: 4px; }
        .card.danger .value { color: #f44336; }
        .card.warning .value { color: #ff9800; }
        .card.success .value { color: #4caf50; }
        .tabs { display: flex; gap: 0; margin: 25px 0 0 0; border-bottom: 1px solid var(--vscode-widget-border, #454545); flex-wrap: wrap; }
        .tab {
            padding: 10px 18px;
            cursor: pointer;
            border: none;
            background: transparent;
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
        }
        .tab:hover { color: var(--vscode-foreground); }
        .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-activityBar-activeBorder, #007acc); font-weight: 600; }
        .panel { display: none; padding: 20px 0; }
        .panel.active { display: block; }
        table { width: 100%; border-collapse: collapse; font-size: 0.83em; }
        th, td { padding: 7px 10px; text-align: left; border-bottom: 1px solid var(--vscode-widget-border, #333); }
        th { background: var(--vscode-editor-inactiveSelectionBackground); font-weight: 600; position: sticky; top: 0; z-index: 1; }
        .error-row td { color: #f44336; }
        .warning-row td { color: #ff9800; }
        .critical { background: rgba(244, 67, 54, 0.08); }
        .slow { background: rgba(255, 152, 0, 0.06); }
        .has-errors td { color: #ff9800; }
        .error-count { color: #f44336 !important; font-weight: bold; }
        .empty { text-align: center; color: var(--vscode-descriptionForeground); font-style: italic; padding: 20px; }
        .ts { font-family: monospace; font-size: 0.85em; white-space: nowrap; }
        .bar-container { display: flex; align-items: center; gap: 6px; min-width: 110px; }
        .bar { height: 6px; background: linear-gradient(90deg, #4caf50, #ff9800, #f44336); border-radius: 3px; min-width: 3px; }
        .bar-container span { font-size: 0.8em; white-space: nowrap; }
        .ai-content {
            background: var(--vscode-editor-inactiveSelectionBackground, #1e1e2e);
            padding: 20px;
            border-radius: 8px;
            border-left: 4px solid var(--vscode-activityBar-activeBorder, #007acc);
            line-height: 1.7;
        }
        .ai-content h1, .ai-content h2, .ai-content h3 { margin-top: 16px; margin-bottom: 8px; }
        .ai-content ul, .ai-content ol { padding-left: 20px; }
        .ai-content li { margin-bottom: 4px; }
        .ai-content table { margin: 10px 0; }
        code { background: var(--vscode-textCodeBlock-background, #1e1e1e); padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
        .table-wrapper { max-height: 500px; overflow-y: auto; border: 1px solid var(--vscode-widget-border, #333); border-radius: 6px; }
        .clickable { cursor: pointer; transition: transform 0.15s, box-shadow 0.15s; }
        .clickable:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        .card.clickable:active { transform: scale(0.97); }
        .error-row.clickable { cursor: pointer; }
        .error-row.clickable:hover { background: rgba(244, 67, 54, 0.12); }
        .expand-hint { font-size: 0.7em; color: var(--vscode-descriptionForeground); margin-left: 6px; transition: transform 0.2s; display: inline-block; }
        .expand-hint.open { transform: rotate(90deg); }
        .context-row td { padding: 0 !important; }
        .context-block {
            margin: 0;
            padding: 12px 16px;
            background: var(--vscode-textCodeBlock-background, #0d0d0d);
            border-left: 3px solid #f44336;
            font-family: monospace;
            font-size: 0.8em;
            line-height: 1.6;
            white-space: pre-wrap;
            word-break: break-all;
            color: var(--vscode-foreground);
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <h1>📊 Análise de Log AppServer Progress OpenEdge</h1>
    <div class="header-info">
        <strong>Arquivo:</strong> ${escapeHtml(path.basename(result.fileName))}<br>
        <strong>Período:</strong> ${result.timeRange.start} → ${result.timeRange.end} (${result.timeRange.durationMinutes.toFixed(1)} min)<br>
        <strong>Total de linhas:</strong> ${result.totalLines.toLocaleString()}
    </div>

    <div class="summary">
        <div class="card clickable ${result.errors.length > 0 ? 'danger' : 'success'}" onclick="switchTab('errors')">
            <div class="value">${result.errors.length}</div>
            <div class="label">Erros</div>
        </div>
        <div class="card clickable ${result.warnings.length > 10 ? 'warning' : 'success'}" onclick="switchTab('warnings')">
            <div class="value">${result.warnings.length}</div>
            <div class="label">Warnings</div>
        </div>
        <div class="card clickable" onclick="switchTab('performance')">
            <div class="value">${result.procedureTimings.length}</div>
            <div class="label">Procedures</div>
        </div>
        <div class="card">
            <div class="value">${result.connections.total}</div>
            <div class="label">Conexões</div>
        </div>
        <div class="card clickable" onclick="switchTab('agents')">
            <div class="value">${result.agentStats.length}</div>
            <div class="label">Agents</div>
        </div>
        <div class="card ${result.timeRange.durationMinutes > 30 ? 'warning' : ''}">
            <div class="value">${result.timeRange.durationMinutes.toFixed(1)}<small>m</small></div>
            <div class="label">Duração</div>
        </div>
    </div>

    <div class="tabs">
        <div class="tab active" data-tab="performance">⏱️ Performance</div>
        <div class="tab" data-tab="errors">❌ Erros (${result.errors.length})</div>
        <div class="tab" data-tab="warnings">⚠️ Warnings (${result.warnings.length})</div>
        <div class="tab" data-tab="agents">🖥️ Agents (${result.agentStats.length})</div>
        <div class="tab" data-tab="ai">🤖 Análise IA</div>
    </div>

    <div id="performance" class="panel active">
        <h2>⏱️ Procedures por Tempo de Execução</h2>
        <p style="color: var(--vscode-descriptionForeground); font-size: 0.85em;">Baseado nos traces 4GLTRACE (Run/Return). Procedures com mais tempo acumulado no topo.</p>
        <div class="table-wrapper">
        <table>
            <thead><tr>
                <th>#</th><th>Procedure</th><th>Chamadas</th><th>Total</th><th>Médio</th><th>Máximo</th><th>% Total</th>
            </tr></thead>
            <tbody>${timingsHtml}</tbody>
        </table>
        </div>
    </div>

    <div id="errors" class="panel">
        <h2>❌ Erros Encontrados</h2>
        <p style="color: var(--vscode-descriptionForeground); font-size: 0.85em;">loadProc() failed, STOP conditions, erros de runtime.</p>
        <div class="table-wrapper">
        <table>
            <thead><tr><th>Linha</th><th>Hora</th><th>Código</th><th>Agent</th><th>Mensagem</th></tr></thead>
            <tbody>${errorsHtml}</tbody>
        </table>
        </div>
    </div>

    <div id="warnings" class="panel">
        <h2>⚠️ Warnings (RowErrors / tt_log_erros)</h2>
        <p style="color: var(--vscode-descriptionForeground); font-size: 0.85em;">Retornos de procedures com indicadores de erro de negócio.</p>
        <div class="table-wrapper">
        <table>
            <thead><tr><th>Ocorrências</th><th>Procedure</th><th>Tipo</th><th>Agent</th></tr></thead>
            <tbody>${warningsHtml}</tbody>
        </table>
        </div>
    </div>

    <div id="agents" class="panel">
        <h2>🖥️ Estatísticas por Agent do AppServer</h2>
        <p style="color: var(--vscode-descriptionForeground); font-size: 0.85em;">Distribuição de carga entre agents (AS-N).</p>
        <div class="table-wrapper">
        <table>
            <thead><tr><th>Agent</th><th>Requests</th><th>Procedures</th><th>Erros</th></tr></thead>
            <tbody>${agentsHtml}</tbody>
        </table>
        </div>
    </div>

    <div id="ai" class="panel">
        <h2>🤖 Análise Inteligente</h2>
        ${aiHtml}
    </div>

    <script>
        function switchTab(tabId) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            const tab = document.querySelector('.tab[data-tab=\"' + tabId + '\"]');
            if (tab) tab.classList.add('active');
            const panel = document.getElementById(tabId);
            if (panel) panel.classList.add('active');
        }

        function toggleContext(id) {
            const row = document.getElementById(id);
            if (!row) return;
            const isHidden = row.style.display === 'none';
            row.style.display = isHidden ? 'table-row' : 'none';
            // Toggle arrow icon
            const parentRow = row.previousElementSibling;
            if (parentRow) {
                const hint = parentRow.querySelector('.expand-hint');
                if (hint) hint.classList.toggle('open', isHidden);
            }
        }

        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                switchTab(tab.dataset.tab);
            });
        });
    </script>
</body>
</html>`;
}

// =====================================================
// UTILITÁRIOS
// =====================================================

function formatTimestamp(ts: string): string {
    if (!ts) { return ''; }
    const match = ts.match(/T(\d{2}:\d{2}:\d{2}\.\d{3})/);
    return match ? match[1] : ts;
}

function truncate(str: string, max: number): string {
    return str.length > max ? str.substring(0, max) + '…' : str;
}

function groupWarnings(warnings: LogError[]): { count: number; procedure: string; message: string; agent: string }[] {
    const groups = new Map<string, { count: number; procedure: string; message: string; agent: string }>();
    for (const w of warnings) {
        const key = `${w.procedure || ''}|${w.errorCode}`;
        const existing = groups.get(key);
        if (existing) {
            existing.count++;
        } else {
            groups.set(key, { count: 1, procedure: w.procedure || '', message: w.message, agent: w.agent || '' });
        }
    }
    return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function markdownToHtml(md: string): string {
    return md
        .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/^\|(.+)\|$/gm, (match) => {
            const cells = match.split('|').filter(c => c.trim());
            if (cells.every(c => c.trim().match(/^[-:]+$/))) { return ''; }
            return '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
        })
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
        .replace(/<\/ul>\s*<ul>/g, '')
        .replace(/\n{2,}/g, '<br><br>')
        .replace(/\n/g, '<br>');
}

// =====================================================
// COMANDO PRINCIPAL
// =====================================================

export function registerLogAnalyzerCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('abl-linter.analyzeLog', async () => {
        const selectedFiles = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: 'Analisar Log',
            title: 'Selecionar arquivo de log do AppServer Progress',
            filters: {
                'Logs Progress': ['log', 'lg', 'txt'],
                'Todos os Arquivos': ['*']
            }
        });

        if (!selectedFiles || selectedFiles.length === 0) {
            return;
        }

        const filePath = selectedFiles[0].fsPath;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Analisando log AppServer Progress...',
                cancellable: true
            },
            async (progress, token) => {
                progress.report({ increment: 5, message: 'Lendo arquivo...' });

                let content: string;
                try {
                    content = fs.readFileSync(filePath, 'utf-8');
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Erro ao ler arquivo: ${err.message}`);
                    return;
                }

                const lines = content.split('\n');
                const totalLines = lines.length;

                if (token.isCancellationRequested) { return; }
                progress.report({ increment: 15, message: `Extraindo erros (${totalLines.toLocaleString()} linhas)...` });

                const { errors, warnings } = extractErrors(lines);

                if (token.isCancellationRequested) { return; }
                progress.report({ increment: 25, message: 'Calculando timings de procedures (4GLTRACE)...' });

                const procedureTimings = extractProcedureTimings(lines);
                const totalExecutionTime = procedureTimings.reduce((sum, p) => sum + p.totalTime, 0);
                const slowProcedures = procedureTimings.slice(0, 50);

                if (token.isCancellationRequested) { return; }
                progress.report({ increment: 10, message: 'Analisando conexões AppServer...' });

                const connectionsRaw = extractConnections(lines);
                const completedConns = connectionsRaw.filter(c => c.duration !== undefined);
                const connections = {
                    total: connectionsRaw.length,
                    avgDuration: completedConns.length > 0
                        ? completedConns.reduce((sum, c) => sum + (c.duration || 0), 0) / completedConns.length
                        : 0,
                    maxDuration: completedConns.length > 0
                        ? Math.max(...completedConns.map(c => c.duration || 0))
                        : 0
                };

                if (token.isCancellationRequested) { return; }
                progress.report({ increment: 10, message: 'Estatísticas de agents...' });

                const agentStats = extractAgentStats(lines);

                // Determina período do log
                let startTime = new Date();
                let endTime = new Date();
                for (let i = 0; i < Math.min(lines.length, 10); i++) {
                    const m = lines[i].match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[-+]\d{4})/);
                    if (m) { startTime = parseTimestamp(m[1]); break; }
                }
                for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
                    const m = lines[i].match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[-+]\d{4})/);
                    if (m) { endTime = parseTimestamp(m[1]); break; }
                }

                const durationMinutes = (endTime.getTime() - startTime.getTime()) / 60000;
                const timeRange = {
                    start: startTime.toISOString().replace('T', ' ').substring(0, 19),
                    end: endTime.toISOString().replace('T', ' ').substring(0, 19),
                    durationMinutes: durationMinutes > 0 ? durationMinutes : 0
                };

                const result: LogAnalysisResult = {
                    fileName: filePath,
                    totalLines,
                    timeRange,
                    errors,
                    warnings,
                    procedureTimings,
                    totalExecutionTime,
                    slowProcedures,
                    connections,
                    agentStats
                };

                // Análise com IA (se configurada)
                const config = vscode.workspace.getConfiguration('abl-linter');
                const aiApiKey = config.get<string>('aiApiKey', '');
                const aiApiUrl = config.get<string>('aiApiUrl', 'https://api.openai.com/v1/chat/completions');
                const aiModel = config.get<string>('aiModel', 'gpt-4o-mini');

                if (aiApiKey && !token.isCancellationRequested) {
                    progress.report({ increment: 15, message: 'Consultando IA para análise inteligente...' });
                    result.aiAnalysis = await analyzeWithAI(result, aiApiKey, aiApiUrl, aiModel);
                } else {
                    progress.report({ increment: 15 });
                }

                progress.report({ increment: 20, message: 'Gerando relatório...' });

                createResultsWebview(context, result);

                vscode.window.showInformationMessage(
                    `Análise concluída: ${errors.length} erros, ${warnings.length} warnings, ${procedureTimings.length} procedures rastreadas`
                );
            }
        );
    });

    context.subscriptions.push(disposable);
}
