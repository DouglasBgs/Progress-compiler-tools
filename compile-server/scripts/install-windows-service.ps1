[CmdletBinding()]
param(
    [string]$ServiceName = "ABLCompileServer",
    [string]$NssmPath = "nssm.exe",
    [string]$NodePath = "node.exe",
    [string]$AppDirectory = "",
    [switch]$Start
)

$ErrorActionPreference = "Stop"

$scriptDirectory = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptDirectory)) {
    $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if ([string]::IsNullOrWhiteSpace($AppDirectory)) {
    $AppDirectory = Split-Path -Parent (Split-Path -Parent $scriptDirectory)
}

function Invoke-Nssm {
    param([string[]]$Arguments)

    & $NssmPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "NSSM falhou com codigo ${LASTEXITCODE}: $($Arguments -join ' ')"
    }
}

$AppDirectory = (Resolve-Path $AppDirectory).Path
$NodePath = (Get-Command $NodePath -ErrorAction Stop).Source
$logsDirectory = Join-Path $AppDirectory "logs"
$stdoutLog = Join-Path $logsDirectory "service.stdout.log"
$stderrLog = Join-Path $logsDirectory "service.stderr.log"

New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Invoke-Nssm @("stop", $ServiceName)
    Invoke-Nssm @("remove", $ServiceName, "confirm")
}

Invoke-Nssm @("install", $ServiceName, $NodePath, "dist\server.js")
Invoke-Nssm @("set", $ServiceName, "AppDirectory", $AppDirectory)
Invoke-Nssm @("set", $ServiceName, "AppExit", "Default", "Restart")
Invoke-Nssm @("set", $ServiceName, "AppStdout", $stdoutLog)
Invoke-Nssm @("set", $ServiceName, "AppStderr", $stderrLog)
Invoke-Nssm @("set", $ServiceName, "AppRotateFiles", "1")
Invoke-Nssm @("set", $ServiceName, "AppRotateOnline", "1")
Invoke-Nssm @("set", $ServiceName, "AppRotateBytes", "10485760")
Invoke-Nssm @("set", $ServiceName, "Start", "SERVICE_AUTO_START")
Invoke-Nssm @("set", $ServiceName, "DisplayName", "ABL Compile Server")
Invoke-Nssm @("set", $ServiceName, "Description", "Servidor de compilacao remota OpenEdge ABL")

Write-Host "Servico $ServiceName instalado."
Write-Host "Diretorio: $AppDirectory"
Write-Host "Logs: $logsDirectory"

if ($Start) {
    Start-Service -Name $ServiceName -ErrorAction Stop
    $serviceStarted = $false

    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $service = Get-Service -Name $ServiceName -ErrorAction Stop
        if ($service.Status -eq "Running") {
            $serviceStarted = $true
            break
        }
        if ($service.Status -eq "Stopped") { break }
        Start-Sleep -Seconds 1
    }

    if (-not $serviceStarted) {
        $finalStatus = (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue).Status
        throw "Servico $ServiceName nao iniciou (status: $finalStatus). Consulte $stderrLog."
    }

    Write-Host "Servico iniciado."
} else {
    Write-Host "Para iniciar: nssm start $ServiceName"
}