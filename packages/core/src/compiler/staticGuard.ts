import { collectExternalStyles, lintHyperframeHtml } from "@hyperframes/lint";

export type HyperframeStaticFailureReason =
  | "missing_composition_id"
  | "missing_composition_dimensions"
  | "missing_timeline_registry"
  | "invalid_script_syntax"
  | "invalid_static_hyperframe_contract";

export type HyperframeStaticGuardResult = {
  isValid: boolean;
  missingKeys: string[];
  failureReason: HyperframeStaticFailureReason | null;
};

/** `project` lets the lint read the stylesheets the html links, as `hyperframes lint` does; without it only inline
 * `<style>` is seen. `compSrcPath` is the html's project-relative path, unless it is the root index.html. */
export async function validateHyperframeHtmlContract(
  html: string,
  project?: { dir: string; compSrcPath?: string },
): Promise<HyperframeStaticGuardResult> {
  const result = await lintHyperframeHtml(
    html,
    project && {
      externalStyles: collectExternalStyles(project.dir, html, project.compSrcPath),
    },
  );
  const missingKeys = result.findings
    .filter((finding) => finding.severity === "error")
    .map((finding) => finding.message);

  if (missingKeys.length === 0) {
    return { isValid: true, missingKeys: [], failureReason: null };
  }

  const joined = missingKeys.join(" ").toLowerCase();
  let failureReason: HyperframeStaticFailureReason = "invalid_static_hyperframe_contract";
  if (joined.includes("data-composition-id")) {
    failureReason = "missing_composition_id";
  } else if (joined.includes("data-width") || joined.includes("data-height")) {
    failureReason = "missing_composition_dimensions";
  } else if (joined.includes("window.__timelines")) {
    failureReason = "missing_timeline_registry";
  } else if (joined.includes("script syntax")) {
    failureReason = "invalid_script_syntax";
  }

  return { isValid: false, missingKeys, failureReason };
}
