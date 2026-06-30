import { useEffect, useState } from "react";
import { BACKEND_HTTP } from "../config";

// D-04 headline lead-time comparison.
//
// DATA SOURCE: GET /api/leadtime — a one-shot DB query (MIN(first_occurred_at)
// per detector over the FULL alarm history). This is deliberately SEPARATE from
// the live WebSocket overlay in App.tsx (the chart's 120-point rolling buffer):
// lead-time spans a whole run-to-failure, which the rolling buffer cannot hold
// (RESEARCH Pitfall 5). Do NOT wire this to useSensorSocket — fetch once here.

interface LeadtimeRow {
  detector: string;
  firstOccurredAt: string;
  leadTimeSeconds: number;
}

interface LeadtimeResponse {
  device: string;
  metric: string;
  failureTime: string;
  rows: LeadtimeRow[];
}

function fmtLead(seconds: number): string {
  // A detector can first fire AFTER the failure anchor (e.g. post-shutdown RMS~0
  // breaching LCL) → negative lead-time. Render that honestly, not as garbled
  // "-1h -59m".
  if (seconds < 0) return `고장 후 +${fmtLead(-seconds)}`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function LeadtimeTable() {
  const [data, setData] = useState<LeadtimeResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    // One-shot DB-backed fetch (NOT a WS subscription).
    fetch(`${BACKEND_HTTP}/api/leadtime`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) {
    return <div style={{ color: "#a00", fontSize: 13 }}>리드타임 조회 실패</div>;
  }
  if (!data) {
    return <div style={{ color: "#888", fontSize: 13 }}>로딩 중…</div>;
  }
  if (data.rows.length === 0) {
    return (
      <div style={{ color: "#888", fontSize: 13 }}>
        알람 데이터 없음 — 파이프라인 실행(NASA replay) 후 표시됩니다.
      </div>
    );
  }

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ color: "#666", marginBottom: 6 }}>
        고장 시점(앵커): {new Date(data.failureTime).toLocaleString()} · {data.device} / {data.metric}
        <span style={{ color: "#999", marginLeft: 8 }}>(DB 쿼리 — 실시간 차트와 별개 소스)</span>
      </div>
      <div
        style={{
          color: "#92400e",
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 6,
          padding: "6px 8px",
          marginBottom: 8,
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        ⚠ 예시용(first-touch): 이 표는 detector별 <b>최초 1회 발생</b>이라 healthy 구간 오발화·단발
        노이즈 스파이크를 거르지 않는다(예: ML/SPC가 healthy 구간에서 한 번 튀면 리드타임이 부풀려짐).
        방어 가능한 헤드라인은 오프라인 <code>ml/eval/run_eval.py</code> 의 <b>K-지속 민감도 분석</b>이며,
        거기선 지속성을 요구하면 ML이 무너지고 <b>측정 전 동결한 RMS 임계가 0% FPR로 가장 방어 가능</b>하다.
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 560 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd", color: "#444" }}>
            <th style={{ padding: "6px 8px" }}>탐지기</th>
            <th style={{ padding: "6px 8px" }}>최초 발생</th>
            <th style={{ padding: "6px 8px" }}>리드타임 (고장 전)</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.detector} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "6px 8px" }}>{r.detector}</td>
              <td style={{ padding: "6px 8px", color: "#666" }}>
                {new Date(r.firstOccurredAt).toLocaleString()}
              </td>
              <td style={{ padding: "6px 8px" }}>{fmtLead(r.leadTimeSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
