import {
  challengeArtifactUrl,
  challengeMetadataUrl,
  challengeSourceUrl,
  isInlineChallenge,
} from "./rendering.js";
import {
  safeDataUrl,
  safeExternalUrl,
  safeInternalUrl,
} from "./security.mjs";
import {
  bindSourceControl,
  createSourceAvailabilityBinding,
  sourceFileUrl,
  topSourceLocation,
} from "./source-preservation.mjs";

export function validateChallengeMetadata(entry, metadata) {
  const expectedDeclarations = [
    ...entry.formalization.theorem_names,
    ...entry.formalization.definition_names,
  ];
  const expectedImports = entry.trust.challenge_imports;
  const sameArray = (left, right) =>
    Array.isArray(left) && left.length === right.length &&
      left.every((value, index) => value === right[index]);
  if (
    ![1, 2].includes(metadata?.schema_version) ||
    !sameArray(metadata.declarations, expectedDeclarations) ||
    !sameArray(metadata.imports, expectedImports) ||
    !(metadata.module_doc === null ||
      (typeof metadata.module_doc === "string" && metadata.module_doc.length <= 256 * 1024))
  ) {
    throw new Error("Challenge render metadata does not match the registry entry");
  }
  if (
    metadata.schema_version >= 2 &&
    (!Array.isArray(metadata.solution_imports) ||
      metadata.solution_imports.length > 1_000 ||
      !metadata.solution_imports.every((item) => typeof item === "string" && item.length > 0))
  ) {
    throw new Error("Challenge render metadata contains invalid Solution imports");
  }
  return metadata;
}

/**
 * Mount one Verso rendering, sandboxed, and size it to what it reports.
 *
 * The rendering runs with scripts and without same-origin privilege, so it can
 * neither read this document nor be read by it, and the one thing it is allowed
 * to say arrives as a message: how tall it turned out. That message is checked
 * to have come from this frame and to be a plausible height before it moves
 * anything.
 *
 * `dispose` exists because that listener is on `window`, not on the frame. One
 * frame kept for a page's lifetime can leave it; a surface that mounts a frame
 * and throws it away again cannot, or every rendering a reader passed over
 * stays subscribed for as long as the page is open.
 */
export function createRenderFrames({ document, window }) {
  return function createRenderFrame({
    src,
    title,
    lazy = false,
    minHeight = 160,
    maxHeight = 672,
    onHeight = () => {},
  }) {
    const frame = document.createElement("iframe");
    frame.className = "challenge-frame";
    frame.src = safeDataUrl(src, window.location.href).href;
    frame.title = title;
    if (lazy) frame.loading = "lazy";
    frame.referrerPolicy = "no-referrer";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("scrolling", "auto");
    const onMessage = (event) => {
      if (
        !frame.contentWindow ||
        event.source !== frame.contentWindow ||
        event.data?.type !== "palomar-render-height"
      ) {
        return;
      }
      const height = event.data.height;
      if (!Number.isSafeInteger(height) || height <= 0) return;
      frame.style.height = `${Math.max(minHeight, Math.min(maxHeight, height + 2))}px`;
      frame.dataset.heightAdjusted = "true";
      // The height arrives after the frame is in the document, so anything
      // that positioned itself around the frame guessed. This is where it
      // finds out. An entry page lays out in flow and ignores it.
      onHeight();
    };
    window.addEventListener("message", onMessage);
    return {
      frame,
      dispose() {
        window.removeEventListener("message", onMessage);
        frame.remove();
      },
    };
  };
}

/**
 * Bind the named-declarations presentation to its browser and data adapters.
 *
 * Registry validation, source resolution, URL confinement, and inline policy
 * remain in their existing modules. This boundary owns only the render
 * artifact's correspondence to an entry and the DOM states used to present it.
 */
