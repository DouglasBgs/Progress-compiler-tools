import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeLog, LogIssue, StaticLogAnalysis } from '../log-analysis/analysis';
import { parseAvmLog } from '../log-analysis/avmLogParser';

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDate(value: Date | null): string {
    return value ? value.toLocaleString('pt-BR') : '-';
}

function formatSeconds(value: number): string {
    return `${value.toFixed(3)}s`;
}

function issueRows(issues: LogIssue[], className: string): string {
    if (!issues.length) {
        return '<tr><td colspan="6" class="empty">Nenhum item encontrado.</td></tr>';
    }

    return issues.slice(0, 200).map((issue, index) => `
        <tr class="${className} clickable" onclick="toggleContext('${className}-${index}')">
            <td>${issue.line}</td>
            <td>${formatDate(issue.timestamp)}</td>
            <td>${escapeHtml(`${issue.processId} / ${issue.threadId}`)}</td>
            <td>${escapeHtml(issue.type)}</td>
            <td>${escapeHtml(issue.procedure ?? '-')}</td>
            <td>${escapeHtml(issue.message)} <span class="hint">&#9654;</span></td>
        </tr>
        <tr id="${className}-${index}" class="context" hidden>
            <td colspan="6"><pre>${issue.context.map(escapeHtml).join('\n')}</pre></td>
        </tr>`).join('');
}

function warningRows(issues: LogIssue[]): string {
    const grouped = new Map<string, { type: string; procedure: string; count: number }>();
    for (const issue of issues) {
        const procedure = issue.procedure ?? '-';
        const key = `${issue.type}:${procedure}`;
        const current = grouped.get(key) ?? { type: issue.type, procedure, count: 0 };
        current.count++;
        grouped.set(key, current);
    }

    return [...grouped.values()]
        .sort((first, second) => second.count - first.count)
        .map((warning) => `<tr><td>${warning.count}</td><td>${escapeHtml(warning.type)}</td><td>${escapeHtml(warning.procedure)}</td></tr>`)
        .join('') || '<tr><td colspan="3" class="empty">Nenhum warning encontrado.</td></tr>';
}

