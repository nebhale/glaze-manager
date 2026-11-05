import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  useApi,
  type Manufacturer,
  type Page,
  type Preset,
} from "../api";
import {
  AddButton,
  ErrorMessage,
  Loading,
  PageHeading,
} from "../components";
import { InlineField } from "../autosave";
import { ManufacturerFields } from "../editors";
import { ManufacturerForm, PresetForm } from "../forms";

export function Settings() {
  const settings = useApi<{ low_stock_threshold_g: number }>("/settings");
  const presets = useApi<Page<Preset>>("/presets?page_size=1000");
  const manufacturers = useApi<Page<Manufacturer>>(
    "/manufacturers?page_size=1000",
  );
  const [addingManufacturer, setAddingManufacturer] = useState(false);
  const { hash } = useLocation();
  const loading =
    manufacturers.isPending || presets.isPending || settings.isPending;
  useEffect(() => {
    if (loading || !hash) return;
    const target = document.getElementById(hash.slice(1));
    if (target) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start" });
    }
  }, [hash, loading]);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeading eyebrow="" title="Settings" />
      <ErrorMessage error={settings.error || presets.error} />
      <div className="settings-sections">
        <section
          className="settings-section"
          aria-labelledby="inventory-settings-heading"
        >
          <div className="settings-section-heading">
            <h2 id="inventory-settings-heading">Inventory</h2>
          </div>
          <div className="settings-row">
            {settings.isPending ? (
              <Loading />
            ) : (
              settings.data && (
                <InlineField
                  resource="/settings"
                  field="low_stock_threshold_g"
                  value={settings.data.low_stock_threshold_g}
                  label="Studio low-stock threshold (g)"
                  hint="Warn when a jar’s remaining glaze falls below this weight."
                  type="number"
                  required
                />
              )
            )}
          </div>
        </section>
        <section
          className="settings-section"
          aria-labelledby="preset-settings-heading"
        >
          <div className="settings-section-heading">
            <h2 id="preset-settings-heading">Containers</h2>
            {!adding && (
              <AddButton onClick={() => setAdding(true)}>Add</AddButton>
            )}
          </div>
          {adding && (
            <div className="settings-row">
              <PresetForm done={() => setAdding(false)} />
            </div>
          )}
          {presets.isPending ? (
            <Loading />
          ) : presets.data?.items.length ? (
            presets.data.items.map((p) => (
              <div
                className="settings-row editable-grid settings-preset-row"
                key={p.id}
              >
                <InlineField
                  resource={`/presets/${p.id}`}
                  field="name"
                  value={p.name}
                  label="Name"
                  required
                />
                <InlineField
                  resource={`/presets/${p.id}`}
                  field="tare_g"
                  value={p.tare_g ?? null}
                  label="Empty weight (g)"
                  type="number"
                  placeholder="Unknown"
                />
              </div>
            ))
          ) : (
            !adding &&
            presets.data && (
              <p className="settings-row helper">No containers yet.</p>
            )
          )}
        </section>
        <section
          id="manufacturers"
          tabIndex={-1}
          className="settings-section"
          aria-labelledby="manufacturer-settings-heading"
        >
          <div className="settings-section-heading">
            <h2 id="manufacturer-settings-heading">Manufacturers</h2>
            {!addingManufacturer && (
              <AddButton onClick={() => setAddingManufacturer(true)}>
                Add
              </AddButton>
            )}
          </div>
          {addingManufacturer && (
            <div className="settings-row">
              <ManufacturerForm done={() => setAddingManufacturer(false)} />
            </div>
          )}
          <ErrorMessage error={manufacturers.error} />
          {manufacturers.isPending ? (
            <Loading />
          ) : manufacturers.data?.items.length ? (
            manufacturers.data.items.map((manufacturer) => (
              <div
                className="settings-row"
                key={manufacturer.id}
                id={`manufacturer-${manufacturer.id}`}
                data-manufacturer-id={manufacturer.id}
                role="group"
                aria-label={manufacturer.name}
                tabIndex={-1}
              >
                <ManufacturerFields manufacturer={manufacturer} />
              </div>
            ))
          ) : (
            !addingManufacturer &&
            manufacturers.data && (
              <p className="settings-row helper">No manufacturers yet.</p>
            )
          )}
        </section>
      </div>
    </>
  );
}
