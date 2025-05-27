import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import pdfParse from "pdf-parse";
import sharp from "sharp";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_KEY = process.env.GROQ_API_KEY ?? "";
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_SDXL_BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/stabilityai/stable-diffusion-xl-base-1.0`;

const STYLE =
  "in a consistent, soft watercolor book illustration style, with gentle pastel colors. Use the same art style for all images in this PDF.";

export const runtime = "nodejs";  
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function log(...args: unknown[]) {
  // Use this everywhere instead of console.log for clarity
  console.log("[route.ts]", ...args);
}

// --- Helper: Calculate log2 groups/chunks ---
function getChunkRanges(totalPages: number): [number, number][] {
  if (totalPages === 1) return [[0, 1]];
  const nImages = Math.max(1, Math.floor(Math.log2(totalPages)));
  const chunkSize = Math.ceil(totalPages / nImages);
  const ranges: [number, number][] = [];
  for (let i = 0; i < nImages; ++i) {
    const start = i * chunkSize;
    const end = Math.min((i + 1) * chunkSize, totalPages);
    if (start < end) ranges.push([start, end]);
  }
  return ranges;
}

async function summarizeForImage(text: string, idx: number): Promise<string> {
  // log(`Summarizing for scene ${idx + 1}:`, text.slice(0, 60), "...");
  const prompt = `
You are a visual scene generator for illustrated books.
Read the following passage and describe the most important visual scene that could be drawn as an illustration for a book. Write in 1-2 sentences, concrete and visual, no abstract or generic phrases. Directly describe the scene to be drawn, without any introductory words.

Passage:
"""${text.slice(0, 1200)}"""
`;
  const res = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: "llama3-8b-8192",
      messages: [
        { role: "system", content: "You are an assistant that writes vivid, visual illustration prompts for books." },
        { role: "user", content: prompt }
      ],
      max_tokens: 120,
      temperature: 0.5,
    }),
  });

  if (!res.ok) {
    const msg = await res.text();
    log("GROQ LLM failed:", msg);
    return "";
  }
  const data = await res.json();
  const result = data.choices?.[0]?.message?.content?.trim() ?? "";
  log(`Scene ${idx + 1} prompt:`, result);
  return result;
}

// Generate image from Cloudflare SDXL
async function generateImage(prompt: string, idx: number): Promise<Uint8Array | null> {
  log(`Requesting image ${idx + 1}: "${prompt.slice(0, 80)}..."`);
  try {
    const res = await fetch(CLOUDFLARE_SDXL_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}`,
      },
      body: JSON.stringify({ prompt }),
    });
    log(`Cloudflare SDXL status:`, res.status, res.statusText);
    log(`Cloudflare content-type:`, res.headers.get("content-type"));
    if (!res.ok) {
      const text = await res.text();
      log("Cloudflare SDXL API failed:", text);
      return null;
    }
    // Should be PNG data:
    // const buffer = await res.arrayBuffer();
    // PNG buffer from API:
    const pngBuffer = Buffer.from(await res.arrayBuffer());
    log(`Image ${idx + 1} bytes before compression:`, pngBuffer.length);
    // --- COMPRESS: PNG -> JPEG, reduce size ---
    // 1. Resize (optional): .resize(512, 512)
    // 2. Convert to JPEG with quality
    const jpegBuffer = await sharp(pngBuffer)
      // .resize(500, 500, { fit: "inside" }) // Resize if you want smaller images (optional)
      .jpeg({ quality: 65 }) // Lower quality = smaller file, try 60-75
      .toBuffer();

    log(`Image ${idx + 1} bytes after compression:`, jpegBuffer.length);

    return new Uint8Array(jpegBuffer);
    // log(`Image ${idx + 1} bytes:`, buffer.byteLength);
    // return new Uint8Array(buffer);
  } catch (e) {
    log("Cloudflare fetch error", e);
    return null;
  }
}

