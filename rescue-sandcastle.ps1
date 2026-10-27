# ==============================================================================
# Script de Resgate Automático do Sandcastle (Auto-Rescue & Cleanup)
# ==============================================================================

$RepoRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location }
Set-Location $RepoRoot

Write-Host ">>> 1. Encerrando containers orfaos do Sandcastle..." -ForegroundColor Yellow
try {
    $containers = docker ps -q --filter ancestor=sandcastle-agent 2>$null
    if ($containers) {
        $containers | ForEach-Object { docker kill $_ }
        Write-Host "Containers encerrados com sucesso." -ForegroundColor Green
    } else {
        Write-Host "Nenhum container ativo encontrado." -ForegroundColor DarkGray
    }
} catch {
    Write-Host "Docker nao esta respondendo ou nao esta em execucao." -ForegroundColor DarkGray
}

Write-Host "`n>>> 2. Limpando worktrees pendentes do Git..." -ForegroundColor Yellow
git worktree prune
$worktreeDir = Join-Path $RepoRoot ".sandcastle\worktrees"
if (Test-Path $worktreeDir) {
    Get-ChildItem -Path $worktreeDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        git worktree remove --force $_.FullName 2>$null
        if (Test-Path $_.FullName) { Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue }
    }
}
git worktree prune
Write-Host "Worktrees limpas com sucesso." -ForegroundColor Green

Write-Host "`n>>> 3. Extraindo o ultimo log de erro..." -ForegroundColor Yellow
$logsDir = Join-Path $RepoRoot ".sandcastle\logs"
if (Test-Path $logsDir) {
    $ultimoLog = Get-ChildItem -Path "$logsDir\*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($ultimoLog) {
        Write-Host "Ultimo arquivo de log identificado: $($ultimoLog.Name)" -ForegroundColor Cyan
        $conteudoLog = Get-Content $ultimoLog.FullName -Tail 40
        try {
            $conteudoLog | Set-Clipboard
            Write-Host "As ultimas 40 linhas do log foram copiadas para sua Area de Transferencia (Ctrl+V)!" -ForegroundColor Green
        } catch {
            Write-Host "Nao foi possivel acessar o clipboard. Exibindo resumo do log:" -ForegroundColor DarkGray
            $conteudoLog | ForEach-Object { Write-Host $_ }
        }
    } else {
        Write-Host "Nenhum arquivo de log encontrado em $logsDir." -ForegroundColor DarkGray
    }
} else {
    Write-Host "Diretorio de logs nao encontrado." -ForegroundColor DarkGray
}
