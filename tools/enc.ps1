# enc.ps1 - auto-detect encoding switcher between UTF-8 (for Node/Vite) and GBK/ANSI (for AI edit tools)
# Usage:
#   powershell -File tools\enc.ps1 -Node -Files <path> [<path> ...]   # ensure UTF-8 before running Node/Vite
#   powershell -File tools\enc.ps1 -Tool -Files <path> [<path> ...]   # ensure GBK before editing with AI tools
# Pure ASCII file (no Chinese chars) so it has no encoding problem itself.
param(
  [Parameter(Mandatory=$true)][ValidateSet("Node","Tool")][string]$Mode,
  [Parameter(Mandatory=$true, ValueFromRemainingArguments=$true)][string[]]$Files
)
$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$gbk = [System.Text.Encoding]::GetEncoding(936)

function Test-Utf8([byte[]]$b) {
  try {
    $s = $utf8NoBom.GetString($b)
    $re = $utf8NoBom.GetBytes($s)
    if ($re.Length -ne $b.Length) { return $false }
    for ($i = 0; $i -lt $b.Length; $i++) { if ($re[$i] -ne $b[$i]) { return $false } }
    return $true
  } catch { return $false }
}

$total = 0
$skipDirs = @("node_modules","dist","build",".git",".vite",".cache","data")
$allowedExt = @(".js",".jsx",".ts",".tsx",".mjs",".cjs",".css",".html",".md",".json",".txt",".svg",".env")
$targets = New-Object System.Collections.Generic.List[string]

function Add-Target([string]$p) {
  $item = Get-Item $p
  if ($item.PSIsContainer) {
    foreach ($child in Get-ChildItem $p -Force) {
      if ($child.PSIsContainer -and $skipDirs -contains $child.Name) { continue }
      Add-Target $child.FullName
    }
  } else {
    $ext = [System.IO.Path]::GetExtension($p).ToLower()
    if ($allowedExt -contains $ext) { $targets.Add($p) }
  }
}
foreach ($f in $Files) { if (Test-Path $f) { Add-Target $f } else { Write-Host ("SKIP not-found : " + $f) } }

foreach ($f in $targets) {
  $bytes = [System.IO.File]::ReadAllBytes($f)
  $isUtf8 = Test-Utf8 $bytes
  if ($Mode -eq "Node") {
    if ($isUtf8) { Write-Host ("OK  utf8       : " + $f) }
    else {
      $text = $gbk.GetString($bytes)
      [System.IO.File]::WriteAllBytes($f, $utf8NoBom.GetBytes($text))
      Write-Host ("CONVERT ->utf8 : " + $f); $total++
    }
  } else {
    if ($isUtf8) {
      $text = $utf8NoBom.GetString($bytes)
      [System.IO.File]::WriteAllBytes($f, $gbk.GetBytes($text))
      Write-Host ("CONVERT ->gbk  : " + $f); $total++
    } else { Write-Host ("OK  gbk        : " + $f) }
  }
}
Write-Host ("Done. converted=" + $total)