async function extractPageTexts(pdfBytes: Uint8Array, totalPages: number): Promise<string[]> {
  const data = await pdfParse(pdfBytes);
  if (data.text.includes("\f")) {
    const arr = data.text.split('\f').map((s: string) => s.trim());
    while (arr.length < totalPages) arr.push("");
    return arr;
  }
  const words = data.text.split(/\s+/);
  const approx = Math.ceil(words.length / totalPages);
  const pages = [];
  for (let i = 0; i < words.length; i += approx) {
    pages.push(words.slice(i, i + approx).join(" "));
  }
  while (pages.length < totalPages) pages.push("");
  return pages;
}

// let pdfParse: any;
export async function POST(req: NextRequest) {
  // if (!pdfParse) {
  //   pdfParse = (await import("pdf-parse")).default;
  // }
  const MAX_SECONDS = 50; // Be safe, under 60s
  const start = Date.now();
  const fd = await req.formData();
  const file = fd.get("file") as File | null;
  if (!file) return new Response("no file", { status: 400 });

  log("Starting PDF processing");
  const uint8 = new Uint8Array(await file.arrayBuffer());
  const originalPdf = await PDFDocument.load(uint8);
  const totalPages = originalPdf.getPageCount();
  log("PDF loaded, totalPages:", totalPages);

  const pageTexts = await extractPageTexts(uint8, totalPages);
  const allText = pageTexts.join("").trim();
  if (!allText) {
    return new Response(
      "No extractable text found in PDF.",
      { status: 422 }
    );
  }
  log("Page texts extracted, example:", pageTexts[0]?.slice(0, 60), "...");

  const outputPdf = await PDFDocument.create();

  // --- Calculate chunk ranges for log2(images) ---
  const ranges = getChunkRanges(totalPages);
  log("Chunk ranges:", ranges);

  const textSnippets: string[] = ranges.map(([start, end]) =>
    pageTexts.slice(start, end).join(" ").slice(0, 1200)
  );
  log("textSnippets count:", textSnippets.length);

  const imageInsertIndices: number[] = ranges.map(([, end]) => end - 1);

  // --- Generate prompts
  const scenePrompts: string[] = [];
  for (let i = 0; i < textSnippets.length; ++i) {
    let scene = "";
    if (textSnippets[i].trim().length === 0) {
      scene = `A detailed illustration for section ${i + 1}.`;
    } else {
      scene = await summarizeForImage(textSnippets[i], i);
    }
    scenePrompts.push(scene);
  }
  log("All prompts generated.");

  // --- Generate images
  const images: (Uint8Array | null)[] = [];
  for (let i = 0; i < scenePrompts.length; ++i) {
    const elapsedSeconds = (Date.now() - start) / 1000;
    if (elapsedSeconds > MAX_SECONDS) {
    log(`Timeout: Only generated ${i} images in ${elapsedSeconds}s, bailing out.`);
    break;
  }
    const imgPrompt = `${scenePrompts[i]}. ${STYLE}`;
    const img = await generateImage(imgPrompt, i);
    images.push(img);
    log(`Image ${i + 1} generated:`, img ? "OK" : "FAIL");
  }
  log("All images generated");

  // --- Build final PDF
  for (let i = 0; i < totalPages; ++i) {
    const [copiedPage] = await outputPdf.copyPages(originalPdf, [i]);
    outputPdf.addPage(copiedPage);
    const groupIdx = imageInsertIndices.indexOf(i);
    if (groupIdx !== -1 && images[groupIdx]) {
      try {
        const img = await outputPdf.embedJpg(images[groupIdx]!); // Use embedJpg for JPEG
        // const img = await outputPdf.embedPng(images[groupIdx]!);
        const page = outputPdf.addPage([612, 792]);
        page.drawImage(img, { x: 56, y: 150, width: 500, height: 500 });
        log(`Embedded image after page ${i + 1}`);
      } catch (err) {
        log(`Failed to embed image after page ${i + 1}:`, err);
      }
    }
  }
  const pdfBytes = await outputPdf.save();
  log("PDF built and saved, length:", pdfBytes.length);

  return new Response(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="illustrated.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
    