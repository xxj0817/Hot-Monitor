# fixmoji.ps1 - reverse double-encoded (mojibake) Chinese text in a file.
#
# Symptom: UTF-8 Chinese was re-read as GBK and written back, so "关键词" became
# "鍏抽敭璇". Reversal: take the current text, encode it back to GBK bytes, then
# decode those bytes as UTF-8 -> original text (lossy only where the tool
# substituted "?" for undecodable bytes).
#
# Usage:
#   powershell -File tools\fixmoji.ps1 -Files server\api.js           # 修复并写回
#   powershell -File tools\fixmoji.ps1 -Files server\api.js -Dry      # 只报告，不写
# ASCII-only script: safe under any code page.

param(
  [Parameter(Mandatory=$true)][string[]]$Files,
  [switch]$Dry
)
$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$gbk = [System.Text.Encoding]::GetEncoding(936)

# characters that show up when UTF-8 CJK is decoded as GBK.
# IMPORTANT: only include characters that almost never appear in normal
# simplified Chinese text. Putting normal characters here (字/属/词/键/钮 ...)
# used to make the script "repair" healthy files and destroy them.
$mojiChars = [char[]]@(0x951B,0x9428,0x9505,0x7F10,0x69DB,0x93C8,0x6D63,0x7F09,0x6D93,0x74D2,0x942C,0x940D,0x93B5,0x6F9C,0x93C3,0x7039,0x93C4,0x8B81,0x9374)
function Get-MojiCount([string]$s) {
  $n = 0
  foreach ($c in $s.ToCharArray()) { if ($mojiChars -contains $c) { $n++ } }
  return $n
}

foreach ($f in $Files) {
  if (-not (Test-Path $f)) { Write-Host ("SKIP not-found : " + $f); continue }
  $bytes = [System.IO.File]::ReadAllBytes($f)
  $text = $utf8.GetString($bytes)
  $before = Get-MojiCount $text
  if ($before -lt 3) { Write-Host ("OK  clean      : " + $f); continue }
  $fixed = $utf8.GetString($gbk.GetBytes($text))
  $after = Get-MojiCount $fixed
  # 安全门：反转结果必须不含替换符（U+FFFD），且乱码字确实减少，否则拒绝写入
  $repl = [string][char]0xFFFD
  if ($fixed.Contains($repl) -or $after -ge $before) {
    Write-Host ("REFUSE 反转后仍异常（moji " + $before + " -> " + $after + "，含替换符），已跳过 : " + $f)
    continue
  }
  Write-Host ("FIX " + $f + " : moji " + $before + " -> " + $after)
  if (-not $Dry) {
    [System.IO.File]::WriteAllBytes($f, $utf8.GetBytes($fixed))
    Write-Host ("    written")
  } else {
    $tl = $text -split "`n"
    $fl = $fixed -split "`n"
    for ($i = 0; $i -lt [Math]::Min($tl.Length, $fl.Length); $i++) {
      if ($tl[$i] -ne $fl[$i]) { Write-Host ("    L" + ($i+1) + " NEW: " + $fl[$i].Trim()) }
    }
  }
}
Write-Host "Done."
