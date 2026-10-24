# Downloads MediaPipe runtime + gesture model into local folders so the page works offline.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$ver = "0.10.14"
New-Item -ItemType Directory -Force "$root\vendor\wasm", "$root\models" | Out-Null

$cdns = @(
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@$ver",
  "https://unpkg.com/@mediapipe/tasks-vision@$ver",
  "https://registry.npmmirror.com/@mediapipe/tasks-vision/$ver/files"
)

function Get-First($relPath, $out) {
  foreach ($b in $cdns) {
    try {
      Write-Host "GET $b/$relPath"
      Invoke-WebRequest "$b/$relPath" -OutFile $out -UseBasicParsing -TimeoutSec 120
      if ((Get-Item $out).Length -gt 1000) { return }
    } catch { Write-Host "  failed: $($_.Exception.Message)" }
  }
  throw "All mirrors failed for $relPath"
}

Get-First "vision_bundle.mjs" "$root\vendor\vision_bundle.mjs"
foreach ($f in "vision_wasm_internal.js","vision_wasm_internal.wasm","vision_wasm_nosimd_internal.js","vision_wasm_nosimd_internal.wasm") {
  Get-First "wasm/$f" "$root\vendor\wasm\$f"
}

$model = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"
Write-Host "GET $model"
Invoke-WebRequest $model -OutFile "$root\models\gesture_recognizer.task" -UseBasicParsing -TimeoutSec 300

Write-Host "`nDone. Run serve.bat next." -ForegroundColor Green
