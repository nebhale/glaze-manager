import { Camera, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { GlazeRecord, Photo, VesselSummary } from "./api";
import { ErrorMessage } from "./components";
import { useSave } from "./forms";

function PhotoCard({
  photo,
  source,
  linkedVessel,
}: {
  photo: Photo;
  source: string;
  linkedVessel?: VesselSummary;
}) {
  const deletion = useSave();
  return (
    <div className="photo-item">
      <div className="photo-tile">
        <a
          href={photo.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open photo · ${source}`}
        >
          <img
            src={photo.thumbnail_url}
            alt={photo.caption || source}
            loading="lazy"
          />
        </a>
        {!linkedVessel && (
          <button
            type="button"
            className="icon-button photo-delete"
            aria-label="Delete photo"
            title="Delete photo"
            disabled={deletion.isPending}
            onClick={() => {
              if (window.confirm("Delete this photo?"))
                deletion.mutate({
                  path:
                    "vessel_id" in photo
                      ? `/vessels/${photo.vessel_id}/photos/${photo.id}`
                      : `/photos/${photo.id}`,
                  method: "DELETE",
                });
            }}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        )}
      </div>
      {linkedVessel && (
        <Link className="photo-source" to={`/vessels/${linkedVessel.id}`}>
          {source}
        </Link>
      )}
      <ErrorMessage error={deletion.error} />
    </div>
  );
}

export function PhotoGallery(
  props: { glaze: GlazeRecord } | { vessel: VesselSummary },
) {
  const upload = useSave();
  const glaze = "glaze" in props ? props.glaze : undefined;
  const owner = "vessel" in props ? props.vessel : props.glaze;
  const related = glaze?.vessels ?? [];
  const count = related.reduce(
    (n, vessel) => n + vessel.photos.length,
    owner.photos.length,
  );
  const addLabel = glaze ? "Add glaze photo" : "Add vessel photo";
  return (
    <section className="detail-section photo-section" aria-label="Photos">
      <div className="section-heading">
        <h3>
          Photos <span className="count">{count}</span>
        </h3>
      </div>
      <div className="photo-grid" aria-busy={upload.isPending}>
        {owner.photos.map((photo) => (
          <PhotoCard key={photo.id} photo={photo} source={owner.name} />
        ))}
        <label
          className={`photo-tile photo-add-tile ${upload.isPending ? "disabled" : ""}`}
          title={addLabel}
        >
          <span className="photo-add-icon" aria-hidden="true">
            <Camera size={26} />
            <Plus size={13} />
          </span>
          <input
            type="file"
            aria-label={addLabel}
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            disabled={upload.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                const body = new FormData();
                body.append("file", file);
                upload.mutate({
                  path: `/${glaze ? "glazes" : "vessels"}/${owner.id}/photos`,
                  body,
                });
              }
              event.target.value = "";
            }}
          />
        </label>
        {related.flatMap((vessel) =>
          vessel.photos.map((photo) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              linkedVessel={vessel}
              source={vessel.name}
            />
          )),
        )}
      </div>
      <span className="sr-only" role="status">
        {upload.isPending ? "Uploading photo…" : ""}
      </span>
      <ErrorMessage error={upload.error} />
    </section>
  );
}
