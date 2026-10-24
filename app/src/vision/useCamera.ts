import { useCallback, useEffect, useRef, useState } from "react";

export type CamStatus = "idle" | "starting" | "ready" | "error";

export interface CamDevice {
  deviceId: string;
  label: string;
}

function explain(e: unknown): string {
  const err = e as DOMException;
  switch (err?.name) {
    case "NotAllowedError":
      return "摄像头权限被拒绝。请点击地址栏左侧的图标,把摄像头改为“允许”,然后重试。";
    case "NotFoundError":
      return "没有找到摄像头。请确认手机上的 Iriun 已打开并与电脑连接。";
    case "NotReadableError":
      return "摄像头被其他程序占用(例如相机应用或视频会议)。请关闭后重试。";
    case "OverconstrainedError":
      return "所选摄像头不可用,请换一个设备。";
    default:
      return `摄像头启动失败:${err?.message ?? String(e)}`;
  }
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<CamDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");

  const refreshDevices = useCallback(async () => {
    const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    const list = all.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `摄像头 ${i + 1}` }));
    setDevices(list);
    return list;
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStatus("idle");
  }, []);

  const start = useCallback(
    async (wanted?: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setError("当前环境不支持摄像头。请用 Chrome 并通过 http://localhost 打开。");
        return;
      }
      setStatus("starting");
      setError(null);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        const id = wanted ?? deviceId;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(id ? { deviceId: { exact: id } } : {}),
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play();
        }
        const list = await refreshDevices();
        const active = stream.getVideoTracks()[0]?.getSettings().deviceId;
        if (!id) {
          // Prefer the phone camera (Iriun) if present, otherwise keep whatever opened.
          const iriun = list.find((d) => /iriun/i.test(d.label));
          if (iriun && iriun.deviceId !== active) {
            setDeviceId(iriun.deviceId);
            return start(iriun.deviceId);
          }
          if (active) setDeviceId(active);
        } else {
          setDeviceId(id);
        }
        setStatus("ready");
      } catch (e) {
        setStatus("error");
        setError(explain(e));
      }
    },
    [deviceId, refreshDevices],
  );

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  return { videoRef, status, error, devices, deviceId, start, stop, setDeviceId };
}