function generateWebviewHtml(filePath: string, totalLines: number, ignoredLines: number, formats: string[], result: StaticLogAnalysis): string {
    const totalTime = result.procedureTimings.reduce((sum, timing) => sum + timing.totalTime, 0);
    const timingRows = result.procedureTimings.slice(0, 100).map((timing, index) => `
        <tr data-procedure="${escapeHtml(timing.name).toLowerCase()}">
            <td>${index + 1}</td><td>${escapeHtml(timing.name)}</td><td>${timing.calls}</td>
            <td>${formatSeconds(timing.totalTime)}</td><td>${formatSeconds(timing.avgTime)}</td>
            <td>${formatSeconds(timing.maxTime)}</td><td>${timing.percentage.toFixed(1)}%</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhum par Run/Return encontrado.</td></tr>';
    const databaseRows = result.databases.map((database) => `<tr><td>${escapeHtml(database.name)}</td><td>${escapeHtml(database.users.join(', ') || '-')}</td><td>${database.connections}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nenhuma conexão de banco encontrada.</td></tr>';
    const fileRows = result.files.slice(0, 100).map((file) => `<tr><td>${escapeHtml(file.path)}</td><td>${file.opens}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">Nenhuma abertura FILEID encontrada.</td></tr>';
    const unclosedRows = result.unclosedFiles.map((file) => `<tr><td>${escapeHtml(file.path)}</td><td>${file.fileId}</td><td>${file.processId} / ${file.threadId}</td><td>${file.line}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhum arquivo pendente.</td></tr>';
    const processRows = result.processThreads.map((process) => `<tr><td>${process.processId}</td><td>${process.threadId}</td><td>${process.events}</td><td>${process.traces}</td><td>${process.errors}</td><td>${formatDate(process.startedAt)}</td><td>${formatDate(process.endedAt)}</td></tr>`).join('');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Análise de Log - ${escapeHtml(path.basename(filePath))}</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
h1 { margin: 0 0 8px; font-size: 1.5em; } h2 { font-size: 1.05em; } .meta { color: var(--vscode-descriptionForeground); }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 20px 0; }
.card { border: 1px solid var(--vscode-widget-border); background: var(--vscode-editor-inactiveSelectionBackground); padding: 12px; border-radius: 6px; }
.value { display: block; font-size: 1.5em; font-weight: 700; color: var(--vscode-activityBar-activeBorder); } .label { font-size: .82em; color: var(--vscode-descriptionForeground); }
.tabs { display: flex; flex-wrap: wrap; border-bottom: 1px solid var(--vscode-widget-border); } .tab { padding: 10px 14px; background: transparent; color: var(--vscode-foreground); border: 0; cursor: pointer; } .tab.active { border-bottom: 2px solid var(--vscode-activityBar-activeBorder); }
.panel { display: none; padding-top: 16px; } .panel.active { display: block; } .filter { width: min(460px, 100%); padding: 7px; margin: 0 0 10px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
.wrap { max-height: 560px; overflow: auto; border: 1px solid var(--vscode-widget-border); } table { width: 100%; border-collapse: collapse; font-size: .84em; } th, td { padding: 8px; border-bottom: 1px solid var(--vscode-widget-border); text-align: left; vertical-align: top; } th { position: sticky; top: 0; background: var(--vscode-editor-inactiveSelectionBackground); } .error td { color: #f48771; } .warning td { color: #d7ba7d; } .empty { text-align: center; color: var(--vscode-descriptionForeground); } .clickable { cursor: pointer; } .context pre { margin: 0; white-space: pre-wrap; word-break: break-word; background: var(--vscode-textCodeBlock-background); padding: 12px; color: var(--vscode-foreground); }
</style>
</head>
<body>
<h1>Análise Estática de Log OpenEdge</h1>
<div class="meta"><strong>Arquivo:</strong> ${escapeHtml(path.basename(filePath))}<br><strong>Formato detectado:</strong> ${escapeHtml(formats.join(', ') || 'desconhecido')}<br><strong>Período:</strong> ${formatDate(result.timeRange.start)} até ${formatDate(result.timeRange.end)}<br><strong>Tempo rastreado:</strong> ${formatSeconds(totalTime)}</div>
<div class="summary">
<div class="card"><span class="value">${totalLines}</span><span class="label">Linhas totais</span></div>
<div class="card"><span class="value">${totalLines - ignoredLines}</span><span class="label">Linhas reconhecidas</span></div>
<div class="card"><span class="value">${ignoredLines}</span><span class="label">Linhas ignoradas</span></div>
<div class="card"><span class="value">${result.errors.length}</span><span class="label">Erros técnicos</span></div>
<div class="card"><span class="value">${result.warnings.length}</span><span class="label">Warnings negócio</span></div>
<div class="card"><span class="value">${result.procedureTimings.length}</span><span class="label">Procedures rastreadas</span></div>
<div class="card"><span class="value">${result.databases.length}</span><span class="label">Bancos conectados</span></div>
<div class="card"><span class="value">${result.unclosedFiles.length}</span><span class="label">Arquivos sem close</span></div>
</div>
<div class="tabs">
<button class="tab active" data-tab="performance">Performance</button><button class="tab" data-tab="errors">Erros</button><button class="tab" data-tab="warnings">Warnings</button><button class="tab" data-tab="resources">Banco e Arquivos</button><button class="tab" data-tab="processes">Processos e Threads</button>
</div>
<section id="performance" class="panel active"><h2>Procedures por tempo de execução</h2><input id="procedureFilter" class="filter" placeholder="Filtrar procedure"><div class="wrap"><table><thead><tr><th>#</th><th>Procedure</th><th>Chamadas</th><th>Total</th><th>Média</th><th>Máximo</th><th>%</th></tr></thead><tbody id="timings">${timingRows}</tbody></table></div></section>
<section id="errors" class="panel"><h2>Erros técnicos</h2><div class="wrap"><table><thead><tr><th>Linha</th><th>Horário</th><th>Processo/thread</th><th>Tipo</th><th>Procedure</th><th>Mensagem</th></tr></thead><tbody>${issueRows(result.errors, 'error')}</tbody></table></div></section>
<section id="warnings" class="panel"><h2>Warnings de negócio</h2><div class="wrap"><table><thead><tr><th>Ocorrências</th><th>Tipo</th><th>Procedure</th></tr></thead><tbody>${warningRows(result.warnings)}</tbody></table></div></section>
<section id="resources" class="panel"><h2>Bancos conectados</h2><div class="wrap"><table><thead><tr><th>Banco</th><th>Usuários</th><th>Conexões</th></tr></thead><tbody>${databaseRows}</tbody></table></div><h2>Arquivos mais abertos</h2><div class="wrap"><table><thead><tr><th>Arquivo</th><th>Aberturas</th></tr></thead><tbody>${fileRows}</tbody></table></div><h2>Arquivos sem fechamento</h2><div class="wrap"><table><thead><tr><th>Arquivo</th><th>ID</th><th>Processo/thread</th><th>Linha</th></tr></thead><tbody>${unclosedRows}</tbody></table></div></section>
<section id="processes" class="panel"><h2>Carga por processo e thread</h2><div class="wrap"><table><thead><tr><th>Processo</th><th>Thread</th><th>Eventos</th><th>Traces</th><th>Erros</th><th>Início</th><th>Fim</th></tr></thead><tbody>${processRows}</tbody></table></div></section>
<script>
function toggleContext(id) { const row = document.getElementById(id); if (row) row.hidden = !row.hidden; }
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.tab, .panel').forEach((item) => item.classList.remove('active')); tab.classList.add('active'); document.getElementById(tab.dataset.tab).classList.add('active'); }));
document.getElementById('procedureFilter').addEventListener('input', (event) => { const term = event.target.value.toLowerCase(); document.querySelectorAll('#timings tr').forEach((row) => { row.hidden = !row.dataset.procedure?.includes(term); }); });
</script>
</body>
</html>`;
}

export function registerLogAnalyzerCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('abl-linter.analyzeLog', async () => {
        const selectedFiles = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: 'Analisar Log',
            title: 'Selecionar arquivo de log OpenEdge',
            filters: { 'Logs OpenEdge': ['lst', 'log', 'lg', 'txt'], 'Todos os Arquivos': ['*'] },
        });
        if (!selectedFiles?.length) {
            return;
        }

        const filePath = selectedFiles[0].fsPath;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Analisando log OpenEdge...', cancellable: true }, async (progress, token) => {
            progress.report({ increment: 15, message: 'Lendo arquivo...' });
            let content: string;
            try {
                const buffer = fs.readFileSync(filePath);
                const utf8Content = buffer.toString('utf8');
                content = utf8Content.includes('\uFFFD') ? buffer.toString('latin1') : utf8Content;
            } catch (err: any) {
                vscode.window.showErrorMessage(`Erro ao ler arquivo: ${err.message}`);
                return;
            }
            if (token.isCancellationRequested) return;

            progress.report({ increment: 35, message: 'Interpretando eventos AVM...' });
            const parsed = parseAvmLog(content);
            if (token.isCancellationRequested) return;

            progress.report({ increment: 35, message: 'Calculando métricas estáticas...' });
            const result = analyzeLog(parsed.lines);
            if (token.isCancellationRequested) return;

            progress.report({ increment: 15, message: 'Gerando relatório...' });
            const panel = vscode.window.createWebviewPanel('ablLogAnalysis', `Análise: ${path.basename(filePath)}`, vscode.ViewColumn.One, { enableScripts: true });
            panel.webview.html = generateWebviewHtml(filePath, parsed.totalLines, parsed.ignoredLines, parsed.formats, result);

            if (parsed.ignoredLines > 0) {
                vscode.window.showWarningMessage(`Análise concluída: ${parsed.lines.length} linhas reconhecidas; ${parsed.ignoredLines} ignoradas por formato não suportado.`);
            } else {
                vscode.window.showInformationMessage(`Análise concluída: ${result.errors.length} erros, ${result.warnings.length} warnings e ${result.procedureTimings.length} procedures rastreadas.`);
            }
        });
    });

    context.subscriptions.push(disposable);
}
