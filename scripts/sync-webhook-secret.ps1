<#
.SYNOPSIS
  Deja el secreto del webhook de reportes igual en Vault que en Vercel.

.DESCRIPTION
  El trigger `report-notifier` ya no lleva el secreto escrito dentro (ver la
  migracion 20260826070000): ahora lo lee de Vault en cada disparo. Falta que el
  valor de Vault sea el mismo que SUPABASE_WEBHOOK_SECRET en Vercel.

  Por que hace falta hacerlo a mano: Vercel marca esa variable como sensible, asi
  que `vercel env pull` la devuelve vacia. El valor solo se puede leer desde el
  Dashboard, y solo tu puedes hacerlo.

  De donde sacarlo:
    Vercel Dashboard > tu proyecto > Settings > Environment Variables
    > SUPABASE_WEBHOOK_SECRET > el icono del ojo para revelarlo > copiar

  El valor se lee como SecureString y se descifra solo el instante necesario para
  mandarlo. No queda en el historial de PSReadLine ni en el scrollback.

.NOTES
  Comprobado el 2026-08-26: el valor que vivia dentro del trigger NO coincidia con
  el de Vercel — daba 401 contra produccion. Por eso el webhook estaba roto por dos
  causas a la vez, URL muerta y secreto desparejado, y arreglar solo una no bastaba.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot   = Split-Path -Parent $PSScriptRoot
$projectRef = 'oxxdkwywprkfghhbnoto'
$endpoint   = "https://api.supabase.com/v1/projects/$projectRef/database/query"

$tokenLine = Select-String -Path (Join-Path $repoRoot '.env') `
                           -Pattern '^SUPABASE_ACCESS_TOKEN=' -Encoding utf8 |
             Select-Object -First 1
if (-not $tokenLine) { throw "SUPABASE_ACCESS_TOKEN no esta en $repoRoot\.env" }
$token = ($tokenLine.Line -replace '^SUPABASE_ACCESS_TOKEN=', '').Trim().Trim('"').Trim("'")

function Invoke-Sql {
    param([Parameter(Mandatory)][string]$Query)
    $body = @{ query = $Query } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri $endpoint -Method Post -Body $body `
        -ContentType 'application/json' `
        -Headers @{ Authorization = "Bearer $token" }
}

Write-Host ''
Write-Host 'Sincronizar el secreto del webhook de reportes' -ForegroundColor Cyan
Write-Host '---------------------------------------------'
Write-Host 'Copialo de: Vercel > Settings > Environment Variables > SUPABASE_WEBHOOK_SECRET'
Write-Host '(usa el icono del ojo para revelarlo)' -ForegroundColor DarkGray
Write-Host ''

$secure = Read-Host -Prompt 'Pega el valor' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Valor vacio. No se cambio nada.' }

    # Comprobar contra produccion ANTES de escribirlo, para no dejar Vault con un
    # valor que tampoco sirva. Ese fue exactamente el estado que causo el problema.
    Write-Host ''
    Write-Host 'Comprobando contra produccion...' -ForegroundColor DarkGray
    $probe = @{ type = 'UPDATE'; table = 'reports'; schema = 'public'; record = $null; old_record = $null } |
             ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Uri 'https://vicinomarket.com/api/admin/report-webhook' `
            -Method Post -Body $probe -ContentType 'application/json' `
            -Headers @{ 'x-webhook-secret' = $plain } | Out-Null
        Write-Host '  El secreto es valido: produccion lo acepta.' -ForegroundColor Green
    }
    catch {
        if ($_.Exception.Response.StatusCode.value__ -eq 401) {
            throw 'Produccion responde 401: ese valor NO es el de Vercel. No se cambio nada en Vault.'
        }
        throw
    }

    $escaped = $plain -replace "'", "''"
    $sql = @"
DO `$sync`$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'webhook_secret';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret('$escaped', 'webhook_secret',
      'x-webhook-secret de /api/admin/report-webhook. Debe coincidir con SUPABASE_WEBHOOK_SECRET en Vercel.');
  ELSE
    PERFORM vault.update_secret(v_id, '$escaped', 'webhook_secret',
      'x-webhook-secret de /api/admin/report-webhook. Debe coincidir con SUPABASE_WEBHOOK_SECRET en Vercel.');
  END IF;
END `$sync`$;
"@
    Invoke-Sql -Query $sql | Out-Null
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

$check = Invoke-Sql -Query @"
SELECT name, length(decrypted_secret)::text AS largo
FROM vault.decrypted_secrets WHERE name = 'webhook_secret'
"@

Write-Host ''
Write-Host "Vault actualizado: $($check.name), $($check.largo) caracteres." -ForegroundColor Green
Write-Host 'Los avisos de reporte ya deberian llegar. Para comprobarlo de punta a punta,'
Write-Host 'crea un reporte de prueba y revisa net._http_response: debe salir 200.'
Write-Host ''
