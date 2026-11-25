function cleanPdfText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?");
}
function escapePdfText(value: string): string {
  return cleanPdfText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
export function createTextPdf(lines: string[]): Buffer {
  const safeLines = lines.slice(0, 1000);
  const chunks: string[][] = [];
  for (let i = 0; i < safeLines.length; i += 54) chunks.push(safeLines.slice(i, i + 54));
  if (!chunks.length) chunks.push([]);
  const pageRefs = chunks.map((_, index) => (4 + index * 2) + " 0 R").join(" ");
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [" + pageRefs + "] /Count " + chunks.length + " >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  for (const chunk of chunks) {
    const commands = ["BT", "/F1 10 Tf", "48 790 Td", "13 TL"];
    chunk.forEach((line, index) => { if (index > 0) commands.push("T*"); commands.push("(" + escapePdfText(line.slice(0, 150)) + ") Tj"); });
    commands.push("ET");
    const stream = commands.join("\n");
    objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents " + (objects.length + 2) + " 0 R >>");
    objects.push("<< /Length " + Buffer.byteLength(stream, "ascii") + " >>\nstream\n" + stream + "\nendstream");
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf, "ascii")); pdf += (i + 1) + " 0 obj\n" + objects[i] + "\nendobj\n"; }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) pdf += String(offset).padStart(10, "0") + " 00000 n \n";
  pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF";
  return Buffer.from(pdf, "ascii");
}
