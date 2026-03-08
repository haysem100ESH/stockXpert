import * as ort from 'onnxruntime-web';

// Use HuggingFace CDN - model is cached by browser after first download (~30MB)
const MODEL_URL = 'https://huggingface.co/garavv/arcface-onnx/resolve/main/arc.onnx';

// Set WASM paths to CDN for onnxruntime-web
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';

let session: ort.InferenceSession | null = null;
let loading = false;

export async function loadArcFaceModel(
  onProgress?: (percent: number) => void
): Promise<void> {
  if (session) { onProgress?.(100); return; }
  if (loading) {
    while (loading) {
      await new Promise((r) => setTimeout(r, 200));
    }
    onProgress?.(100);
    return;
  }

  loading = true;
  try {
    // Fetch model with progress tracking
    const response = await fetch(MODEL_URL);
    const contentLength = Number(response.headers.get('content-length') || 0);
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (contentLength > 0) {
        onProgress?.(Math.round((received / contentLength) * 90)); // 0-90% for download
      }
    }

    const buffer = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }

    onProgress?.(95); // Loading into ONNX runtime
    session = await ort.InferenceSession.create(buffer.buffer, {
      executionProviders: ['wasm'],
    });
    onProgress?.(100);
    console.log('[ArcFace] Model loaded successfully');
  } catch (err) {
    console.error('[ArcFace] Failed to load model:', err);
    throw err;
  } finally {
    loading = false;
  }
}

export function isArcFaceLoaded(): boolean {
  return !!session;
}

/**
 * Preprocess a face crop from a video/canvas element into the format expected by ArcFace.
 * Input: source element + bounding box of the face
 * Output: Float32Array in NHWC format [1, 112, 112, 3], normalized to [-1, 1]
 */
export function preprocessFace(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
  box: { x: number; y: number; width: number; height: number }
): Float32Array {
  const canvas = document.createElement('canvas');
  canvas.width = 112;
  canvas.height = 112;
  const ctx = canvas.getContext('2d')!;

  // Add padding around the detected face box for better recognition
  const padding = 0.2;
  const padX = box.width * padding;
  const padY = box.height * padding;
  const sx = Math.max(0, box.x - padX);
  const sy = Math.max(0, box.y - padY);
  const sw = box.width + padX * 2;
  const sh = box.height + padY * 2;

  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, 112, 112);

  const imageData = ctx.getImageData(0, 0, 112, 112);
  const data = imageData.data;

  // NHWC format: [1, 112, 112, 3], normalize to [-1, 1]
  const float32 = new Float32Array(1 * 112 * 112 * 3);
  for (let i = 0; i < 112 * 112; i++) {
    float32[i * 3] = (data[i * 4] - 127.5) / 127.5;         // R
    float32[i * 3 + 1] = (data[i * 4 + 1] - 127.5) / 127.5; // G
    float32[i * 3 + 2] = (data[i * 4 + 2] - 127.5) / 127.5; // B
  }

  return float32;
}

/**
 * Extract a 512-dimensional face embedding using ArcFace.
 * The embedding is L2-normalized.
 */
export async function extractArcFaceEmbedding(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
  box: { x: number; y: number; width: number; height: number }
): Promise<Float32Array> {
  if (!session) throw new Error('ArcFace model not loaded. Call loadArcFaceModel() first.');

  const input = preprocessFace(source, box);
  const tensor = new ort.Tensor('float32', input, [1, 112, 112, 3]);

  // Dynamically get input/output names
  const inputName = session.inputNames[0];
  const feeds: Record<string, ort.Tensor> = {};
  feeds[inputName] = tensor;

  const results = await session.run(feeds);
  const outputName = session.outputNames[0];
  const embedding = results[outputName].data as Float32Array;

  // L2 normalize
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  const normalized = new Float32Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    normalized[i] = embedding[i] / (norm + 1e-10);
  }

  return normalized;
}

/**
 * Cosine similarity between two L2-normalized embeddings.
 * Returns a value between -1 and 1.  Higher = more similar.
 * For L2-normalized vectors, dot product = cosine similarity.
 */
export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

/**
 * Convert cosine similarity to a percentage score (0-100).
 * Cosine sim of 1.0 = 100%, 0.0 = 50%, -1.0 = 0%
 * For face recognition, good matches are typically > 0.3 cosine sim
 */
export function similarityToPercent(cosSim: number): number {
  // Map from [-1, 1] to [0, 100]
  return Math.max(0, Math.min(100, ((cosSim + 1) / 2) * 100));
}
