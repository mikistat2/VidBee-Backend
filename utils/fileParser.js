// utils/fileParser.js
// Extracts plain text from PDF, DOCX, and PPTX files

import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import officeParser from 'officeparser';

// ─── Config ────────────────────────────────────────────────────────────────────

const MIN_TEXT_LENGTH = 50;

// ─── Parsers ───────────────────────────────────────────────────────────────────

async function parsePDF(filePath) {
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);

  if (!data.text || data.text.trim().length < MIN_TEXT_LENGTH) {
    throw new Error('PDF appears to be scanned or image-based — no readable text found.');
  }

  return cleanText(data.text);
}

async function parseDOCX(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });

  if (result.messages.length > 0) {
    // Non-fatal warnings (e.g. unsupported formatting) — log but continue
    console.warn('DOCX parse warnings:', result.messages);
  }

  if (!result.value || result.value.trim().length < MIN_TEXT_LENGTH) {
    throw new Error('DOCX file appears to be empty or has no readable text.');
  }

  return cleanText(result.value);
}

async function parsePPTX(filePath) {
  // officeParser supports a promise-based API
  const text = await officeParser.parseOfficeAsync(filePath);
  if (!text || text.trim().length < MIN_TEXT_LENGTH) {
    throw new Error('PPTX file appears to be empty or has no readable text.');
  }
  return cleanText(text);
}

// ─── Text Cleaner ──────────────────────────────────────────────────────────────

function cleanText(raw) {
  return raw
    .replace(/\r\n/g, '\n')          // normalize line endings
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')             // tabs → spaces
    .replace(/[ ]{2,}/g, ' ')        // collapse multiple spaces
    .replace(/\n{3,}/g, '\n\n')      // max 2 consecutive blank lines
    .trim();
}

// ─── Main Export ───────────────────────────────────────────────────────────────

const parsers = {
  pdf:  parsePDF,
  docx: parseDOCX,
  pptx: parsePPTX,
};

export async function extractTextFromFile(filePath, ext) {
  const parse = parsers[ext];

  if (!parse) {
    throw new Error(`Unsupported file type: .${ext}. Supported types: pdf, docx, pptx.`);
  }

  try {
    const text = await parse(filePath);
    return text;
  } catch (err) {
    // Re-throw with context so the controller knows which file failed
    throw new Error(`Failed to extract text from ${ext.toUpperCase()}: ${err.message}`);
  }
}