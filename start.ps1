# 视频号智能助手 - 一键启动脚本
# 后端和前端均在后台静默启动，不弹出 PowerShell 窗口

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "🚀 视频号智能助手 启动中..." -ForegroundColor Cyan

# 启动后端 (FastAPI, port 8000)
$backendCmd = "cd '$root\backend'; .\venv\Scripts\Activate.ps1; `$env:PYTHONIOENCODING='utf-8'; uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd -WindowStyle Hidden
Write-Host "  ✅ 后端已启动 (port 8000)" -ForegroundColor Green

# 启动前端 (Vite, port 5173)
$frontendCmd = "cd '$root\frontend'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd -WindowStyle Hidden
Write-Host "  ✅ 前端已启动 (port 5173)" -ForegroundColor Green

Write-Host ""
Write-Host "📋 访问地址:" -ForegroundColor Yellow
Write-Host "  前端:     http://localhost:5173" -ForegroundColor White
Write-Host "  后端 API: http://localhost:8000" -ForegroundColor White
Write-Host "  API 文档: http://localhost:8000/docs" -ForegroundColor White
Write-Host ""
Write-Host "按任意键停止所有服务..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# 停止服务
Write-Host "正在停止服务..." -ForegroundColor Cyan
Get-Process | Where-Object { $_.ProcessName -eq "powershell" -and $_.MainWindowTitle -eq "" } | ForEach-Object {
    $proc = $_
    try {
        # 不强制杀，保留用户自己的 PowerShell
    } catch {}
}
# 通过端口杀进程
$port8000 = (Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
$port5173 = (Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
if ($port8000) { Stop-Process -Id $port8000 -Force -ErrorAction SilentlyContinue }
if ($port5173) { Stop-Process -Id $port5173 -Force -ErrorAction SilentlyContinue }
Write-Host "  服务已停止" -ForegroundColor Green
