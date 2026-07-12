/**
 * Office document conversion via a headless LibreOffice install.
 * Lets the Presentation viewer open .pptx/.ppt/.odp directly:
 *   - PDF   → static pages for the pdf.js pipeline (thumbnails + fallback)
 *   - SVG   → LibreOffice's animated export, embedding its presentation engine,
 *             so slide transitions and element animations play like PowerPoint.
 * No bundled binary — uses a LibreOffice the user already has installed.
 */

const fs = require('fs');
const path = require('path');
const { execFile, execSync } = require('child_process');
const { pathToFileURL } = require('url');

/** Locate the LibreOffice `soffice` binary, or return null if not installed. */
function findSoffice() {
  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  } else if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\LibreOffice\\program\\soffice.exe');
    candidates.push('C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe');
  } else {
    candidates.push('/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice');
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Fall back to a PATH lookup (`which` / `where`).
  const finder = process.platform === 'win32' ? 'where' : 'which';
  for (const name of ['soffice', 'libreoffice']) {
    try {
      const out = execSync(`${finder} ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim().split(/\r?\n/)[0];
      if (out && fs.existsSync(out)) return out;
    } catch (_) { /* not on PATH */ }
  }
  return null;
}

/**
 * Convert an office file to `format` ('pdf' or 'svg') in `outDir`.
 * Resolves to the output path. Rejects if LibreOffice isn't installed or the
 * conversion fails.
 */
function convertTo(file, outDir, format) {
  return new Promise((resolve, reject) => {
    const soffice = findSoffice();
    if (!soffice) return reject(new Error('LibreOffice not found'));

    fs.mkdirSync(outDir, { recursive: true });
    // Use a private profile dir so we don't clash with a running LibreOffice GUI.
    const profile = pathToFileURL(path.join(outDir, '.lo-profile')).href;
    const args = [
      '--headless', '--norestore',
      `-env:UserInstallation=${profile}`,
      '--convert-to', format, '--outdir', outDir, file,
    ];

    execFile(soffice, args, { timeout: 180000 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      const out = path.join(outDir, path.basename(file, path.extname(file)) + '.' + format);
      if (fs.existsSync(out)) resolve(out);
      else reject(new Error(`Conversion produced no ${format.toUpperCase()}. ` + (stderr || stdout || '').toString().trim()));
    });
  });
}

const convertToPdf = (file, outDir) => convertTo(file, outDir, 'pdf');
// Impress SVG export: one SVG with every slide + the JS presentation engine.
const convertToSvg = (file, outDir) => convertTo(file, outDir, 'svg');

module.exports = { findSoffice, convertToPdf, convertToSvg };
