import { useEffect, useRef, useState } from "react";

interface RadarDisplayProps {
  isScanning: boolean;
  progress: number;
  total: number;
}

export function RadarDisplay({ isScanning, progress, total }: RadarDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const angleRef = useRef(0);
  const [dots, setDots] = useState<{ x: number; y: number; age: number; alpha: number }[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const maxR = Math.min(W, H) / 2 - 8;

    let localDots: { x: number; y: number; age: number; alpha: number }[] = [];
    let angle = angleRef.current;

    function draw() {
      ctx!.clearRect(0, 0, W, H);

      // Background circle
      ctx!.beginPath();
      ctx!.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx!.fillStyle = "rgba(0, 255, 135, 0.03)";
      ctx!.fill();

      // Concentric rings
      const ringCount = 4;
      for (let i = 1; i <= ringCount; i++) {
        ctx!.beginPath();
        ctx!.arc(cx, cy, (maxR / ringCount) * i, 0, Math.PI * 2);
        ctx!.strokeStyle = "rgba(0, 255, 135, 0.15)";
        ctx!.lineWidth = 0.8;
        ctx!.stroke();
      }

      // Cross hairs
      ctx!.strokeStyle = "rgba(0, 255, 135, 0.12)";
      ctx!.lineWidth = 0.8;
      ctx!.beginPath();
      ctx!.moveTo(cx - maxR, cy);
      ctx!.lineTo(cx + maxR, cy);
      ctx!.stroke();
      ctx!.beginPath();
      ctx!.moveTo(cx, cy - maxR);
      ctx!.lineTo(cx, cy + maxR);
      ctx!.stroke();

      // Diagonal guides
      for (let d = 0; d < 4; d++) {
        const a = (d * Math.PI) / 4;
        ctx!.beginPath();
        ctx!.moveTo(cx, cy);
        ctx!.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
        ctx!.strokeStyle = "rgba(0, 255, 135, 0.06)";
        ctx!.stroke();
      }

      if (!isScanning) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      // Sweep gradient
      angle += 0.025;
      angleRef.current = angle;

      // Manual sweep arc
      const sweepLen = Math.PI * 0.8;
      for (let i = 0; i < 60; i++) {
        const frac = i / 60;
        const a = angle - sweepLen * frac;
        const alpha = (1 - frac) * 0.35;
        ctx!.beginPath();
        ctx!.moveTo(cx, cy);
        ctx!.arc(cx, cy, maxR, a, a + 0.06);
        ctx!.fillStyle = `rgba(0, 255, 135, ${alpha})`;
        ctx!.fill();
      }

      // Sweep leading edge
      ctx!.beginPath();
      ctx!.moveTo(cx, cy);
      ctx!.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
      ctx!.strokeStyle = "rgba(0, 255, 135, 0.9)";
      ctx!.lineWidth = 1.5;
      ctx!.stroke();

      // Occasionally add blip
      if (Math.random() < 0.04) {
        const r = Math.random() * maxR * 0.85 + maxR * 0.1;
        const a = angle + (Math.random() - 0.5) * 0.3;
        localDots.push({
          x: cx + Math.cos(a) * r,
          y: cy + Math.sin(a) * r,
          age: 0,
          alpha: 1,
        });
      }

      // Draw and age blips
      localDots = localDots
        .map((d) => ({ ...d, age: d.age + 1, alpha: Math.max(0, 1 - d.age / 80) }))
        .filter((d) => d.alpha > 0);

      for (const dot of localDots) {
        ctx!.beginPath();
        ctx!.arc(dot.x, dot.y, 3, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(0, 255, 135, ${dot.alpha})`;
        ctx!.fill();
        ctx!.beginPath();
        ctx!.arc(dot.x, dot.y, 6, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(0, 255, 135, ${dot.alpha * 0.3})`;
        ctx!.fill();
      }

      // Center dot
      ctx!.beginPath();
      ctx!.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx!.fillStyle = "#00FF87";
      ctx!.fill();

      animFrameRef.current = requestAnimationFrame(draw);
    }

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isScanning]);

  return (
    <canvas
      ref={canvasRef}
      width={220}
      height={220}
      className="mx-auto"
      style={{ display: "block" }}
    />
  );
}
