# Playwright MCP Bridge 격리 Chrome 런처
#
# 사용자의 기존 Chrome 프로필을 건드리지 않고,
# 별도 user-data-dir 에 unpacked 확장을 강제 로드해 띄움.
# 차단 UI 우회: --load-extension 플래그는 Web Store 검증을 거치지 않음.

$ErrorActionPreference = "Stop"

$ext  = "C:\Users\napda\.claude\plugins\cache\playwright-ext-src\packages\extension\dist"
$data = "C:\Users\napda\.claude\mcp-chrome-profile"
# Chrome 147 stable 은 --load-extension 차단하므로 Edge 사용 (Edge 도 Chromium 기반)
$exe  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

if (-not (Test-Path "$ext\manifest.json")) {
  Write-Error "확장 빌드 결과 없음: $ext\manifest.json 가 존재해야 함. 먼저 빌드 스크립트 실행 필요."
  exit 1
}
if (-not (Test-Path $exe)) {
  Write-Error "Chrome 실행파일 없음: $exe"
  exit 1
}

New-Item -ItemType Directory -Force -Path $data | Out-Null
New-Item -ItemType Directory -Force -Path "$data\Default" | Out-Null

Write-Output "확장: $ext"
Write-Output "프로필: $data"
Write-Output "Chrome 실행: $exe"

# Chrome 147+ 사이드로드 확장 자동 비활성 우회: developer_mode 사전 ON
$prefsPath = "$data\Default\Preferences"
$nodePatch = @"
const fs=require('fs');const p=process.argv[1];let o={};try{o=JSON.parse(fs.readFileSync(p,'utf8'))}catch(e){};(o.extensions=o.extensions||{}).ui=o.extensions.ui||{};o.extensions.ui.developer_mode=true;fs.writeFileSync(p,JSON.stringify(o));console.log('developer_mode=true ->',p);
"@
& node -e $nodePatch -- $prefsPath

Start-Process -FilePath $exe -ArgumentList @(
  "--user-data-dir=$data",
  "--load-extension=$ext",
  "--remote-debugging-port=9222",
  "--disable-features=DisableLoadExtensionCommandLineSwitch,ExtensionsManifestV3Only",
  "--enable-logging",
  "--v=1",
  "--vmodule=*extension*=2,*manifest*=2",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank"
)

Write-Output "격리 Chrome 인스턴스 시작됨. 우측 상단 퍼즐 아이콘에서 Playwright Extension 활성 확인."
