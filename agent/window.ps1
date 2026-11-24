param([int]$Port = 8817, [switch]$TestNoFont)
# 딸깍 PC 창 — Windows 기본 창(WinForms). web/pc.html 과 같은 모양 (검정 + 짙은 빨강, Noto Serif KR, 악마).
# 프로그램과는 http://127.0.0.1:포트/pc/* 로만 이야기한다.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$base = "http://127.0.0.1:$Port"
$wc = New-Object System.Net.WebClient
$wc.Encoding = [System.Text.Encoding]::UTF8
$here = $PSScriptRoot

function C($r, $g, $b) { [System.Drawing.Color]::FromArgb($r, $g, $b) }
$BG = C 0 0 0; $WHITE = C 239 235 230; $RED = C 179 25 31; $BTN = C 71 16 15; $DIM = C 140 140 140; $LINE = C 58 54 54; $ERR = C 224 70 78
$fams = (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name
if ($TestNoFont) { $fams = $fams | Where-Object { $_ -notmatch 'Noto' } }
# Noto Serif KR 이 없는 PC: exe 에 같이 넣은 글꼴 파일을 이 창에서만 쓴다 (설치 안 함)
$script:PFC = $null
if ($fams -notcontains 'Noto Serif KR' -and (Test-Path "$here\NotoSerifKR.ttf")) { $script:PFC = New-Object System.Drawing.Text.PrivateFontCollection; $script:PFC.AddFontFile("$here\NotoSerifKR.ttf") }
$SERIF = @('Noto Serif KR Light', 'Noto Serif KR', 'Batang') | Where-Object { $fams -contains $_ } | Select-Object -First 1
$SERIF_B = @('Noto Serif KR', 'Batang') | Where-Object { $fams -contains $_ } | Select-Object -First 1
if ($script:PFC) { $SERIF = $script:PFC.Families[0]; $SERIF_B = $script:PFC.Families[0] }
$TAGF = @('Cinzel', 'Bodoni MT', 'Times New Roman') | Where-Object { $fams -contains $_ } | Select-Object -First 1
$NUMF = @('Bodoni Moda', 'Bodoni MT', 'Times New Roman') | Where-Object { $fams -contains $_ } | Select-Object -First 1
function Fnt($fam, $size) { New-Object System.Drawing.Font($fam, $size, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel) }

$W = 420; $H = 700
$form = New-Object System.Windows.Forms.Form
$form.Text = '딸깍'; $form.BackColor = $BG; $form.ForeColor = $WHITE
$form.ClientSize = New-Object System.Drawing.Size($W, $H); $form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'; $form.MaximizeBox = $false; $form.AutoScaleMode = 'None'
if (Test-Path "$here\ttalkkak.ico") { $form.Icon = New-Object System.Drawing.Icon("$here\ttalkkak.ico") }

function Lbl($text, $font, $color, $y, $h) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text; $l.Font = $font; $l.ForeColor = $color; $l.BackColor = $BG; $l.AutoSize = $false
  $l.UseCompatibleTextRendering = [bool]$script:PFC
  $l.TextAlign = 'MiddleCenter'; $l.SetBounds(0, $y, $W, $h); $form.Controls.Add($l); $l
}
# 글자 사이 띄우기 (pc.html 의 letter-spacing 흉내)
function Spaced($s, $n) { ($s.ToCharArray() -join (' ' * $n)) }

# ── 머리: 딸깍 · MATCH. CLICK. DOMINATE. · 악마 (잠금 화면에선 가운데, 연결 화면에선 위)
$logo = Lbl '딸깍' (Fnt $SERIF_B 64) $WHITE 0 84
$tag = Lbl (Spaced 'MATCH. CLICK. DOMINATE.' 1) (Fnt $TAGF 12) $RED 0 20
$devil = New-Object System.Windows.Forms.PictureBox
$devil.SizeMode = 'Zoom'; $devil.BackColor = $BG; $form.Controls.Add($devil)
if (Test-Path "$here\devil-cut.png") { $devil.Image = [System.Drawing.Image]::FromFile("$here\devil-cut.png") }

