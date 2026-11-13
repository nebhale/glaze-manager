import { Link } from "react-router-dom";
import { useApi, type KilnfireStatus } from "./api";

export function ConnectionStatus({
  studioConnected,
}: {
  studioConnected: boolean;
}) {
  const kilnfire = useApi<KilnfireStatus>("/kilnfire");
  const connected = kilnfire.data?.state === "connected";
  const needsLogin = kilnfire.data?.state === "needs_login";
  const studioLabel = studioConnected
    ? "Studio connected"
    : "Studio reconnecting";
  const kilnfireLabel = connected
    ? "Kilnfire connected"
    : needsLogin
      ? "Kilnfire sign-in required"
      : kilnfire.isError
        ? "Kilnfire connection status unavailable"
        : kilnfire.isPending
          ? "Checking Kilnfire connection"
          : "Kilnfire not connected";
  const kilnfireState = connected
    ? "connected"
    : needsLogin || kilnfire.isError
      ? "attention"
      : "disconnected";

  return (
    <div
      className="connection-status-view"
      role="group"
      aria-label="Connection status"
    >
      <span
        className={`connection-status-entry ${studioConnected ? "connected" : "attention"}`}
        role="status"
        aria-label={studioLabel}
        title={studioLabel}
      >
        <i aria-hidden="true" />
        Studio
      </span>
      <Link
        className={`connection-status-entry ${kilnfireState}`}
        to="/settings#kilnfire"
        aria-label={kilnfireLabel}
        title={kilnfireLabel}
      >
        <i aria-hidden="true" />
        Kilnfire
      </Link>
    </div>
  );
}
