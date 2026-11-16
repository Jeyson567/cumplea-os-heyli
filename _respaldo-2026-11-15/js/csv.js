function csvSafe(value) {
  const text = String(value ?? '')
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

export function csvCell(value) {
  const text = csvSafe(value).replace(/\r?\n/g, ' ')
  if (/[";]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv(rows) {
  const lines = rows.map((row) => row.map(csvCell).join(';'))
  return `\uFEFFsep=;\r\n${lines.join('\r\n')}\r\n`
}
