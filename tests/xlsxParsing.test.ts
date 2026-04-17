import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'

/**
 * Tests for XLSX → CSV conversion using exceljs.
 * This validates the logic used in claude.ts when processing uploaded XLSX attachments.
 */
async function xlsxBufferToSheets(buffer: Buffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheets: string[] = []
  for (const worksheet of workbook.worksheets) {
    const rows: string[] = []
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: string[] = []
      row.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.text ?? ''
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          cells.push('"' + val.replace(/"/g, '""') + '"')
        } else {
          cells.push(val)
        }
      })
      rows.push(cells.join(','))
    })
    sheets.push(`--- Sheet: ${worksheet.name} ---\n${rows.join('\n')}`)
  }
  return sheets
}

async function makeXlsxBuffer(sheets: { name: string; rows: (string | number)[][] }[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name)
    for (const row of sheet.rows) {
      ws.addRow(row)
    }
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

describe('XLSX parsing (exceljs)', () => {
  it('parses a simple single-sheet workbook to CSV', async () => {
    const buf = await makeXlsxBuffer([{
      name: 'Sheet1',
      rows: [
        ['Name', 'Age', 'City'],
        ['Alice', 30, 'New York'],
        ['Bob', 25, 'London'],
      ]
    }])
    const sheets = await xlsxBufferToSheets(buf)
    expect(sheets).toHaveLength(1)
    expect(sheets[0]).toContain('--- Sheet: Sheet1 ---')
    expect(sheets[0]).toContain('Name,Age,City')
    expect(sheets[0]).toContain('Alice,30,New York')
    expect(sheets[0]).toContain('Bob,25,London')
  })

  it('handles multiple sheets', async () => {
    const buf = await makeXlsxBuffer([
      { name: 'Patients', rows: [['ID', 'Name'], ['P001', 'Alice']] },
      { name: 'Visits', rows: [['PatientID', 'Date'], ['P001', '2024-01-15']] },
    ])
    const sheets = await xlsxBufferToSheets(buf)
    expect(sheets).toHaveLength(2)
    expect(sheets[0]).toContain('--- Sheet: Patients ---')
    expect(sheets[0]).toContain('ID,Name')
    expect(sheets[1]).toContain('--- Sheet: Visits ---')
    expect(sheets[1]).toContain('PatientID,Date')
  })

  it('CSV-escapes values containing commas', async () => {
    const buf = await makeXlsxBuffer([{
      name: 'Sheet1',
      rows: [['Description', 'Value'], ['Hello, world', '42']]
    }])
    const sheets = await xlsxBufferToSheets(buf)
    expect(sheets[0]).toContain('"Hello, world"')
  })

  it('CSV-escapes values containing double quotes', async () => {
    const buf = await makeXlsxBuffer([{
      name: 'Sheet1',
      rows: [['Note'], ['He said "hi"']]
    }])
    const sheets = await xlsxBufferToSheets(buf)
    expect(sheets[0]).toContain('"He said ""hi"""')
  })

  it('returns empty sheets array for workbook with no worksheets', async () => {
    const workbook = new ExcelJS.Workbook()
    const arrayBuffer = await workbook.xlsx.writeBuffer()
    const buf = Buffer.from(arrayBuffer)
    const sheets = await xlsxBufferToSheets(buf)
    expect(sheets).toHaveLength(0)
  })
})
