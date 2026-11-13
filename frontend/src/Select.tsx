import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useState,
  type ComponentProps,
} from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

type SelectProps = Pick<
  ComponentProps<"select">,
  | "id"
  | "name"
  | "autoFocus"
  | "disabled"
  | "required"
  | "children"
  | "aria-describedby"
> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

// Radix reserves the empty value for its placeholder. Optional fields still
// expose an explicit clearing option; only real values enter the native form.
const EMPTY_OPTION = "__empty_option__";

export function Select({
  id,
  name,
  autoFocus,
  disabled,
  required,
  children,
  value,
  defaultValue = "",
  onValueChange,
  "aria-describedby": describedBy,
}: SelectProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  // Radix moves focus into the portalled list. Make the background inert as
  // well as aria-hidden so its controls cannot remain keyboard-accessible.
  useEffect(() => {
    if (!open) return;
    // A native modal dialog already makes its background inert. Its menu
    // must remain inside that dialog's top layer to accept focus and input.
    if (trigger?.closest("dialog")) return;
    const root = document.getElementById("root");
    if (!root) return;
    root.inert = true;
    return () => {
      root.inert = false;
    };
  }, [open, trigger]);
  const errorId = useId();
  const selected = value ?? uncontrolledValue;
  const options = Children.toArray(children)
    .filter((child) => isValidElement<ComponentProps<"option">>(child))
    .map((child) => ({
      value: String(child.props.value ?? child.props.children ?? ""),
      label: child.props.children,
      disabled: child.props.disabled,
    }));
  const placeholder = options.find((option) => option.value === "")?.label;

  return (
    <div
      className="select-control"
      onInvalidCapture={(event) => {
        // Native form validation still blocks submission. Focus the visible
        // control rather than Radix's hidden form select when it is required.
        event.preventDefault();
        setInvalid(true);
        trigger?.focus();
      }}
    >
      <SelectPrimitive.Root
        open={open}
        onOpenChange={setOpen}
        name={name}
        value={selected}
        disabled={disabled}
        required={required}
        onValueChange={(next) => {
          const nextValue = next === EMPTY_OPTION ? "" : next;
          setUncontrolledValue(nextValue);
          setInvalid(false);
          onValueChange?.(nextValue);
        }}
      >
        <SelectPrimitive.Trigger
          ref={setTrigger}
          autoFocus={autoFocus}
          id={id}
          className="select-trigger"
          aria-describedby={
            [describedBy, invalid ? errorId : undefined]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-invalid={invalid || undefined}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon asChild>
            <ChevronDown size={16} aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal
          container={trigger?.closest("dialog") ?? undefined}
        >
          <SelectPrimitive.Content
            className="select-menu"
            position="popper"
            sideOffset={5}
            collisionPadding={12}
            onCloseAutoFocus={(event) => {
              const root = document.getElementById("root");
              if (root) root.inert = false;
              // Closing a menu restores focus asynchronously. Do not steal it
              // back if the user has already moved to the next field.
              const active = document.activeElement;
              if (
                active &&
                active !== document.body &&
                active !== trigger &&
                !active.closest(".select-menu")
              )
                event.preventDefault();
            }}
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            <SelectPrimitive.ScrollUpButton className="select-scroll">
              <ChevronUp size={16} aria-hidden="true" />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className="select-options">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value || EMPTY_OPTION}
                  disabled={option.disabled}
                  className="select-option"
                >
                  <SelectPrimitive.ItemText>
                    {option.label}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="select-check">
                    <Check size={15} aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="select-scroll">
              <ChevronDown size={16} aria-hidden="true" />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {invalid && (
        <small id={errorId} className="select-error" role="alert">
          Please choose an option.
        </small>
      )}
    </div>
  );
}
