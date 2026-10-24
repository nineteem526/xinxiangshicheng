import qrcode from "qrcode-generator";
import { useEffect, useMemo, useState } from "react";
import type { LinkStatus } from "./useRemoteCamera";

interface Props {
  status: LinkStatus;
  code: string | null;
  facing: "user" | "environment" | null;
  error: string | null;
  onClose: () => void;
}

/** Candidate URLs a phone can open: every LAN address of this PC, on the page's own port. */
function phoneUrls(ips: string[], code: string | null): string[] {
  const port = location.port ? `:${location.port}` : "";
  const q = code ? `?phone&code=${code}` : "?phone";
  return ips.map((ip) => `https://${ip}${port}/${q}`);
}

function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  // The SVG is generated locally from our own string; no user input reaches it.
  return <div className="qr" role="img" aria-label="手机扫码连接" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function PairPanel({ status, code, facing, error, onClose }: Props) {
  const [ips, setIps] = useState<string[] | null>(null);
  const [pick, setPick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/link/info")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { ips?: unknown }) => alive && setIps(Array.isArray(d.ips) ? d.ips.filter((x): x is string => typeof x === "string") : []))
      .catch(() => alive && setIps([]));
    return () => {
      alive = false;
    };
  }, []);

  const urls = ips ? phoneUrls(ips, code) : [];
  const url = urls[Math.min(pick, urls.length - 1)];
  const live = status === "live";

  return (
    <aside className="pair" aria-label="手机直连">
      <div className="pair-head">
        <b>手机直连</b>
        <button onClick={onClose}>{live ? "断开" : "关闭"}</button>
      </div>

      {live ? (
        <p className="pair-live">
          <i className="dot on" /> 手机画面已接入{facing ? `(${facing === "environment" ? "后置" : "前置"}摄像头)` : ""}
        </p>
      ) : (
        <>
          <ol className="pair-steps">
            <li>手机连上和这台电脑相同的热点或 Wi-Fi</li>
            <li>用手机浏览器扫码,或打开下面的网址</li>
            <li>第一次会提示“不安全”,点“继续访问”</li>
            {!code && <li>正在向电脑申请配对码…</li>}
          </ol>
          {url ? <Qr text={url} /> : ips && <p className="pair-err">没有找到电脑的局域网地址。请先连接热点或 Wi-Fi。</p>}
          {urls.length > 1 && (
            <label className="pair-pick">
              网卡
              <select value={pick} onChange={(e) => setPick(Number(e.target.value))} aria-label="选择电脑的网络地址">
                {urls.map((u, i) => (
                  <option key={u} value={i}>
                    {ips![i]}
                    {ips![i].startsWith("192.168.137.") ? "(Windows 热点)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {url && <code className="pair-url">{url.replace(/\?.*/, "")}</code>}
          {code && (
            <div className="pair-code" aria-label={`配对码 ${code}`}>
              {code.split("").map((c, i) => (
                <span key={i}>{c}</span>
              ))}
            </div>
          )}
          <p className="pair-state" role="status">
            {status === "connecting" && "正在准备…"}
            {status === "waiting" && "等待手机连接"}
            {status === "paired" && "手机已连上,正在传画面…"}
          </p>
        </>
      )}
      {error && (
        <p className="pair-err" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
