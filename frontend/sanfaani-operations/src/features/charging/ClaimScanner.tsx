import { useEffect, useRef, useState } from 'react';

type Detector = { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

export default function ClaimScanner({ onScan }: { onScan: (token: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState('Starting camera…');
  useEffect(() => {
    let stream: MediaStream | undefined;
    let frame = 0;
    let stopped = false;
    const DetectorApi = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    if (!DetectorApi || !navigator.mediaDevices?.getUserMedia) {
      setMessage('Camera scanning is unsupported in this browser. Enter the Claim ID manually.');
      return;
    }
    const detector = new DetectorApi({ formats: ['qr_code'] });
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then((camera) => {
      stream = camera;
      if (!video.current) return;
      video.current.srcObject = camera;
      setMessage('Point the camera at the SANFAANI claim QR.');
      const scan = async () => {
        if (stopped || !video.current) return;
        try {
          const [result] = await detector.detect(video.current);
          if (result?.rawValue) {
            const token = result.rawValue.replace(/^sanfaani:\/\/claim\//, '');
            onScan(token);
            return;
          }
        } catch { /* A frame may not be ready yet. */ }
        frame = requestAnimationFrame(() => void scan());
      };
      void video.current.play().then(scan);
    }).catch(() => setMessage('Camera permission was not granted. Enter the Claim ID manually.'));
    return () => { stopped = true; cancelAnimationFrame(frame); stream?.getTracks().forEach((track) => track.stop()); };
  }, [onScan]);
  return <div><video ref={video} playsInline muted className="aspect-square w-full rounded-md bg-black object-cover" /><p className="mt-3 text-sm text-muted-foreground">{message}</p></div>;
}