# ── 잠금 화면
$pwLabel = Lbl (Spaced '비밀번호' 1) (Fnt $SERIF 15) $DIM 0 24
$box = New-Object System.Windows.Forms.Panel; $box.BackColor = $LINE; $form.Controls.Add($box)   # 테두리 1px
$inner = New-Object System.Windows.Forms.Panel; $inner.BackColor = (C 11 9 9); $box.Controls.Add($inner)
$pw = New-Object System.Windows.Forms.TextBox
$pw.Font = Fnt 'Malgun Gothic' 22; $pw.BackColor = (C 11 9 9); $pw.ForeColor = $WHITE
$pw.BorderStyle = 'None'; $pw.TextAlign = 'Center'; $inner.Controls.Add($pw)
$pw.Add_GotFocus({ $box.BackColor = $RED }); $pw.Add_LostFocus({ $box.BackColor = $LINE })
$go = New-Object System.Windows.Forms.Button
$go.Text = Spaced '시작' 2; $go.Font = Fnt $SERIF 19; $go.ForeColor = $WHITE; $go.BackColor = $BTN
$go.FlatStyle = 'Flat'; $go.FlatAppearance.BorderSize = 0; $go.FlatAppearance.MouseOverBackColor = (C 95 22 21); $go.Cursor = 'Hand'
$go.UseCompatibleTextRendering = [bool]$script:PFC; $form.Controls.Add($go)
$err = Lbl '' (Fnt $SERIF 15) $ERR 0 24

# ── 연결 화면
$qrBox = New-Object System.Windows.Forms.Panel; $qrBox.BackColor = (C 42 38 38); $form.Controls.Add($qrBox)
$qr = New-Object System.Windows.Forms.PictureBox; $qr.SizeMode = 'Zoom'; $qr.BackColor = (C 5 4 4); $qrBox.Controls.Add($qr)
$hint = Lbl '폰 카메라로 QR · 또는 아래 PIN' (Fnt $SERIF 12) $DIM 0 20
$pinBoxes = foreach ($i in 0..5) {
  $o = New-Object System.Windows.Forms.Panel; $o.BackColor = $LINE; $form.Controls.Add($o)
  $l = New-Object System.Windows.Forms.Label; $l.BackColor = $BG; $l.ForeColor = $WHITE; $l.Font = Fnt $NUMF 30; $l.TextAlign = 'MiddleCenter'
  $o.Controls.Add($l); @{ o = $o; l = $l }
}
$url = Lbl '' (Fnt $SERIF 11) $DIM 0 18
$sep = New-Object System.Windows.Forms.Panel; $sep.BackColor = (C 29 29 29); $form.Controls.Add($sep)
$rows = foreach ($name in '롤', '폰', '중계', '기록') {
  $d = New-Object System.Windows.Forms.Panel; $d.Size = New-Object System.Drawing.Size(7, 7); $form.Controls.Add($d)
  $k = New-Object System.Windows.Forms.Label; $k.Text = $name; $k.Font = Fnt $SERIF 12; $k.ForeColor = $DIM; $k.BackColor = $BG; $k.UseCompatibleTextRendering = [bool]$script:PFC; $form.Controls.Add($k)
  $v = New-Object System.Windows.Forms.Label; $v.Font = Fnt $SERIF 12; $v.ForeColor = $WHITE; $v.BackColor = $BG; $v.TextAlign = 'MiddleRight'; $v.UseCompatibleTextRendering = [bool]$script:PFC; $form.Controls.Add($v)
  @{ d = $d; k = $k; v = $v }
}
$null = Lbl 'by  개발  정준화' (Fnt $SERIF 10) (C 61 61 61) ($H - 22) 16

$lockCtl = @($pwLabel, $box, $go, $err)
$readyCtl = @($qrBox, $hint, $url, $sep) + ($pinBoxes | ForEach-Object { $_.o }) + ($rows | ForEach-Object { $_.d; $_.k; $_.v })

