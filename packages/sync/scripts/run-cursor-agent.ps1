#requires -Version 7.0
param(
  [Parameter(Mandatory = $true)]
  [string]$AgentScript,
  [Parameter(Mandatory = $true)]
  [string]$Workspace,
  [Parameter(Mandatory = $true)]
  [string]$PromptFile
)

$PSNativeCommandArgumentPassing = 'Standard'
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PromptFile)) {
  Write-Error "Prompt file not found: $PromptFile"
  exit 1
}
if (-not (Test-Path -LiteralPath $AgentScript)) {
  Write-Error "Agent script not found: $AgentScript"
  exit 1
}

$prompt = Get-Content -LiteralPath $PromptFile -Raw -Encoding utf8
& $AgentScript -p --force --trust --workspace $Workspace --output-format text $prompt
exit $LASTEXITCODE
