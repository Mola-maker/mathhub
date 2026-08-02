param(
  [Parameter(Mandatory = $true)]
  [string]$TectonicPath,

  [string]$DvisvgmPath = "dvisvgm",

  [string[]]$FixturePaths = @(),

  [switch]$OnlyCached,

  [switch]$IncludeLogs
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$resolvedTectonic = (Resolve-Path -LiteralPath $TectonicPath).Path
$runId = [Guid]::NewGuid().ToString("N")
$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) "math-geohub-tikz-compiler-$runId"
New-Item -ItemType Directory -Path $workRoot | Out-Null

$tikzLibraries = "arrows.meta,calc,intersections,through,angles,quotes,patterns,positioning"
$results = @()

if ($FixturePaths.Count -eq 0) {
  $fixtureRoot = Join-Path $repoRoot "lib/tikz/__fixtures__"
  $FixturePaths = Get-ChildItem -LiteralPath $fixtureRoot -Recurse -File -Filter "*.tikz" |
    ForEach-Object {
      $_.FullName.Substring($repoRoot.Length).TrimStart([char[]]"\/")
    }
}

foreach ($relativeFixture in $FixturePaths) {
  $fixturePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $relativeFixture))
  if (-not (Test-Path -LiteralPath $fixturePath)) {
    throw "Fixture does not exist: $fixturePath"
  }

  $caseName = ($relativeFixture -replace '^[.\\/]+', '' -replace '[^A-Za-z0-9._-]', '_')
  $caseRoot = Join-Path $workRoot $caseName
  New-Item -ItemType Directory -Path $caseRoot | Out-Null

  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $fixturePath
  $document = @"
\documentclass[border=2pt]{standalone}
\def\pgfsysdriver{pgfsys-dvisvgm.def}
\usepackage{tikz}
\usepackage{amsmath}
\usetikzlibrary{$tikzLibraries}
\begin{document}
$source
\end{document}
"@
  $inputPath = Join-Path $caseRoot "input.tex"
  Set-Content -Encoding UTF8 -NoNewline -LiteralPath $inputPath -Value $document

  $tectonicArgs = @(
    "-X", "compile",
    $inputPath,
    "--outdir", $caseRoot,
    "--outfmt", "xdv",
    "--untrusted"
  )
  if ($OnlyCached) {
    $tectonicArgs += "--only-cached"
  }

  $compileWatch = [System.Diagnostics.Stopwatch]::StartNew()
  $previousErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $compileOutput = & $resolvedTectonic @tectonicArgs 2>&1 | Out-String
  $compileExit = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorPreference
  $compileWatch.Stop()

  $xdvPath = Join-Path $caseRoot "input.xdv"
  $svgPath = Join-Path $caseRoot "output.svg"
  $convertExit = -1
  $convertMs = 0
  $convertOutput = ""

  if ($compileExit -eq 0 -and (Test-Path -LiteralPath $xdvPath)) {
    $convertWatch = [System.Diagnostics.Stopwatch]::StartNew()
    $previousErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    Push-Location -LiteralPath $caseRoot
    try {
      $convertOutput = & $DvisvgmPath "--no-mktexmf" "--page=1" "--output=output.svg" "input.xdv" 2>&1 | Out-String
      $convertExit = $LASTEXITCODE
    } finally {
      Pop-Location
    }
    $ErrorActionPreference = $previousErrorPreference
    $convertWatch.Stop()
    $convertMs = $convertWatch.ElapsedMilliseconds
  }

  $svgExists = Test-Path -LiteralPath $svgPath
  $svgBytes = if ($svgExists) { (Get-Item -LiteralPath $svgPath).Length } else { 0 }
  $svgContent = if ($svgExists) { Get-Content -Raw -Encoding UTF8 -LiteralPath $svgPath } else { "" }
  $hasGraphicElement = $svgContent -match '<(?:path|circle|line|polyline|polygon|rect|text|use)\b'
  $success = ($compileExit -eq 0 -and $convertExit -eq 0 -and $svgExists -and $hasGraphicElement)
  $results += [PSCustomObject]@{
    fixture = $relativeFixture
    compileExit = $compileExit
    compileMs = $compileWatch.ElapsedMilliseconds
    convertExit = $convertExit
    convertMs = $convertMs
    totalMs = $compileWatch.ElapsedMilliseconds + $convertMs
    svgBytes = $svgBytes
    hasGraphicElement = $hasGraphicElement
    success = $success
    compileLog = if ($IncludeLogs -or -not $success) { $compileOutput.Trim() } else { "" }
    convertLog = if ($IncludeLogs -or -not $success) { $convertOutput.Trim() } else { "" }
  }
}

$sortedCompileMs = @($results | ForEach-Object compileMs | Sort-Object)
$sortedConvertMs = @($results | ForEach-Object convertMs | Sort-Object)
$sortedTotalMs = @($results | ForEach-Object totalMs | Sort-Object)
$p95Index = [Math]::Max(0, [Math]::Ceiling($results.Count * 0.95) - 1)

[PSCustomObject]@{
  tectonicVersion = (& $resolvedTectonic "--version" 2>&1 | Out-String).Trim()
  dvisvgmVersion = (& $DvisvgmPath "--version" 2>&1 | Select-Object -First 1 | Out-String).Trim()
  onlyCached = [bool]$OnlyCached
  workRoot = $workRoot
  summary = [PSCustomObject]@{
    total = $results.Count
    succeeded = @($results | Where-Object success).Count
    failed = @($results | Where-Object { -not $_.success }).Count
    compileAverageMs = [Math]::Round(($results | Measure-Object compileMs -Average).Average, 1)
    compileP95Ms = $sortedCompileMs[$p95Index]
    convertAverageMs = [Math]::Round(($results | Measure-Object convertMs -Average).Average, 1)
    convertP95Ms = $sortedConvertMs[$p95Index]
    totalAverageMs = [Math]::Round(($results | Measure-Object totalMs -Average).Average, 1)
    totalP95Ms = $sortedTotalMs[$p95Index]
  }
  results = $results
} | ConvertTo-Json -Depth 6
