import { createRenderFrames } from "./challenge-presentation.mjs";
import { challengeArtifactUrl, renderArtifactUrl } from "./rendering.js";
import { recentRenderRow } from "./security.mjs";

// Long enough that crossing a grid of cards on the way somewhere else opens
// nothing, short enough that stopping on a title feels like the answer was
// already there.
const OPEN_DELAY_MS = 350;
// The panel is not under the pointer when it leaves the title, and on the way
// to it the pointer is over neither. Closing on that instant would make the
// panel unreachable, which is the whole of this delay.
const CLOSE_DELAY_MS = 200;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 420;
const GAP = 8;
const MARGIN = 8;

/**
 * A reader's preview of the formal statement, raised by resting on a title.
 *
 * The registry lists results by title and abstract, which says what was proved
 * about what but not what was actually stated. That is in the Verso rendering,
 * one page further in, and a reader comparing a handful of results was paying a
 * navigation each way to see it. This puts it under the pointer.
 *
 * It is a preview and not the record. The entry page remains where a rendering
 * is presented with the pinned source, the dependency surface, and the checks
 * tying it to the accepted entry; this frames the same immutable artifact from
 * the same content address and says nothing further about it.
 *
 * Hover is the only trigger, which is a decision with consequences worth
 * naming: it reaches neither a keyboard nor a touch screen. Both already reach
 * the statement, by the card's own links, and nothing here changes that. What
 * this must not do is degrade those; every failure below closes quietly and
 * leaves the card exactly as it was.
 */