function Layout($ready) {
  if (-not $ready) { # 잠금: 전체를 세로 가운데로 (pc.html main:has(#lock.on))
    $y = 150
    $logo.Top = $y; $tag.Top = $y + 92; $devil.SetBounds(($W - 44) / 2, $y + 130, 44, 44)
    $pwLabel.Top = $y + 214; $box.SetBounds(30, $y + 248, $W - 60, 58); $inner.SetBounds(1, 1, $W - 62, 56)
    $pw.SetBounds(10, 13, $W - 82, 30); $go.SetBounds(30, $y + 322, $W - 60, 58); $err.Top = $y + 392
  } else {
    $logo.Top = 30; $tag.Top = 120; $devil.SetBounds(($W - 34) / 2, 150, 34, 34)
    $qrBox.SetBounds(($W - 222) / 2, 200, 222, 222); $qr.SetBounds(1, 1, 220, 220)
    $hint.Top = 432
    $x = ($W - (6 * 40 + 5 * 7 + 10)) / 2
    for ($i = 0; $i -lt 6; $i++) {
      $p = $pinBoxes[$i]; $p.o.SetBounds($x, 462, 40, 52); $p.l.SetBounds(1, 1, 38, 50)
      $x += 47; if ($i -eq 2) { $x += 10 }
    }
    $url.Top = 524; $sep.SetBounds(30, 556, $W - 60, 1)
    for ($i = 0; $i -lt 4; $i++) {
      $r = $rows[$i]; $yy = 568 + $i * 26
      $r.d.Location = New-Object System.Drawing.Point(32, ($yy + 9)); $r.k.SetBounds(46, $yy, 80, 24); $r.v.SetBounds(130, $yy, $W - 160, 24)
    }
  }
  foreach ($c in $lockCtl) { $c.Visible = -not $ready }
  foreach ($c in $readyCtl) { $c.Visible = $ready }
}
Layout $false

$unlock = {
  $err.Text = ''
  try {
    $body = (@{ pw = $pw.Text } | ConvertTo-Json -Compress)
    $wc.Headers['Content-Type'] = 'application/json; charset=utf-8'
    $r = $wc.UploadString("$base/pc/unlock", 'POST', $body) | ConvertFrom-Json
    if (-not $r.ok) { $err.Text = $r.why; $pw.Text = ''; $pw.Focus() }
  } catch { $err.Text = '프로그램과 연결이 안 됩니다' }
}
$go.Add_Click($unlock)
$pw.Add_KeyDown({ if ($_.KeyCode -eq 'Enter') { $_.SuppressKeyPress = $true; & $unlock } })

$script:lastQr = ''; $script:ready = $false
function Dot($r, $on) { $r.d.BackColor = $(if ($on) { C 224 48 58 } else { C 95 95 95 }) }
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 800
$timer.Add_Tick({
  try { $s = $wc.DownloadString("$base/pc/state") | ConvertFrom-Json } catch { $err.Text = '프로그램이 꺼졌어요 — 창을 닫아 주세요'; return }
  $ready = [bool]$s.unlocked
  if ($ready -ne $script:ready) { $script:ready = $ready; Layout $ready }
  if (-not $ready) { return }
  if ($s.qrPng -and $s.qrPng -ne $script:lastQr) {
    $script:lastQr = $s.qrPng
    $qr.Image = [System.Drawing.Image]::FromStream((New-Object System.IO.MemoryStream(, [Convert]::FromBase64String($s.qrPng))))
  }
  for ($i = 0; $i -lt 6; $i++) { $pinBoxes[$i].l.Text = [string]$s.pin[$i] }
  $url.Text = $s.url
  $rows[0].v.Text = $(if ($s.lol) { $s.phaseLabel } else { '기다리는 중' }); Dot $rows[0] $s.lol
  $rows[1].v.Text = $(if ($s.phones) { "$($s.phones)대" } else { '없음' }); Dot $rows[1] ($s.phones -gt 0)
  $rows[2].v.Text = $(if ($s.relay) { '연결됨' } else { '연결 중...' }); Dot $rows[2] $s.relay
  $rows[3].v.Text = [string]$s.rec; Dot $rows[3] ($s.rec -notmatch '^(0줄|오류)')
})
$form.Add_Shown({ $pw.Focus(); $timer.Start() })
# 프로그램이 숨김 옵션으로 띄우면 창의 '첫 ShowWindow' 가 숨김으로 바뀐다 — 그 첫 번을 여기서 써 버린다
Add-Type -Name W -Namespace U -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);'
[void][U.W]::ShowWindow($form.Handle, 0)
[System.Windows.Forms.Application]::Run($form)
