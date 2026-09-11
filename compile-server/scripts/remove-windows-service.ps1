[CmdletBinding()]
param(
    [string]$ServiceName = "ABLCompileServer",
    [string]$NssmPath = "nssm.exe"
)

$ErrorActionPreference = "Stop"

& $NssmPath stop $ServiceName 2>$null
& $NssmPath remove $ServiceName confirm
if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel remover o servico $ServiceName. Execute o PowerShell como Administrador."
}

Write-Host "Servico $ServiceName removido."