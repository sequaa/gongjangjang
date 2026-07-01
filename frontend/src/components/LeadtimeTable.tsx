// D-05: offline frozen K-consecutive lead-time numbers from run_eval.
// Verbatim values from demo/leadtime.json — no recalculation, no backend fetch.
import leadtime from "../demo/leadtime.json";

const DETECTORS = ["spc", "threshold", "ml"] as const;
const K_VALUES = ["1", "3", "5"] as const;

export function LeadtimeTable() {
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ color: "#666", marginBottom: 6 }}>
        오프라인 run_eval K-지속 분석(방어 가능한 동결 수치)
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 640 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd", color: "#444" }}>
            <th style={{ padding: "6px 8px" }}>탐지기</th>
            <th style={{ padding: "6px 8px" }}>K=1 리드타임(h)</th>
            <th style={{ padding: "6px 8px" }}>K=3 리드타임(h)</th>
            <th style={{ padding: "6px 8px" }}>K=5 리드타임(h)</th>
          </tr>
        </thead>
        <tbody>
          {DETECTORS.map((det) => (
            <tr key={det} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "6px 8px" }}>{det}</td>
              {K_VALUES.map((k) => (
                <td key={k} style={{ padding: "6px 8px" }}>
                  {leadtime.detectors[det].k_consecutive_lead_time[k].lead_time_hours}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8, color: "#555", fontSize: 12 }}>
        {leadtime.primary_finding}
      </div>
    </div>
  );
}
