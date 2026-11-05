import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Archive, ArrowLeft, RotateCcw, Scale, Trash2, X } from "lucide-react";
import { ApiError, date, grams, useApi, type Jar } from "../api";
import {
  ErrorMessage,
  Field,
  Loading,
  GlazeHeading,
  RemainingBar,
  RemainingWeight,
} from "../components";
import { useSave } from "../forms";
import { forgetJarDrafts } from "../autosave";
import { JarFields } from "../editors";

dayjs.extend(relativeTime);

function LastUsed({ timestamp }: { timestamp: string }) {
  const [now, setNow] = useState(() => dayjs());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(dayjs()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <time dateTime={timestamp} title={date(timestamp)}>
      {dayjs(timestamp).from(now)}
    </time>
  );
}

export function ContainerDetail({
  id,
  onClose,
  outsideList = false,
}: {
  id: string;
  onClose: () => void;
  outsideList?: boolean;
}) {
  const query = useApi<Jar>(`/containers/${id}`);
  const [adjusting, setAdjusting] = useState(false);
  const [weight, setWeight] = useState("");
  const adjustButton = useRef<HTMLButtonElement>(null);
  const attempt = useRef<{ request_id: string; expected_revision: number; gross_g: number } | null>(null);
  function closeAdjustment() {
    setAdjusting(false);
    setWeight("");
    attempt.current = null;
  }
  const save = useSave(closeAdjustment);
  const deletion = useSave(() => {
    forgetJarDrafts(`/containers/${id}`);
    onClose();
  });
  const measurement = useSave(() => {
    closeAdjustment();
    requestAnimationFrame(() => adjustButton.current?.focus());
  });
  const jar = query.data;
  const actionPending = save.isPending || measurement.isPending || deletion.isPending;
  return (
    <aside className="jar-detail-pane" aria-label="Jar details">
      <div className="pane-navigation">
        <button className="text-button back-to-inventory" onClick={onClose}>
          <ArrowLeft size={16} />
          Inventory
        </button>
        <button
          className="icon-button close-pane"
          aria-label="Close jar details"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      {query.isPending ? (
        <Loading />
      ) : !jar ? (
        <ErrorMessage error={query.error} />
      ) : (
        <div className="pane-content">
          <div className="jar-detail-header">
            <GlazeHeading glaze={jar.glaze} jar={jar} />
            <div className="detail-actions">
              {!jar.archived && (
                <button
                  ref={adjustButton}
                  className="button secondary"
                  aria-expanded={adjusting}
                  aria-controls={adjusting ? "measured-weight-form" : undefined}
                  disabled={actionPending}
                  onClick={() => {
                    measurement.reset();
                    if (adjusting) closeAdjustment();
                    else setAdjusting(true);
                  }}
                >
                  <Scale size={15} />
                  Adjust Weight
                </button>
              )}
              <button
                className="button secondary"
                disabled={actionPending}
                onClick={() =>
                  save.mutate({
                    path: `/containers/${jar.id}`,
                    method: "PATCH",
                    body: {
                      expected_revision: jar.revision,
                      archived: !jar.archived,
                    },
                  })
                }
              >
                {jar.archived ? <RotateCcw size={15} /> : <Archive size={15} />}
                {jar.archived ? "Restore jar" : "Archive jar"}
              </button>
              <button
                type="button"
                className="icon-button delete-jar"
                aria-label="Delete jar"
                title="Delete jar"
                disabled={actionPending}
                onClick={() => {
                  if (window.confirm(
                    `Permanently delete ${jar.glaze.name} jar #${jar.number} and its weight history? This cannot be undone.`,
                  )) {
                    deletion.mutate({
                      path: `/containers/${jar.id}`,
                      method: "DELETE",
                      body: { expected_revision: jar.revision },
                    });
                  }
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          <ErrorMessage error={deletion.error || save.error} />
          {outsideList && (
            <p className="selection-note">
              This jar is not in the current list.
            </p>
          )}
          <section className="stock-detail">
            <div className="stock-summary">
              <div className="stock-amount">
                <span className="sr-only">Remaining glaze</span>
                <strong className="big-weight"><RemainingWeight jar={jar} /></strong>
                <span className="stock-baseline">
                  {jar.starting_net_g != null && `of ${grams(jar.starting_net_g)} `}
                  remaining
                </span>
              </div>
              <RemainingBar jar={jar} className="meter" />
            </div>
            <p className="last-used">
              {jar.last_weighed_at ? (
                <>Last used <LastUsed key={jar.last_weighed_at} timestamp={jar.last_weighed_at} /></>
              ) : (
                "Not used yet"
              )}
            </p>
            {adjusting && !jar.archived && (
              <form
                id="measured-weight-form"
                className="weight-adjustment"
                aria-label="Adjust weight"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (measurement.isPending) return;
                  // Reuse the entire payload if a saved reading lost its acknowledgement.
                  attempt.current ??= {
                    request_id: Array.from(crypto.getRandomValues(new Uint8Array(16)),
                      (byte) => byte.toString(16).padStart(2, "0")).join(""),
                    expected_revision: jar.revision,
                    gross_g: Number(weight),
                  };
                  measurement.mutate(
                    { path: `/containers/${jar.id}/measurements`, body: attempt.current },
                    { onError: (error) => {
                      if (error instanceof ApiError && error.status === 409) {
                        attempt.current = null;
                        void query.refetch();
                      }
                    } },
                  );
                }}
              >
                <Field label="Measured weight (g)" hint="Scale reading including the container.">
                  <input
                    type="number"
                    autoFocus
                    required
                    min="0"
                    max="10000000"
                    step="0.001"
                    value={weight}
                    disabled={actionPending}
                    onChange={(event) => {
                      attempt.current = null;
                      measurement.reset();
                      setWeight(event.target.value);
                    }}
                  />
                </Field>
                <button className="button primary" disabled={actionPending}>
                  {measurement.isPending ? "Applying…" : "Apply"}
                </button>
                <ErrorMessage error={measurement.error} />
              </form>
            )}
            {jar.incomplete && (
              <p className="notice">
                {jar.gross_g == null ? "Weigh this jar on the scale. " : ""}
                {jar.tare_g == null ? "Choose a container with a known empty weight. " : ""}
              </p>
            )}
            {jar.below_tare && (
              <p className="notice">
                Gross weight is below the empty jar weight. Remaining stock is
                shown as zero.
              </p>
            )}
          </section>
          <section className="detail-section" aria-label="Jar fields">
            <JarFields jar={jar} />
          </section>
        </div>
      )}
    </aside>
  );
}
