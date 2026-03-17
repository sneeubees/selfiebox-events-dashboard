param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$excel = $null
$workbook = $null

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
    $headers += [string]$Sheet.Cells.Item($HeaderRow, $col).Text
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
      $headers += [string]$Sheet.Cells.Item($row, $col).Text
    }

    $matchesAll = $true
    foreach ($expected in $ExpectedHeaders) {
      if (-not ($headers -contains $expected)) {
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

  $eventsHeaderRow = Find-HeaderRow -Sheet $sheet1 -ExpectedHeaders @("Name", "Item ID (auto generated)")
  $updates = @()
  if ($sheet2) {
    $updatesHeaderRow = Find-HeaderRow -Sheet $sheet2 -ExpectedHeaders @("Item ID", "Update Content")
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
