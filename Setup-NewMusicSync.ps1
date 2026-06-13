$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

$appRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$newMusicExe = Join-Path $appRoot "NewMusic.exe"

if (-not (Test-Path -LiteralPath $newMusicExe)) {
    throw "NewMusic.exe was not found at $newMusicExe"
}

Write-Host ""
Write-Host "NewMusic Sync first-time setup" -ForegroundColor Cyan
Write-Host "App: $newMusicExe"
Write-Host ""

$rules = @(
    @{
        DisplayName = "NewMusic Sync TCP"
        Protocol = "TCP"
        LocalPort = "Any"
    },
    @{
        DisplayName = "NewMusic Sync Discovery UDP"
        Protocol = "UDP"
        LocalPort = "46385"
    }
)

foreach ($rule in $rules) {
    Get-NetFirewallRule -DisplayName $rule.DisplayName -ErrorAction SilentlyContinue | Remove-NetFirewallRule

    $params = @{
        DisplayName = $rule.DisplayName
        Direction = "Inbound"
        Program = $newMusicExe
        Action = "Allow"
        Profile = "Private"
        Protocol = $rule.Protocol
    }

    if ($rule.LocalPort -ne "Any") {
        $params.LocalPort = $rule.LocalPort
    }

    New-NetFirewallRule @params | Out-Null
    Write-Host "Added firewall rule: $($rule.DisplayName)" -ForegroundColor Green
}

$publicProfiles = Get-NetConnectionProfile | Where-Object {
    $_.NetworkCategory -eq "Public" -and $_.IPv4Connectivity -ne "Disconnected"
}

if ($publicProfiles) {
    Write-Host ""
    Write-Host "Some active networks are Public. NewMusic Sync rules only apply to Private networks." -ForegroundColor Yellow
    $publicProfiles | Select-Object InterfaceAlias, Name, NetworkCategory | Format-Table -AutoSize
    $answer = Read-Host "Set these active network(s) to Private? Type Y to confirm"

    if ($answer -match "^[Yy]") {
        foreach ($profile in $publicProfiles) {
            Set-NetConnectionProfile -InterfaceIndex $profile.InterfaceIndex -NetworkCategory Private
            Write-Host "Set $($profile.InterfaceAlias) to Private." -ForegroundColor Green
        }
    } else {
        Write-Host "Skipped network profile changes. Sync may be blocked on Public networks." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Setup complete. Restart NewMusic, then sync from NewMusic PE." -ForegroundColor Cyan
Read-Host "Press Enter to close"
