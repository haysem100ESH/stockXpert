import * as faceapi from '@vladmandic/face-api';

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

let modelsLoaded = false;

export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  modelsLoaded = true;
}

export function areModelsLoaded(): boolean {
  return modelsLoaded;
}

/** Detect a single face and return its 128-d descriptor. Returns null when no face or >1 face detected. */
export async function detectSingleFace(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
): Promise<{ descriptor: Float32Array; landmarks: faceapi.FaceLandmarks68 } | null> {
  const detections = await faceapi
    .detectAllFaces(input, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 }))
    .withFaceLandmarks(true)
    .withFaceDescriptors();

  if (detections.length !== 1) return null;
  return { descriptor: detections[0].descriptor, landmarks: detections[0].landmarks };
}

/** Detect all faces - returns count */
export async function detectFaceCount(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
): Promise<number> {
  const detections = await faceapi.detectAllFaces(
    input,
    new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 })
  );
  return detections.length;
}

/** Euclidean distance between two face descriptors. Lower = more similar. Threshold ~0.6 is good match. */
export function faceDistance(d1: Float32Array, d2: Float32Array): number {
  return faceapi.euclideanDistance(Array.from(d1), Array.from(d2));
}

/** Convert distance to similarity percentage (0-100). Distance 0 = 100%, distance >= 1 = 0% */
export function distanceToSimilarity(distance: number): number {
  return Math.max(0, Math.min(100, (1 - distance) * 100));
}

/** Estimate head pose from face landmarks (yaw approximation) */
export function estimateHeadYaw(landmarks: faceapi.FaceLandmarks68): number {
  const nose = landmarks.getNose();
  const jaw = landmarks.getJawOutline();
  if (!nose.length || !jaw.length) return 0;

  const noseTip = nose[3]; // tip of nose
  const leftJaw = jaw[0];
  const rightJaw = jaw[jaw.length - 1];
  const faceCenter = (leftJaw.x + rightJaw.x) / 2;
  const faceWidth = rightJaw.x - leftJaw.x;

  if (faceWidth === 0) return 0;
  return ((noseTip.x - faceCenter) / faceWidth) * 2; // -1 to 1 roughly
}

export { faceapi };
