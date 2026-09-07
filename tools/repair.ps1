# repair.ps1 - reverse UTF8-read-as-GBK mojibake. Pure ASCII script.
# Detection: text T is mojibake-reversible iff UTF8(GBK(T)) decodes with NO U+FFFD.
# (For clean Chinese text, GBK bytes are not valid UTF-8 and produce U+FFFD.)
# usage: powershell -File tools\repair.ps1 <path> [<path> ...]
param(
  [Parameter(Mandatory=$true, ValueFromRemainingArguments=$true)][string[]]$Files
)
$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$gbk  = [System.Text.Encoding]::GetEncoding(936)
$repl = [string][char]0xFFFD

function Reverse-Candidate([string]$text) {
  $bytes = $gbk.GetBytes($text)
  return $utf8.GetString($bytes)
}

foreach ($f in $Files) {
  if (-not (Test-Path $f)) { Write-Host "SKIP not-found : $f"; continue }
  if ((Get-Item $f).PSIsContainer) { Write-Host "SKIP is-dir     : $f"; continue }
  $text = [System.IO.File]::ReadAllText($f, $utf8)
  $cand = Reverse-Candidate $text
  if ($cand.IndexOf($repl) -ge 0) { Write-Host "OK   clean     : $f"; continue }
  if ($cand -eq $text) { Write-Host "OK   ascii      : $f"; continue }
  [System.IO.File]::WriteAllText($f, $cand, $utf8)
  Write-Host "REPAIR->        : $f"
}
Write-Host "Done"
