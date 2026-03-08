import { useState, useRef, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Camera, CheckCircle2, Loader2, ShieldAlert, RotateCcw, Eye } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import {
  loadFaceModels,
  detectSingleFace,
  detectFaceCount,
  faceDistance,
  distanceToSimilarity,
  estimateHeadYaw,
} from '@/lib/faceApi';
import CameraCapture from './CameraCapture';

interface PoseChallenge {
  instruction: string;
  check: (yaw: number) => boolean;
}

const POSE_CHALLENGES: PoseChallenge[] = [
  { instruction: 'Turn your head slightly to the LEFT', check: (yaw: number) => yaw < -0.15 },
  { instruction: 'Turn your head slightly to the RIGHT', check: (yaw: number) => yaw > 0.15 },
  { instruction: 'Look straight at the camera', check: (yaw: number) => Math.abs(yaw) < 0.12 },
];

const SIMILARITY_THRESHOLD = 55; // distance-to-similarity %. ~0.45 distance = 55%
const MAX_ATTEMPTS = 3;

interface FaceVerificationProps {
  staffId: string;
  onVerified: (score: number, photoBlob: Blob) => void;
  onFailed: (reason: string) => void;
  onCancel: () => void;
}

export default function FaceVerification({ staffId, onVerified, onFailed, onCancel }: FaceVerificationProps) {
  const [phase, setPhase] = useState<'loading' | 'liveness' | 'verifying' | 'result'>('loading');
  const [feedback, setFeedback] = useState('');
  const [challenge, setChallenge] = useState(POSE_CHALLENGES[0]);
  const [livenessPassed, setLivenessPassed] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [resultScore, setResultScore] = useState<number | null>(null);
  const [resultSuccess, setResultSuccess] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const storedEmbeddings = useRef<number[][]>([]);
  const { toast } = useToast();

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    setPhase('loading');
    setFeedback('Loading face recognition models...');
    try {
      await loadFaceModels();

      // Fetch stored face embeddings
      const { data, error } = await supabase
        .from('staff_face_data')
        .select('embeddings')
        .eq('staff_id', staffId)
        .maybeSingle();

      if (error) throw error;
      if (!data?.embeddings) {
        onFailed('No face data registered. Please ask your admin to register your face first.');
        return;
      }

      storedEmbeddings.current = data.embeddings;

      // Pick a random challenge
      const idx = Math.floor(Math.random() * POSE_CHALLENGES.length);
      setChallenge(POSE_CHALLENGES[idx]);
      setPhase('liveness');
      setFeedback(POSE_CHALLENGES[idx].instruction);
    } catch (err: any) {
      onFailed(err.message || 'Failed to initialize face verification');
    }
  };

  const handleFrame = useCallback(
    async (video: HTMLVideoElement) => {
      if (phase !== 'liveness' || livenessPassed) return;

      // Check for multiple faces
      const count = await detectFaceCount(video);
      if (count > 1) {
        setFeedback('⚠️ Multiple faces detected! Only your face should be visible.');
        return;
      }
      if (count === 0) {
        setFeedback('No face detected. Position your face in the frame.');
        return;
      }

      // Check pose
      const result = await detectSingleFace(video);
      if (!result) return;

      const yaw = estimateHeadYaw(result.landmarks);
      if (challenge.check(yaw)) {
        setLivenessPassed(true);
        setFeedback('✅ Liveness check passed! Now click "Verify Face" to continue.');
      } else {
        setFeedback(challenge.instruction);
      }
    },
    [phase, livenessPassed, challenge]
  );

  const handleVerify = async (_blob: Blob, video: HTMLVideoElement) => {
    setPhase('verifying');
    setFeedback('Verifying face...');

    // Check multiple faces
    const count = await detectFaceCount(video);
    if (count > 1) {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= MAX_ATTEMPTS) {
        onFailed('Multiple faces detected repeatedly. Verification rejected.');
        return;
      }
      setPhase('liveness');
      setFeedback('Multiple faces detected. Only your face should be visible. Try again.');
      return;
    }

    const result = await detectSingleFace(video);
    if (!result) {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= MAX_ATTEMPTS) {
        onFailed('Could not detect face after multiple attempts.');
        return;
      }
      setPhase('liveness');
      setFeedback('Face not detected clearly. Try again.');
      return;
    }

    // Compare with stored embeddings - find best match
    let bestSimilarity = 0;
    for (const stored of storedEmbeddings.current) {
      const storedArr = new Float32Array(stored);
      const dist = faceDistance(result.descriptor, storedArr);
      const sim = distanceToSimilarity(dist);
      if (sim > bestSimilarity) bestSimilarity = sim;
    }

    setResultScore(Math.round(bestSimilarity));

    if (bestSimilarity >= SIMILARITY_THRESHOLD) {
      setResultSuccess(true);
      setPhase('result');
      setFeedback('Face verified successfully!');

      // Create photo blob from video
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (blob) onVerified(Math.round(bestSimilarity), blob);
        },
        'image/jpeg',
        0.8
      );
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= MAX_ATTEMPTS) {
        setResultSuccess(false);
        setPhase('result');
        onFailed(`Face verification failed after ${MAX_ATTEMPTS} attempts. Score: ${Math.round(bestSimilarity)}%`);
      } else {
        setPhase('liveness');
        setLivenessPassed(false);
        const idx = Math.floor(Math.random() * POSE_CHALLENGES.length);
        setChallenge(POSE_CHALLENGES[idx]);
        setFeedback(`Face mismatch (${Math.round(bestSimilarity)}%). ${POSE_CHALLENGES[idx].instruction}`);
      }
    }
  };

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" />
          Face Verification
          {attempts > 0 && (
            <Badge variant="secondary" className="ml-auto">
              Attempt {attempts + 1}/{MAX_ATTEMPTS}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {phase === 'loading' && (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>{feedback}</span>
          </div>
        )}

        {(phase === 'liveness' || phase === 'verifying') && (
          <div className="space-y-4">
            <CameraCapture
              videoRef={videoRef}
              onFrame={phase === 'liveness' ? handleFrame : undefined}
              frameInterval={600}
              showCaptureButton={livenessPassed}
              onCapture={handleVerify}
            />

            <div className="flex items-center gap-2 justify-center">
              {livenessPassed ? (
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Liveness Passed
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <Eye className="h-3 w-3" />
                  Liveness Check
                </Badge>
              )}
            </div>

            <p className="text-sm text-center text-muted-foreground">{feedback}</p>

            {phase === 'verifying' && (
              <div className="flex justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            )}
          </div>
        )}

        {phase === 'result' && (
          <div className="text-center py-4">
            {resultSuccess ? (
              <>
                <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-2" />
                <p className="font-medium">Verified — {resultScore}% match</p>
              </>
            ) : (
              <>
                <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-2" />
                <p className="font-medium">Verification Failed</p>
                <p className="text-sm text-muted-foreground">Score: {resultScore}%</p>
              </>
            )}
          </div>
        )}

        <div className="flex gap-2 justify-center">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
