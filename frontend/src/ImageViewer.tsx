import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";

type ImagePreview = { src: string; alt: string };
const ImageViewerContext = createContext<((image: ImagePreview) => void) | null>(null);

function ImageDialog({
  image,
  onClose,
}: {
  image: ImagePreview;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [failed, setFailed] = useState(false);
  function close() {
    dialog.current?.close();
    onClose();
  }
  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="image-dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          event.preventDefault();
          dialog.current?.querySelector("button")?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom
        ) close();
      }}
    >
      <div className="image-dialog-heading">
        <h2 id={titleId}>{image.alt}</h2>
        <button
          type="button"
          className="image-dialog-close"
          aria-label="Close photo"
          onClick={close}
          autoFocus
        >
          <X size={24} aria-hidden="true" />
        </button>
      </div>
      <div className="image-dialog-body">
        {failed ? (
          <p role="alert">This photo couldn’t be loaded. Close it and try again.</p>
        ) : (
          <img src={image.src} alt={image.alt} onError={() => setFailed(true)} />
        )}
      </div>
    </dialog>
  );
}

export function ImageViewerProvider({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<ImagePreview | null>(null);
  return (
    <ImageViewerContext value={setImage}>
      {children}
      {image && <ImageDialog image={image} onClose={() => setImage(null)} />}
    </ImageViewerContext>
  );
}

export function ImageButton({
  src,
  fullSrc = src,
  alt,
  className = "",
  imageClassName,
  loading,
  children,
}: {
  src: string;
  fullSrc?: string;
  alt: string;
  className?: string;
  imageClassName?: string;
  loading?: "lazy" | "eager";
  children?: ReactNode;
}) {
  const open = useContext(ImageViewerContext);
  return (
    <button
      type="button"
      className={`image-button ${className}`}
      aria-label={`Open photo · ${alt}`}
      aria-haspopup="dialog"
      onClick={(event) => {
        event.stopPropagation();
        // Safari does not focus buttons on tap; remember this opener on close.
        event.currentTarget.focus({ preventScroll: true });
        open?.({ src: fullSrc, alt });
      }}
    >
      <img src={src} alt={alt} className={imageClassName} loading={loading} />
      {children}
    </button>
  );
}
