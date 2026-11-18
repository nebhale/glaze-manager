import { useApi, type GlazeRecord } from "./api";
import { ErrorMessage, Loading, VesselList } from "./components";

export function GlazeVessels({ glazeId }: { glazeId: string }) {
  const query = useApi<GlazeRecord>(`/glazes/${glazeId}`);
  const glaze = query.data;
  return (
    <section className="detail-section" aria-label="Vessels">
      <div className="section-heading">
        <h3>
          Vessels{" "}
          {glaze && <span className="count">{glaze.vessels.length}</span>}
        </h3>
      </div>
      <ErrorMessage error={query.error} />
      {query.isPending && <Loading />}
      {glaze &&
        (glaze.vessels.length ? (
          <div className="related-table-scroll">
            <VesselList vessels={glaze.vessels} />
          </div>
        ) : (
          <p className="small-empty">No vessels use this glaze yet.</p>
        ))}
    </section>
  );
}
