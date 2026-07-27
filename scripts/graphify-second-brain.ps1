param(
  [string]$VaultPath = '',
  [ValidateSet('gemini', 'ollama')]
  [string]$Backend = 'gemini',
  [switch]$Serve,
  [ValidateRange(1024, 65535)]
  [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$dataDir = if ($env:TB_DATA_DIR) { [IO.Path]::GetFullPath($env:TB_DATA_DIR) } else { Join-Path $repoRoot 'data' }
$vault = if ($VaultPath) { [IO.Path]::GetFullPath($VaultPath) } else { Join-Path $dataDir 'vault' }
$outputRoot = Join-Path $dataDir 'graphify-second-brain'
$graphPath = Join-Path $outputRoot 'graphify-out\graph.json'

if (-not (Test-Path -LiteralPath $vault -PathType Container)) {
  throw "Second Brain vault not found: $vault"
}
if (-not (Get-Command graphify -ErrorAction SilentlyContinue)) {
  throw 'Graphify is not installed. Install the official package with: uv tool install graphifyy'
}

# The vault lives under data/, which is intentionally ignored by both Git and the
# codebase graph. Mirror Markdown into a scoped temp corpus so Graphify can index
# the notes independently without exposing snapshots, trash, or attachments.
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $repoHashBytes = $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($repoRoot))
}
finally {
  $sha256.Dispose()
}
$repoHash = (-join ($repoHashBytes | ForEach-Object { $_.ToString('x2') })).Substring(0, 12)
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$staging = [IO.Path]::GetFullPath((Join-Path $tempRoot "timeblocking-graphify-brain-$repoHash"))
if (-not $staging.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to mirror notes outside the temporary directory: $staging"
}

New-Item -ItemType Directory -Force -Path $staging, $outputRoot | Out-Null
& robocopy $vault $staging *.md /MIR /XD .trash .snapshots graphify-out /NFL /NDL /NJH /NJS /NP | Out-Null
$copyExit = $LASTEXITCODE
if ($copyExit -gt 7) {
  throw "Could not stage the Second Brain vault (robocopy exit code $copyExit)."
}

$previousGeminiKey = $env:GEMINI_API_KEY
try {
  if ($Backend -eq 'gemini' -and -not $env:GEMINI_API_KEY) {
    $envFile = Join-Path $repoRoot '.env'
    if (Test-Path -LiteralPath $envFile) {
      $keyLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*GEMINI_API_KEY\s*=' } | Select-Object -First 1
      if ($keyLine) {
        $env:GEMINI_API_KEY = (($keyLine -split '=', 2)[1]).Trim().Trim('"').Trim("'")
      }
    }
    if (-not $env:GEMINI_API_KEY) {
      throw 'GEMINI_API_KEY is required for Markdown semantic extraction. Add it to .env or set it in the shell.'
    }
  }

  if ($Backend -eq 'gemini') {
    Write-Warning 'Graphify will send the staged Markdown note text to the configured Gemini service for semantic extraction.'
  }

  & graphify extract $staging --backend $Backend --out $outputRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Graphify extraction failed with exit code $LASTEXITCODE."
  }

  if (-not (Test-Path -LiteralPath $graphPath -PathType Leaf)) {
    throw "Graphify completed without producing the expected graph: $graphPath"
  }

  Write-Host "Second Brain graph ready: $graphPath"

  if ($Serve) {
    Write-Host "Serving Graphify MCP at http://127.0.0.1:$Port/mcp"
    & python -m graphify.serve $graphPath --transport http --host 127.0.0.1 --port $Port
  }
}
finally {
  $env:GEMINI_API_KEY = $previousGeminiKey
}
