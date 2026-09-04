import * as vscode from 'vscode';

export interface RepositoryDef {
    id: string;          // Ex: "EMS2.08", "EMS5.08", "FND1.02"
    code: string;        // Ex: "EMS2", "EMS5", "FONDATION"
    displayName: string; // Ex: "EMS2 (EMS 2.08)", "FONDATION (FND 1.02)"
    folderPatterns: RegExp[];
}

export const KNOWN_REPOSITORIES: RepositoryDef[] = [
    {
        id: 'FND1.02',
        code: 'FONDATION',
        displayName: 'FONDATION (FND 1.02)',
        folderPatterns: [
            /^fondation$/i,
            /^foundation$/i,
            /^fnd$/i,
            /^fnd1$/i,
            /^fnd1\.02$/i,
            /^fnd102$/i,
            /^fundacao$/i,
            /^fundação$/i,
        ]
    },
    {
        id: 'EMS2.08',
        code: 'EMS2',
        displayName: 'EMS2 (EMS 2.08)',
        folderPatterns: [
            /^ems2$/i,
            /^ems-2$/i,
            /^ems_2$/i,
            /^ems208$/i,
            /^ems2\.08$/i,
        ]
    },
    {
        id: 'EMS5.08',
        code: 'EMS5',
        displayName: 'EMS5 (EMS 5.08)',
        folderPatterns: [
            /^ems5$/i,
            /^ems-5$/i,
            /^ems_5$/i,
            /^ems508$/i,
            /^ems5\.08$/i,
        ]
    },
    {
        id: 'CRM',
        code: 'CRM',
        displayName: 'CRM',
        folderPatterns: [
            /^crm$/i
        ]
    },
    {
        id: 'HCM2.11A',
        code: 'HCM',
        displayName: 'HCM (HCM 2.11A)',
        folderPatterns: [
            /^hcm$/i,
            /^hcm2$/i,
            /^hcm2\.11a?$/i,
            /^hcm211a?$/i,
        ]
    },
    {
        id: 'GP3.50',
        code: 'GP',
        displayName: 'GP (GP 3.50)',
        folderPatterns: [
            /^gp$/i,
            /^gp3$/i,
            /^gp3\.50$/i,
            /^gp350$/i,
        ]
    },
    {
        id: 'EAI1.00',
        code: 'EAI',
        displayName: 'EAI (EAI 1.00)',
        folderPatterns: [
            /^eai$/i,
            /^eai1$/i,
            /^eai1\.00$/i,
            /^eai100$/i,
        ]
    },
    {
        id: 'HUB',
        code: 'HUB',
        displayName: 'HUB',
        folderPatterns: [
            /^hub$/i
        ]
    }
];

export interface FileRootInfo {
    rootFolder?: string;
    targetRelative: string;
    detectedRepo?: RepositoryDef;
}

/**
 * Encontra a definição de repositório a partir do nome da pasta raiz.
 */
export function detectRepositoryFromRootFolder(folderName: string): RepositoryDef | undefined {
    if (!folderName) { return undefined; }
    const trimmed = folderName.trim();

    // 1. Busca direta por ID ou Code
    const directMatch = KNOWN_REPOSITORIES.find(
        r => r.id.toLowerCase() === trimmed.toLowerCase() || r.code.toLowerCase() === trimmed.toLowerCase()
    );
    if (directMatch) { return directMatch; }

    // 2. Busca por patterns
    for (const repo of KNOWN_REPOSITORIES) {
        for (const pattern of repo.folderPatterns) {
            if (pattern.test(trimmed)) {
                return repo;
            }
        }
    }

    return undefined;
}

/**
 * Analisa o caminho do arquivo e extrai:
 * 1. O nome da pasta raiz que precede 'progress/src/' (ou 'src/').
 * 2. O caminho relativo do arquivo a partir de 'progress/src/' (ou 'src/').
 * 3. A definição do repositório detectado.
 */
