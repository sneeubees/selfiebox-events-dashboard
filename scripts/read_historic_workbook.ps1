param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$excel = $null
$workbook = $null

function Normalize-HeaderText {
  param(
    [string]$Value
  )

  return ([string]$Value).Trim().ToLower()
}

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $workbook = $excel.Workbooks.Open($Path, $null, $true)

  $sheet = $workbook.Worksheets.Item(1)
  $usedRange = $sheet.UsedRange
  $rowCount = $usedRange.Rows.Count
  $colCount = $usedRange.Columns.Count
  $headerRow = 3

  $headers = @()
  $seenHeaders = @{}
  for ($col = 1; $col -le $colCount; $col++) {
    $headerText = [string]$sheet.Cells.Item($headerRow, $col).Text
    $normalizedHeader = Normalize-HeaderText $headerText
    if (-not $normalizedHeader) {
      $headers += ""
      continue
    }
    if ($seenHeaders.ContainsKey($normalizedHeader)) {
      $headers += ""
      continue
    }
    $seenHeaders[$normalizedHeader] = $true
    $headers += $headerText
  }

  $rows = @()
  for ($row = $headerRow + 1; $row -le $rowCount; $row++) {
    $record = [ordered]@{
      "__rowNumber" = $row
    }
    $hasValue = $false
    for ($col = 1; $col -le $colCount; $col++) {
      $header = $headers[$col - 1]
      if (-not $header) {
        continue
      }
      $value = [string]$sheet.Cells.Item($row, $col).Text
      if ($value.Trim().Length -gt 0) {
        $hasValue = $true
      }
      $record[$header] = $value
    }
    if ($hasValue) {
      $rows += [pscustomobject]$record
    }
  }

  $result = [pscustomobject]@{
    rows = $rows
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