export function createStatementPreview({
  document,
  window,
  dataSource,
  loadRecentRenders,
  warn = () => {},
  openDelayMs = OPEN_DELAY_MS,
  closeDelayMs = CLOSE_DELAY_MS,
}) {
  const sources = new WeakMap();
  const createRenderFrame = createRenderFrames({ document, window });
  const hoverable = window.matchMedia?.("(hover: hover)")?.matches ?? false;

  let panel = null;
  let mounted = null;
  let openTimer = null;
  let closeTimer = null;
  let pending = null;
  let anchored = null;
  // Rests supersede one another. A preview whose reads finish after the reader
  // has moved on belongs to nobody, and showing it would put one result's
  // statement under the pointer while it rests on another's title.
  let generation = 0;

  function cancelOpen() {
    window.clearTimeout(openTimer);
    openTimer = null;
    pending = null;
  }

  /** Take the panel down. Not a supersession, so in-flight reads still count. */
  function unmount() {
    window.clearTimeout(closeTimer);
    closeTimer = null;
    if (mounted) {
      mounted.dispose();
      mounted = null;
    }
    if (panel) {
      panel.remove();
      panel = null;
    }
    anchored = null;
  }

  function dismiss() {
    generation += 1;
    unmount();
  }

  function close() {
    cancelOpen();
    dismiss();
  }

  function place(node, box) {
    const room = window.innerHeight;
    const height = node.offsetHeight || MAX_HEIGHT;
    // The roomier side, and never over the title: a panel that covered what
    // raised it would take the pointer off the title and close itself.
    const below = room - box.bottom - GAP;
    const top = below >= height || below >= box.top - GAP
      ? box.bottom + GAP
      : Math.max(MARGIN, box.top - GAP - height);
    const width = node.offsetWidth || 0;
    const left = Math.max(
      MARGIN,
      Math.min(box.left, window.innerWidth - width - MARGIN),
    );
    node.style.top = `${top}px`;
    node.style.left = `${left}px`;
  }

  function open(link, target) {
    const box = link.getBoundingClientRect();
    panel = document.createElement("div");
    const current = panel;
    panel.className = "statement-preview";
    panel.setAttribute("role", "presentation");
    // The pointer is inside the frame for most of the panel's life, and a
    // cross-origin frame reports none of that to this document. Entering the
    // frame does not leave the panel, so these two are the whole of it.
    panel.addEventListener("mouseenter", () => window.clearTimeout(closeTimer));
    panel.addEventListener("mouseleave", scheduleClose);
    mounted = createRenderFrame({
      src: target.href,
      title: `Formal statement of ${target.id} version ${target.version}`,
      minHeight: MIN_HEIGHT,
      maxHeight: MAX_HEIGHT,
      // Placed once on the guessed height and again on the real one. A panel
      // put above a title on a guess that was short would otherwise grow back
      // down over the title it was raised from.
      onHeight: () => {
        if (panel === current) place(panel, link.getBoundingClientRect());
      },
    });
    panel.append(mounted.frame);
    document.body.append(panel);
    place(panel, box);
  }

  async function resolve(link) {
    const source = sources.get(link);
    if (!source) return null;
    const { renderBase, databaseBase } = dataSource();
    // A search result is a whole validated record and says where its rendering
    // is. A landing row is the card and nothing else, so its hash comes from
    // the bounded companion document. An explicit test, not a failed attempt:
    // the two are different documents, not one document sometimes short of a
    // field.
    if (source.challenge_render) {
      return {
        id: source.id,
        version: source.version,
        href: challengeArtifactUrl(source, renderBase).href,
      };
    }
    const renders = await loadRecentRenders(databaseBase);
    if (!renders) return null;
    const row = recentRenderRow(renders, source.id);
    // The page and this document are built from one selection, so a row that
    // is not here, or is here for another version, is a reader looking at a
    // page newer than the hashes beside it. Say nothing rather than frame the
    // wrong version of a result.
    if (!row || row.version !== source.version) return null;
    return {
      id: row.id,
      version: row.version,
      href: renderArtifactUrl(
        row.id,
        row.version,
        row.artifact_tree_sha256,
        renderBase,
      ).href,
    };
  }

  function scheduleClose() {
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(dismiss, closeDelayMs);
  }

  function scheduleOpen(link) {
    // Back on the title of the panel already up: cancel its dismissal, and any
    // open scheduled for whatever the pointer passed over on the way back.
    if (anchored === link) {
      cancelOpen();
      window.clearTimeout(closeTimer);
      closeTimer = null;
      return;
    }
    if (pending === link) return;
    cancelOpen();
    pending = link;
    openTimer = window.setTimeout(async () => {
      openTimer = null;
      pending = null;
      const mine = (generation += 1);
      let target = null;
      try {
        target = await resolve(link);
      } catch (error) {
        warn(`A statement preview could not be resolved: ${error.message}`);
      }
      // Nothing to show, the reader has moved on, or the grid has been redrawn
      // under this card. Any of the three leaves whatever is up alone: it is
      // the panel of a rest that is still current.
      if (!target || mine !== generation || !link.isConnected) return;
      unmount();
      anchored = link;
      try {
        open(link, target);
      } catch (error) {
        warn(`A statement preview could not be shown: ${error.message}`);
        close();
      }
    }, openDelayMs);
  }

  function titleLink(node) {
    const link = node?.closest?.("h3 > a");
    return link && sources.has(link) ? link : null;
  }

  function onOver(event) {
    const link = titleLink(event.target);
    if (link) scheduleOpen(link);
  }

  function onOut(event) {
    const link = titleLink(event.target);
    if (!link) return;
    // `mouseout` also fires moving between the link's own children.
    if (link.contains(event.relatedTarget)) return;
    cancelOpen();
    // The panel that is up gets the delay, so the pointer can cross the gap
    // into it. A rest that never became one has nothing to cross to.
    if (anchored) scheduleClose();
    else dismiss();
  }

  const bound = [];
  function watch(grid) {
    if (!hoverable || !grid || bound.includes(grid)) return;
    // Delegated, because the grids replace their children on every search and
    // filter. `mouseenter` does not bubble, so this is the pair that can be.
    grid.addEventListener("mouseover", onOver);
    grid.addEventListener("mouseout", onOut);
    bound.push(grid);
  }

  return {
    /** Bind a card's title to the entry or landing row it was built from. */
    register(link, source) {
      if (hoverable && link && source) sources.set(link, source);
    },
    watch,
    close,
    destroy() {
      close();
      for (const grid of bound.splice(0)) {
        grid.removeEventListener("mouseover", onOver);
        grid.removeEventListener("mouseout", onOut);
      }
    },
  };
}