export function extractRelativeAndRoot(filePath: string): FileRootInfo {
    const normalized = filePath.replace(/\\/g, '/');

    // Procura primeiro por 'progress/src/'
    const progressSrcMarker = '/progress/src/';
    const progressSrcIndex = normalized.toLowerCase().indexOf(progressSrcMarker);

    if (progressSrcIndex !== -1) {
        const before = normalized.substring(0, progressSrcIndex);
        const after = normalized.substring(progressSrcIndex + progressSrcMarker.length);

        // O segmento imediatamente antes de /progress/src/ é a pasta raiz
        const parts = before.split('/').filter(p => p.length > 0);
        const rootFolder = parts.length > 0 ? parts[parts.length - 1] : undefined;
        const detectedRepo = rootFolder ? detectRepositoryFromRootFolder(rootFolder) : undefined;

        return {
            rootFolder,
            targetRelative: after,
            detectedRepo
        };
    }

    // Se começa diretamente com 'progress/src/'
    if (normalized.toLowerCase().startsWith('progress/src/')) {
        const after = normalized.substring('progress/src/'.length);
        return {
            targetRelative: after,
            detectedRepo: undefined
        };
    }

    // Fallback: procura por '/src/'
    const srcMarker = '/src/';
    const srcIndex = normalized.toLowerCase().indexOf(srcMarker);

    if (srcIndex !== -1) {
        const before = normalized.substring(0, srcIndex);
        const after = normalized.substring(srcIndex + srcMarker.length);

        const parts = before.split('/').filter(p => p.length > 0);
        const rootFolder = parts.length > 0 ? parts[parts.length - 1] : undefined;
        const detectedRepo = rootFolder ? detectRepositoryFromRootFolder(rootFolder) : undefined;

        return {
            rootFolder,
            targetRelative: after,
            detectedRepo
        };
    }

    // Se começa diretamente com 'src/'
    if (normalized.toLowerCase().startsWith('src/')) {
        const after = normalized.substring('src/'.length);
        return {
            targetRelative: after,
            detectedRepo: undefined
        };
    }

    // Se não tiver progress/src/ nem src/, tenta identificar se o início do caminho é um repositório conhecido
    const parts = normalized.split('/').filter(p => p.length > 0);
    if (parts.length > 1) {
        const firstPart = parts[0];
        const repo = detectRepositoryFromRootFolder(firstPart);
        if (repo) {
            return {
                rootFolder: firstPart,
                targetRelative: parts.slice(1).join('/'),
                detectedRepo: repo
            };
        }
    }

    return {
        targetRelative: normalized,
        detectedRepo: undefined
    };
}

/**
 * Retorna o repositório detectado para um único URI (por arquivo ativo ou workspace folder).
 */
export function detectRepositoryForUri(uri: vscode.Uri): RepositoryDef | undefined {
    // 1. Tenta extrair da estrutura de pastas antes de progress/src/
    const info = extractRelativeAndRoot(uri.fsPath);
    if (info.detectedRepo) {
        return info.detectedRepo;
    }

    // 2. Se não detectou, verifica o nome do WorkspaceFolder
    const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (wsFolder) {
        const repoFromWs = detectRepositoryFromRootFolder(wsFolder.name);
        if (repoFromWs) {
            return repoFromWs;
        }
    }

    // 3. Procura no caminho completo se há ocorrência de algum dos repositórios
    const normalized = uri.fsPath.replace(/\\/g, '/').toLowerCase();
    for (const repo of KNOWN_REPOSITORIES) {
        for (const pattern of repo.folderPatterns) {
            // Verifica se existe um segmento de pasta com o padrão
            const segments = normalized.split('/');
            if (segments.some(s => pattern.test(s))) {
                return repo;
            }
        }
    }

    return undefined;
}

export interface DetectedRepoGroup {
    repo: RepositoryDef;
    uris: vscode.Uri[];
    rootFolderNames: Set<string>;
}

