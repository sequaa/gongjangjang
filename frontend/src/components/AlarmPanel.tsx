import type { Alarm, AlarmState } from "../types";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#a00",
  warning: "#c80",
  info: "#06c",
};

const STATE_COLOR: Record<AlarmState, string> = {
  created: "#a00",
  acknowledged: "#c80",
  resolved: "#0a0",
};

/**
 * Alarm panel (D-10): newest-first list with Acknowledge / Resolve actions.
 * Buttons follow the legal state machine — Acknowledge only from `created`,
 * Resolve from `created` or `acknowledged`. The actual PATCH + local sync lives
 * in the hook's {@code ackResolve}; this component only renders and dispatches.
 */
export function AlarmPanel({
  alarms,
  onAction,
}: {
  alarms: Alarm[];
  onAction: (id: number, state: AlarmState) => void;
}) {
  if (alarms.length === 0) {
    return <div style={{ color: "#888", fontSize: 13 }}>활성 알람 없음</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {alarms.map((a) => {
        const canAck = a.state === "created";
        const canResolve = a.state === "created" || a.state === "acknowledged";
        return (
          <div
            key={a.id}
            style={{
              border: "1px solid #eee",
              borderLeft: `4px solid ${SEVERITY_COLOR[a.severity] ?? "#a00"}`,
              borderRadius: 8,
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: "1 1 240px", minWidth: 200 }}>
              <div style={{ fontWeight: 600 }}>
                {a.deviceId} · {a.metric}
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>
                {a.detector} / {a.rule} · value {a.value.toFixed(2)}
              </div>
              <div style={{ fontSize: 11, color: "#999" }}>
                {new Date(a.firstOccurredAt).toLocaleString()}
              </div>
            </div>

            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: STATE_COLOR[a.state],
                textTransform: "uppercase",
              }}
            >
              {a.state}
            </span>

            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                disabled={!canAck}
                onClick={() => onAction(a.id, "acknowledged")}
                style={btnStyle(canAck)}
              >
                Acknowledge
              </button>
              <button
                type="button"
                disabled={!canResolve}
                onClick={() => onAction(a.id, "resolved")}
                style={btnStyle(canResolve)}
              >
                Resolve
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function btnStyle(enabled: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid #ccc",
    background: enabled ? "#fff" : "#f5f5f5",
    color: enabled ? "#222" : "#bbb",
    cursor: enabled ? "pointer" : "default",
  };
}
