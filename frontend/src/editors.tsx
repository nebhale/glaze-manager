import {
  useApi,
  type Glaze,
  type Jar,
  type Manufacturer,
  type Page,
  type Preset,
} from "./api";
import { InlineField } from "./autosave";
import { ErrorMessage } from "./components";

export function ManufacturerFields({
  manufacturer,
}: {
  manufacturer: Manufacturer;
}) {
  const resource = `/manufacturers/${manufacturer.id}`;
  return (
    <div className="editable-grid">
      <InlineField
        resource={resource}
        field="name"
        value={manufacturer.name}
        label="Name"
        required
      />
      <InlineField
        resource={resource}
        field="website"
        value={manufacturer.website ?? null}
        label="Website"
        type="url"
        placeholder="https://"
        maxLength={2000}
      />
      <InlineField
        resource={resource}
        field="notes"
        value={manufacturer.notes ?? null}
        label="Notes"
        type="textarea"
        placeholder=""
        maxLength={20000}
      />
    </div>
  );
}
export function GlazeFields({ glaze }: { glaze: Glaze }) {
  const resource = `/glazes/${glaze.id}`;
  const manufacturers = useApi<Page<Manufacturer>>(
    "/manufacturers?page_size=1000",
  );
  return (
    <>
      <ErrorMessage error={manufacturers.error} />
      <div className="editable-grid">
        <InlineField
          resource={resource}
          field="name"
          value={glaze.name}
          label="Name"
          required
        />
        <InlineField
          resource={resource}
          field="product_code"
          value={glaze.product_code ?? null}
          label="Product code"
        />
        <InlineField
          resource={resource}
          field="cone"
          value={glaze.cone ?? null}
          label="Cone"
          suggestions="cone"
        />
        <InlineField
          resource={resource}
          field="classification"
          value={glaze.classification ?? null}
          label="Classification"
        >
          <option value="">Not set</option>
          <option value="glaze">Glaze</option>
          <option value="underglaze">Underglaze</option>
          <option value="other">Other</option>
        </InlineField>
        <InlineField
          resource={resource}
          field="manufacturer_id"
          value={glaze.manufacturer_id}
          label="Manufacturer"
          required
        >
          <option value="" disabled>
            Choose a manufacturer
          </option>
          {manufacturers.data?.items.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </InlineField>
        <InlineField
          resource={resource}
          suggestions="product_line"
          field="product_line"
          value={glaze.product_line ?? null}
          label="Product line"
        />
        <InlineField
          resource={resource}
          field="product_url"
          value={glaze.product_url ?? null}
          label="Product page"
          type="url"
          placeholder="https://"
          maxLength={2000}
        />
        <InlineField
          resource={resource}
          field="notes"
          value={glaze.notes ?? null}
          label="Notes"
          type="textarea"
          placeholder=""
          maxLength={20000}
        />
      </div>
    </>
  );
}
export function JarFields({ jar }: { jar: Jar }) {
  const resource = `/containers/${jar.id}`;
  const presets = useApi<Page<Preset>>("/presets?page_size=1000");
  const glazes = useApi<Page<Glaze>>("/glazes?page_size=1000");
  return (
    <>
      <ErrorMessage error={presets.error || glazes.error} />
      <div className="editable-grid">
        <InlineField
          resource={resource}
          field="glaze_id"
          value={jar.glaze_id}
          label="Glaze"
          required
        >
          {(glazes.data?.items ?? [jar.glaze]).map((glaze) => (
            <option key={glaze.id} value={glaze.id}>
              {glaze.manufacturer_name} · {glaze.name}
              {glaze.product_code ? ` (${glaze.product_code})` : ""}
            </option>
          ))}
        </InlineField>
        <InlineField
          resource={resource}
          field="preset_id"
          value={jar.preset_id ?? null}
          label="Container"
        >
          <option value="">No container</option>
          {presets.data?.items.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </InlineField>
        <InlineField
          resource={resource}
          suggestions="location"
          field="location"
          value={jar.location ?? null}
          label="Location"
        />
        <InlineField
          resource={resource}
          field="cost_usd"
          value={jar.cost_usd ?? null}
          label="Cost"
          type="currency"
        />
        <InlineField
          resource={resource}
          field="notes"
          value={jar.notes ?? null}
          label="Notes"
          type="textarea"
          placeholder=""
          maxLength={20000}
        />
        <div className="field inline-field">
          <label htmlFor="jar-nfc-tag">NFC Tag</label>
          <output id="jar-nfc-tag">{jar.tag_uid || "Not linked"}</output>
        </div>
      </div>
    </>
  );
}