/**
 * Agrupa uma lista de URIs pelos repositórios detectados.
 */
export function groupUrisByRepository(uris: vscode.Uri[]): Map<string, DetectedRepoGroup> {
    const groups = new Map<string, DetectedRepoGroup>();

    for (const uri of uris) {
        const detected = detectRepositoryForUri(uri);
        const repoId = detected ? detected.id : '__unknown__';
        const rootInfo = extractRelativeAndRoot(uri.fsPath);
        const rootName = rootInfo.rootFolder || (detected ? detected.code : 'Desconhecido');

        if (!groups.has(repoId)) {
            const repoDef: RepositoryDef = detected || {
                id: '__unknown__',
                code: 'OUTRO',
                displayName: 'Outro / Não Identificado',
                folderPatterns: []
            };
            groups.set(repoId, {
                repo: repoDef,
                uris: [uri],
                rootFolderNames: new Set([rootName])
            });
        } else {
            const group = groups.get(repoId)!;
            group.uris.push(uri);
            group.rootFolderNames.add(rootName);
        }
    }

    return groups;
}

/**
 * Resolve qual repositório/compilador deve ser utilizado para a compilação.
 * Se múltiplos repositórios forem detectados, lida com a estratégia de prioridade
 * (pergunta ao usuário via QuickPick ou usa a prioridade configurada).
 */
export async function resolveCompilationRepositoryForUris(
    uris: vscode.Uri[]
): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('abl-linter');
    const autoDetect = config.get<boolean>('autoDetectRepository', true);
    const configuredRepo = config.get<string>('compilationRepository', 'EMS2.08');

    if (!autoDetect) {
        return configuredRepo;
    }

    const groups = groupUrisByRepository(uris);
    const detectedGroups = Array.from(groups.values()).filter(g => g.repo.id !== '__unknown__');

    // Caso 1: Nenhum repositório específico foi detectado
    if (detectedGroups.length === 0) {
        return configuredRepo;
    }

    // Caso 2: Apenas 1 repositório detectado (todos os arquivos pertencem a ele, ex: tudo EMS2 ou tudo FONDATION)
    if (detectedGroups.length === 1) {
        return detectedGroups[0].repo.id;
    }

    // Caso 3: Multipastas com múltiplos repositórios detectados (ex: FONDATION e EMS2)
    // Deixa sempre o usuário responder qual deseja priorizar
    type PriorityPickItem = vscode.QuickPickItem & { repoId: string };

    const pickItems: PriorityPickItem[] = detectedGroups.map(g => {
        const rootNames = Array.from(g.rootFolderNames).join(', ');
        return {
            label: `$(repo) ${g.repo.displayName}`,
            description: `Pasta(s): ${rootNames}`,
            detail: `Priorizar este compilador para os ${g.uris.length} arquivo(s) selecionados desta pasta`,
            repoId: g.repo.id
        };
    });

    // Opção extra para usar o repositório configurado
    pickItems.push({
        label: `$(gear) Repositório Padrão das Configurações (${configuredRepo})`,
        description: 'Usar repositório global configurado no VS Code',
        detail: 'Não priorizar nenhuma pasta detectada especificamente',
        repoId: configuredRepo
    });

    const chosen = await vscode.window.showQuickPick(pickItems, {
        title: '⚡ Múltiplas Pastas Detectadas: Prioridade de Compilação',
        placeHolder: 'Foram detectadas pastas de diferentes produtos (ex: FONDATION, EMS2). Qual ambiente você deseja priorizar?',
        ignoreFocusOut: true
    });

    if (!chosen) {
        // Cancelado pelo usuário
        return undefined;
    }

    return chosen.repoId;
}

/**
 * Retorna o nome amigável para exibição de um repositório por ID.
 */
export function getRepositoryDisplayName(repoId: string): string {
    const match = KNOWN_REPOSITORIES.find(r => r.id.toLowerCase() === repoId.toLowerCase());
    return match ? match.displayName : repoId;
}
