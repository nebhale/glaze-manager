import { useState, type ComponentPropsWithoutRef } from "react";
import { ExternalLink } from "lucide-react";

type Props = Omit<
  ComponentPropsWithoutRef<"input">,
  "value" | "defaultValue" | "type"
> & {
  label: string;
  value?: string;
};

function webUrl(value: string) {
  const text = value.trim();
  if (!/^https?:\/\/\S+$/.test(text)) return;
  try {
    return new URL(text).href;
  } catch {
    return undefined;
  }
}

export function UrlInput({ label, value, onChange, ...props }: Props) {
  const [localValue, setLocalValue] = useState("");
  const current = value ?? localValue;
  const href =
    !props.disabled && (!props.maxLength || current.length <= props.maxLength)
      ? webUrl(current)
      : undefined;
  const action = `Open ${label.toLowerCase()} in a new tab`;
  return (
    <div className="field-with-action">
      <input
        {...props}
        type="url"
        value={current}
        onChange={(event) => {
          if (value === undefined) setLocalValue(event.currentTarget.value);
          onChange?.(event);
        }}
      />
      {href && (
        <a
          className="icon-button"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={action}
          title={action}
        >
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
