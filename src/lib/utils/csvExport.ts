/**
 * moomoo証券インポート用CSV生成・ダウンロード
 */

interface CsvStock {
  symbol: string;
  name: string;
}

/** シンボル変換: "6086.T" → "6086.JP" */
function toMoomooCode(symbol: string): string {
  return symbol.replace(/\.T$/, ".JP");
}

/** moomoo形式CSV文字列を生成 (BOM付きUTF-8) */
export function generateMoomooCsv(stocks: CsvStock[]): string {
  const header = `"コード","名称","市場"`;
  const rows = stocks.map(
    (s) => `"${toMoomooCode(s.symbol)}","${s.name}","日本株"`,
  );
  return [header, ...rows].join("\n");
}

/** CSV文字列をBlobにしてブラウザダウンロード */
export function downloadCsv(csv: string, filename: string): void {
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
