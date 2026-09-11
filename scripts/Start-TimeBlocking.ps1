[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendUrl = 'http://127.0.0.1:4141/api/health'
$tasksUrl = 'http://127.0.0.1:4141/api/tasks'
$frontendUrl = 'http://localhost:5273/'

function Get-HttpResponseText {
    param([Parameter(Mandatory = $true)][string]$Url)

    try {
        $request = [System.Net.HttpWebRequest]::Create($Url)
        $request.Method = 'GET'
        $request.Timeout = 3000
        $request.ReadWriteTimeout = 3000
        $response = $request.GetResponse()
        try {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            try {
                return [PSCustomObject]@{
                    StatusCode = [int]$response.StatusCode
                    Content = $reader.ReadToEnd()
                }
            }
            finally {
                $reader.Dispose()
            }
        }
        finally {
            $response.Dispose()
        }
    }
    catch {
        return $null
    }
}

function Test-TimeBlockingBackend {
    $response = Get-HttpResponseText -Url $tasksUrl
    return $null -ne $response -and
        $response.StatusCode -ge 200 -and
        $response.StatusCode -lt 400 -and
        $response.Content.TrimStart().StartsWith('[')
}

function Test-TimeBlockingFrontend {
    $response = Get-HttpResponseText -Url $frontendUrl
    return $null -ne $response -and
        $response.StatusCode -ge 200 -and
        $response.StatusCode -lt 400 -and
        $response.Content -match '<title>TimeBlock</title>'
}

function Start-TimeBlockingService {
    param(
        [Parameter(Mandatory = $true)][string]$Command
    )

    # Use cmd.exe so the npm.cmd shim works consistently when launched from a shortcut.
    Start-Process -FilePath $env:ComSpec `
        -ArgumentList @('/d', '/c', $Command) `
        -WorkingDirectory $projectRoot `
        -WindowStyle Minimized | Out-Null
}

try {
    if (-not (Test-TimeBlockingBackend)) {
        Start-TimeBlockingService -Command 'call npm.cmd run dev:server'
    }

    if (-not (Test-TimeBlockingFrontend)) {
        # Port 5173 is commonly used by other Vite projects. Use 5273 exclusively
        # for this launcher and require Vite to fail instead of silently moving ports.
        Start-TimeBlockingService -Command 'set "PORT=5273" && call npm.cmd run dev:web -- --strictPort'
    }

    $deadline = (Get-Date).AddSeconds(120)
    do {
        $backendReady = Test-TimeBlockingBackend
        $frontendReady = Test-TimeBlockingFrontend

        if ($backendReady -and $frontendReady) {
            Start-Process $frontendUrl
            exit 0
        }

        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)

    throw 'TimeBlocking did not become ready within two minutes. Check that Node.js dependencies are installed and that ports 4141 and 5273 are free.'
}
catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        $_.Exception.Message,
        'TimeBlocking launcher',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}
