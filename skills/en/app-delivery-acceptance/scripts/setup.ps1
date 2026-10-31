param()
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$skill=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lock=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime-lock.json') -Raw -Encoding UTF8|ConvertFrom-Json
$cache=if($env:ACCEPTANCE_RUNTIME_CACHE){[IO.Path]::GetFullPath($env:ACCEPTANCE_RUNTIME_CACHE)}else{Join-Path $env:LOCALAPPDATA 'ada\runtime'}
if($cache -eq $skill -or $cache.StartsWith($skill+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Runtime cache must be outside the managed Skill'}
function Assert-NoLink([string]$Path){
  $p=$Path
  while($p){
    try{if([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint){throw 'Runtime cache cannot traverse a reparse point'}}catch [IO.FileNotFoundException]{}catch [IO.DirectoryNotFoundException]{}
    $p=[IO.Path]::GetDirectoryName($p)
  }
}
Assert-NoLink $cache
[IO.Directory]::CreateDirectory($cache)|Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Get-FileDigest([string]$Path){
  $stream=[IO.File]::OpenRead($Path);$algorithm=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$algorithm.Dispose();$stream.Dispose()}
}
function Ensure-Zip([string]$Name,[string]$Url,[string]$Digest){
  $downloads=Join-Path $cache 'downloads';[IO.Directory]::CreateDirectory($downloads)|Out-Null
  $archive=Join-Path $downloads ($Name+'.zip')
  if(!(Test-Path -LiteralPath $archive)){
    $temporary=$archive+'.'+[Guid]::NewGuid().ToString()+'.download'
    $options=@{Uri=$Url;OutFile=$temporary;UseBasicParsing=$true;TimeoutSec=180}
    if($env:HTTPS_PROXY){$options.Proxy=$env:HTTPS_PROXY}
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest @options
    if((Get-FileDigest $temporary) -ne $Digest){throw 'Runtime download checksum mismatch; retain the downloaded bytes for inspection'}
    Move-Item -LiteralPath $temporary -Destination $archive
  }
  if((Get-FileDigest $archive) -ne $Digest){throw 'Cached runtime archive checksum mismatch'}
  $tools=Join-Path $cache 'tools';[IO.Directory]::CreateDirectory($tools)|Out-Null
  $target=Join-Path $tools $Name
  if(!(Test-Path -LiteralPath $target)){
    $claim=$target+'.lock'
    $token=[Guid]::NewGuid().ToString()
    try{$handle=[IO.File]::Open($claim,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)}catch{throw 'Runtime preparation has an existing or unknown owner; preserve its files'}
    try{$bytes=[Text.Encoding]::UTF8.GetBytes($token);$handle.Write($bytes,0,$bytes.Length);$handle.Flush($true)}finally{$handle.Dispose()}
    $stage=$target+'.'+$token+'.stage'
    try{
      [IO.Directory]::CreateDirectory($stage)|Out-Null
      [IO.Compression.ZipFile]::ExtractToDirectory($archive,$stage)
      Move-Item -LiteralPath $stage -Destination $target
    }finally{
      if((Get-Content -LiteralPath $claim -Raw) -ne $token){throw 'Runtime preparation ownership changed'}
      Remove-Item -LiteralPath $claim
    }
  }
  Assert-NoLink $target
  $zip=[IO.Compression.ZipFile]::OpenRead($archive)
  try{
    $expected=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach($entry in $zip.Entries){
      if(!$entry.Name){continue}
      $name=$entry.FullName.Replace('/',[IO.Path]::DirectorySeparatorChar)
      $file=[IO.Path]::GetFullPath((Join-Path $target $name))
      if(!$file.StartsWith($target+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Runtime archive escapes its root'}
      Assert-NoLink $file
      $stream=$entry.Open();$algorithm=[Security.Cryptography.SHA256]::Create()
      try{$entryHash=([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$algorithm.Dispose();$stream.Dispose()}
      if(!(Test-Path -LiteralPath $file) -or (Get-FileDigest $file) -ne $entryHash){throw 'Extracted runtime file differs from its verified archive'}
      $expected.Add($file)|Out-Null
    }
    foreach($file in Get-ChildItem -LiteralPath $target -Recurse -Force -File){if(!$expected.Contains($file.FullName)){throw 'Unexpected file in runtime cache; preserve for inspection'}}
  }finally{$zip.Dispose()}
  return $target
}
function Find-SpexGit(){
  # A Skill exported by SPEX normally has an installed SPEX Git available.
  # Read standard uninstall metadata; never write registry or system PATH.
  $keys=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
  foreach($key in $keys){
    foreach($app in @(Get-ItemProperty $key -ErrorAction SilentlyContinue|Where-Object {$_.DisplayName -match '^Spex(?:\s|$)'})){
      $icon=([string]$app.DisplayIcon -replace ',\s*-?\d+$','').Trim('"')
      $appRoot=if($app.InstallLocation){[string]$app.InstallLocation}elseif($icon){Split-Path -Parent $icon}else{$null}
      if(!$appRoot){continue}
      $candidate=Join-Path $appRoot 'resources\app.asar.unpacked\node_modules\dugite\git\cmd\git.exe'
      if(Test-Path -LiteralPath $candidate){Assert-NoLink $candidate;$version=& $candidate --version;if($LASTEXITCODE -eq 0 -and $version -match '^git version '){return $candidate}}
    }
  }
  return $null
}
$architecture=if([Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -eq 'Arm64'){'arm64'}else{'x64'}
$key='win32-'+$architecture
$node=$null;$existing=Get-Command node.exe -ErrorAction SilentlyContinue
if($existing -and !$env:ACCEPTANCE_BOOTSTRAP_FORCE_NODE){
  $candidate=$existing.Source
  $major=& $candidate -p 'parseInt(process.versions.node)'
  if($LASTEXITCODE -eq 0 -and [int]$major -ge 22 -and (Test-Path (Join-Path (Split-Path $candidate) 'node_modules\npm\bin\npm-cli.js'))){$node=$candidate}
}
if(!$node){$resource=$lock.node_archives.$key;if(!$resource){throw 'No pinned runtime for this Windows architecture'};$name=$resource.file.Replace('.zip','');$folder=Ensure-Zip $name ($lock.node_base_url+$resource.file) $resource.sha256;$node=Join-Path $folder ($name+'\node.exe')}
$prefix=@((Split-Path $node))
if(!(Get-Command git.exe -ErrorAction SilentlyContinue)){
  $available=Find-SpexGit
  if($available){$prefix+=(Split-Path $available)}else{$resource=$lock.git_archives.$key;$folder=Ensure-Zip ($resource.file.Replace('.zip','')) $resource.url $resource.sha256;$prefix+=(Join-Path $folder 'cmd')}
}
$env:PATH=($prefix -join [IO.Path]::PathSeparator)+[IO.Path]::PathSeparator+$env:PATH
$env:ACCEPTANCE_RUNTIME_PATH_PREFIX=$prefix -join [IO.Path]::PathSeparator
& $node (Join-Path $PSScriptRoot 'setup.mjs')
if($LASTEXITCODE -ne 0){throw 'Skill dependency preparation failed; retain its original output'}
