<#
.SYNOPSIS
  Guarda los tokens que usan los servidores MCP como variables de entorno de
  usuario de Windows.

.DESCRIPTION
  Los tokens NO viven en el repo. .mcp.json solo los referencia por nombre
  (${VICINO_SUPABASE_PAT}, ${VICINO_SENTRY_TOKEN}), asi que ese archivo se puede
  committear sin riesgo.

  Nada se imprime en pantalla en ningun momento: los valores se leen como
  SecureString y se descifran solo el instante necesario para escribirlos en el
  registro del usuario. Asi no quedan en el historial de PSReadLine ni en el
  scrollback de la terminal.

.NOTES
  Despues de correrlo hay que reiniciar Claude Code: las variables de entorno se
  leen al arrancar el proceso.
#>

[CmdletBinding()]
param(
    # Toma SUPABASE_ACCESS_TOKEN del .env del repo en vez de pedirlo a mano.
    [switch]$ImportSupabaseFromEnv
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Set-UserSecret {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][System.Security.SecureString]$Secure
    )

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        if ([string]::IsNullOrWhiteSpace($plain)) {
            Write-Host "  $Name -> vacio, se deja como estaba." -ForegroundColor DarkYellow
            return
        }
        [Environment]::SetEnvironmentVariable($Name, $plain, 'User')
        Write-Host "  $Name -> guardado ($($plain.Length) caracteres)." -ForegroundColor Green
    }
    finally {
        # Liberar siempre, incluso si algo revienta arriba.
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

Write-Host ''
Write-Host 'Secretos de los servidores MCP de VICINO' -ForegroundColor Cyan
Write-Host '----------------------------------------'
Write-Host 'Los valores no se muestran. Enter en blanco deja el actual sin cambios.'
Write-Host ''

# --- Supabase ---------------------------------------------------------------
if ($ImportSupabaseFromEnv) {
    $envFile = Join-Path $repoRoot '.env'
    if (-not (Test-Path $envFile)) {
        throw "No existe $envFile. Corre el script sin -ImportSupabaseFromEnv."
    }

    $line = Select-String -Path $envFile -Pattern '^SUPABASE_ACCESS_TOKEN=' -Encoding utf8 |
        Select-Object -First 1
    if (-not $line) {
        throw "SUPABASE_ACCESS_TOKEN no esta en $envFile. Corre el script sin -ImportSupabaseFromEnv."
    }

    $value = ($line.Line -replace '^SUPABASE_ACCESS_TOKEN=', '').Trim().Trim('"').Trim("'")
    Write-Host 'Supabase: importando el token existente desde .env (no se muestra).'
    Set-UserSecret -Name 'VICINO_SUPABASE_PAT' -Secure (ConvertTo-SecureString $value -AsPlainText -Force)
}
else {
    Write-Host 'Supabase Personal Access Token'
    Write-Host '  Crealo en: https://supabase.com/dashboard/account/tokens' -ForegroundColor DarkGray
    $supabase = Read-Host -Prompt '  Pega el token' -AsSecureString
    Set-UserSecret -Name 'VICINO_SUPABASE_PAT' -Secure $supabase
}

Write-Host ''

# --- Sentry -----------------------------------------------------------------
Write-Host 'Sentry User Auth Token (solo lectura)'
Write-Host '  Crealo en: https://vicino-5r.sentry.io/settings/account/api/auth-tokens/' -ForegroundColor DarkGray
Write-Host '  Scopes necesarios: org:read, project:read, event:read' -ForegroundColor DarkGray
Write-Host '  NO le des project:write ni org:write. El agente solo necesita leer.' -ForegroundColor DarkGray
$sentry = Read-Host -Prompt '  Pega el token' -AsSecureString
Set-UserSecret -Name 'VICINO_SENTRY_TOKEN' -Secure $sentry

Write-Host ''
Write-Host 'Listo. Reinicia Claude Code para que tome las variables.' -ForegroundColor Cyan
Write-Host ''
