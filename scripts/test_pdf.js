const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const htmlFile = path.resolve(__dirname, 'test_pdf.html');
const pdfFile = path.resolve(__dirname, 'test_pdf.pdf');

fs.writeFileSync(htmlFile, '<!DOCTYPE html><html><body><h1>VLive Test PDF</h1></body></html>');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const fileUrl = 'file:///' + htmlFile.replace(/\\/g, '/');
execSync(`"${chromePath}" --headless --disable-gpu --run-all-compositor-stages-before-draw --print-to-pdf="${pdfFile}" --no-pdf-header-footer "${fileUrl}"`);

console.log('Generated test_pdf.pdf:', fs.existsSync(pdfFile), fs.statSync(pdfFile).size, 'bytes');

if (fs.existsSync(htmlFile)) fs.unlinkSync(htmlFile);
if (fs.existsSync(pdfFile)) fs.unlinkSync(pdfFile);
