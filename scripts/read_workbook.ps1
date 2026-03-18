param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$excel = $null
$workbook = $null
$IgnoredColumnLetters = @()
$PreservedHeaders = @(
  "snappic?",
  "attendant/s",
  "package only",
  "item id (auto generated)",
  "item id",
  "update content"
)

function Normalize-HeaderText {
  param(
    [string]$Value
  )

  return ([string]$Value).Trim().ToLower()
}

function Get-ColumnLetter {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ColumnNumber
  )

  $current = $ColumnNumber
  $letter = ""
  while ($current -gt 0) {
    $remainder = ($current - 1) % 26
    $letter = [char](65 + $remainder) + $letter
    $current = [Math]::Floor(($current - 1) / 26)
  }

  return $letter
}

function Should-SkipColumn {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ColumnNumber,
    [string]$HeaderText
  )

  $letter = Get-ColumnLetter -ColumnNumber $ColumnNumber
  if (-not ($IgnoredColumnLetters -contains $letter)) {
    return $false
  }

  $normalizedHeader = Normalize-HeaderText $HeaderText
  if ($PreservedHeaders -contains $normalizedHeader) {
    return $false
  }

  return $true
}

function Get-SheetRows {
  param(
    [Parameter(Mandatory = $true)]
    $Sheet,
    [Parameter(Mandatory = $true)]
    [int]$HeaderRow
  )

  $usedRange = $Sheet.UsedRange
  $rowCount = $usedRange.Rows.Count
  $colCount = $usedRange.Columns.Count
  $headers = @()

  for ($col = 1; $col -le $colCount; $col++) {
    $headerText = [string]$Sheet.Cells.Item($HeaderRow, $col).Text
    if (Should-SkipColumn -ColumnNumber $col -HeaderText $headerText) {
      $headers += ""
      continue
    }
    $headers += $headerText
  }

  $rows = @()
  for ($row = $HeaderRow + 1; $row -le $rowCount; $row++) {
    $record = [ordered]@{}
    $hasValue = $false
    for ($col = 1; $col -le $colCount; $col++) {
      $header = $headers[$col - 1]
      if (-not $header) {
        continue
      }
      $value = [string]$Sheet.Cells.Item($row, $col).Text
      if ($value.Trim().Length -gt 0) {
        $hasValue = $true
      }
      $record[$header] = $value
    }
    if ($hasValue) {
      $rows += [pscustomobject]$record
    }
  }

  return $rows
}

function Find-HeaderRow {
  param(
    [Parameter(Mandatory = $true)]
    $Sheet,
    [Parameter(Mandatory = $true)]
    [string[]]$ExpectedHeaders,
    [int]$MaxRowsToScan = 6
  )

  $usedRange = $Sheet.UsedRange
  $rowCount = [Math]::Min($usedRange.Rows.Count, $MaxRowsToScan)
  $colCount = $usedRange.Columns.Count

  for ($row = 1; $row -le $rowCount; $row++) {
    $headers = @()
    for ($col = 1; $col -le $colCount; $col++) {
      $headerText = [string]$Sheet.Cells.Item($row, $col).Text
      if (Should-SkipColumn -ColumnNumber $col -HeaderText $headerText) {
        $headers += ""
        continue
      }
      $headers += $headerText
    }

    $matchesAll = $true
    $normalizedHeaders = $headers | ForEach-Object { Normalize-HeaderText $_ }
    foreach ($expected in $ExpectedHeaders) {
      if (-not ($normalizedHeaders -contains (Normalize-HeaderText $expected))) {
        $matchesAll = $false
        break
      }
    }

    if ($matchesAll) {
      return $row
    }
  }

  throw "Could not find expected header row."
}

function Find-FirstHeaderRow {
  param(
    [Parameter(Mandatory = $true)]
    $Sheet,
    [Parameter(Mandatory = $true)]
    [object[]]$HeaderSets
  )

  foreach ($headerSet in $HeaderSets) {
    try {
      return Find-HeaderRow -Sheet $Sheet -ExpectedHeaders $headerSet
    }
    catch {
    }
  }

  throw "Could not find expected header row."
}

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $workbook = $excel.Workbooks.Open($Path, $null, $true)

  $sheet1 = $workbook.Worksheets.Item(1)
  $sheet2 = $null
  if ($workbook.Worksheets.Count -ge 2) {
    $sheet2 = $workbook.Worksheets.Item(2)
  }

  try {
    $eventsHeaderRow = Find-FirstHeaderRow -Sheet $sheet1 -HeaderSets @(
      @("Name", "Item ID (auto generated)"),
      @("Company / Event name", "Item ID (auto generated)")
    )
  }
  catch {
    $eventsHeaderRow = 1
  }
  $updates = @()
  if ($sheet2) {
    try {
      $updatesHeaderRow = Find-HeaderRow -Sheet $sheet2 -ExpectedHeaders @("Item ID", "Update Content")
    }
    catch {
      $updatesHeaderRow = 2
    }
    $updates = Get-SheetRows -Sheet $sheet2 -HeaderRow $updatesHeaderRow
  }

  $result = [pscustomobject]@{
    events = Get-SheetRows -Sheet $sheet1 -HeaderRow $eventsHeaderRow
    updates = $updates
  }

  $result | ConvertTo-Json -Depth 6 -Compress
}
finally {
  if ($workbook) {
    $workbook.Close($false)
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null
  }
  if ($excel) {
    $excel.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  }
}
