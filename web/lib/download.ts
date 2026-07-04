/**
 * Client-side download + print helpers (N8). Zero deps: a Blob + a synthetic
 * <a download> for file exports; a fresh window + print() for PDF (the browser's
 * own "Save as PDF" — the honest fidelity path documented for exports).
 */

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has grabbed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open an HTML document in a new window and trigger the print dialog. */
export function printHtml(html: string): void {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return; // popup blocked
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Give the new document a beat to lay out before printing.
  w.onload = () => {
    w.focus();
    w.print();
  };
  // Fallback if onload already fired.
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      /* window closed */
    }
  }, 400);
}

/** Filesystem-safe base name from a title. */
export function safeName(title: string): string {
  return (title.trim() || "export").replace(/[^\w.-]+/g, "_").slice(0, 80);
}
