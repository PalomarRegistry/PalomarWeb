export const CLIPBOARD_RESET_DELAY_MS = 1600;

/** Clipboard access with a selection-based fallback for older or denied APIs. */
export function createClipboard({ document, navigator, window }) {
  function fallbackCopy(text) {
    const previousFocus = document.activeElement;
    const input = document.createElement("textarea");
    input.value = text;
    input.readOnly = true;
    input.className = "clipboard-fallback";
    document.body.append(input);
    input.select();
    input.setSelectionRange(0, text.length);
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      input.remove();
      previousFocus?.focus();
    }
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // The fallback supports browsers that expose but deny the Clipboard API.
      }
    }
    return fallbackCopy(text);
  }

  // Replacing an unchanged live-region value does not make assistive
  // technology announce it again. Clear it for one frame before every update.
  function announce(status, message) {
    status.textContent = "";
    window.requestAnimationFrame(() => {
      status.textContent = message;
    });
  }

  return { announce, copyText };
}
