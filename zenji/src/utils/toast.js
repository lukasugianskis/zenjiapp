export const TOAST_EVENT = "knowji:toast";

export function showToast(message, type = "success") {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent(TOAST_EVENT, {
      detail: {
        message: String(message || ""),
        type,
      },
    }),
  );
}
