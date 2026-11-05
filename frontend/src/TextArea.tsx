import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react";

export function TextArea(props: ComponentPropsWithoutRef<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Older browsers need an explicit height when text or wrapping changes.
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field || CSS.supports("field-sizing", "content")) return;

    function fit(element: HTMLTextAreaElement) {
      element.style.height = "auto";
      const border = element.offsetHeight - element.clientHeight;
      element.style.height = `${element.scrollHeight + border}px`;
    }
    const resize = () => fit(field);
    resize();
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === field.clientWidth) return;
      width = field.clientWidth;
      resize();
    });
    observer.observe(field);
    field.addEventListener("input", resize);
    return () => {
      field.removeEventListener("input", resize);
      observer.disconnect();
    };
  }, [props.value]);

  return <textarea ref={ref} {...props} />;
}