export function createChallengePresentation({ fetchJson, document, window, localPageUrl }) {
  const createRenderFrame = createRenderFrames({ document, window });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function anchor(text, href, className) {
    const node = el("a", className, text);
    node.href = href.href;
    return node;
  }

  function externalLink(text, href, className) {
    return anchor(text, safeExternalUrl(href), className);
  }

  function internalLink(text, href, className) {
    return anchor(text, safeInternalUrl(href, window.location.href), className);
  }

  function sourceLink(text, sourceAvailability, urlForAvailability, className) {
    return bindSourceControl(
      externalLink(text, urlForAvailability(sourceAvailability.current), className),
      sourceAvailability,
      (availability) => ({ url: urlForAvailability(availability) }),
    );
  }

  function challengeFrame(entry, renderBase) {
    // An entry page mounts one of these and keeps it for the page's lifetime,
    // so it never disposes. A surface that mounts and discards them has to.
    return createRenderFrame({
      src: challengeArtifactUrl(entry, renderBase).href,
      title: `Named compared declarations for ${entry.id} version ${entry.version}`,
      lazy: true,
    }).frame;
  }

  function metadataPanel(metadata) {
    const panel = el("div", "challenge-metadata");
    panel.append(el("div", "eyebrow", "Statement file information"));
    const imports = el("div", "challenge-metadata-row");
    imports.append(el("strong", "", "Libraries imported by the statement"));
    const tokens = el("span", "token-list");
    for (const item of metadata.imports) tokens.append(el("code", "", item));
    imports.append(tokens);
    panel.append(imports);
    if (metadata.module_doc) {
      const moduleDoc = el("details", "challenge-module-doc");
      moduleDoc.append(el("summary", "", "Notes from the statement file"));
      moduleDoc.append(el("pre", "", metadata.module_doc));
      panel.append(moduleDoc);
    } else {
      panel.append(el("p", "challenge-no-module-doc", "No notes were found in the statement file."));
    }
    return panel;
  }

  return async function challengePresentation(
    entry,
    renderBase,
    {
      forceFrame = false,
      dependenciesOnThisPage = false,
      sourceAvailability = null,
      availabilityPromise = null,
    } = {},
  ) {
    const availability = sourceAvailability ??
      createSourceAvailabilityBinding(availabilityPromise);
    const section = el("section", "challenge-presentation");
    const heading = el("div", "section-heading");
    const titleBlock = el("div");
    titleBlock.append(
      el("div", "eyebrow", "Formal comparison surface"),
      el("h2", "", "Named compared declarations"),
    );
    heading.append(titleBlock);
    section.append(heading);

    const links = el("p", "challenge-links");
    // On the entry page the dependencies are a little further down, and a link
    // that rebuilds the entry URL reads as a trip somewhere else. The dedicated
    // render page does not carry them, so from there it is a trip somewhere else.
    const dependencyRecordUrl = dependenciesOnThisPage
      ? new URL("#statement-dependencies", window.location.href)
      : localPageUrl("entry.html", entry);
    if (!dependenciesOnThisPage) dependencyRecordUrl.hash = "statement-dependencies";
    const comparatorPath = entry.formalization.comparator_config_path;
    const challengePath = entry.formalization.challenge_path;
    const challengeFilename = challengePath.split("/").at(-1);
    links.append(
      sourceLink(
        `View full pinned statement file (${challengeFilename})`,
        availability,
        (manifest) => challengeSourceUrl(
          entry,
          topSourceLocation(entry, manifest).repository,
        ),
        "challenge-source",
      ),
      " · ",
      internalLink("Inspect statement dependencies", dependencyRecordUrl),
      " · ",
      sourceLink(
        `View comparator configuration (${comparatorPath.split("/").at(-1)})`,
        availability,
        (manifest) => sourceFileUrl(entry, comparatorPath, manifest),
        "comparator-source",
      ),
    );
    const inline = isInlineChallenge(entry);
    if (!forceFrame && !inline) {
      links.append(
        " · ",
        internalLink("Open formatted statement", localPageUrl("render.html", entry)),
      );
    }
    section.append(links);
    section.append(
      el(
        "p",
        "challenge-surface-disclosure",
        `The formatted view shows only the declarations named in this entry's comparator configuration. Comparator also checks the declarations used by their types. The full pinned ${challengeFilename} and dependency record expose the statement and dependency surface for inspection.`,
      ),
    );

    let metadata;
    try {
      metadata = validateChallengeMetadata(
        entry,
        await fetchJson(challengeMetadataUrl(entry, renderBase)),
      );
    } catch (error) {
      if (error.status !== 404) throw error;
      section.append(
        el(
          "p",
          "challenge-fallback",
          "The formatted statement is not available for this entry yet. Use the statement file link above; the pinned source is the record either way.",
        ),
      );
      return { section, metadata: null };
    }
    section.append(metadataPanel(metadata));

    if (forceFrame || inline) {
      section.append(challengeFrame(entry, renderBase));
    } else {
      section.append(
        el(
          "p",
          "challenge-fallback",
          "This statement is too large to display here; use the formatted view above.",
        ),
      );
    }
    return { section, metadata };
  };
}
