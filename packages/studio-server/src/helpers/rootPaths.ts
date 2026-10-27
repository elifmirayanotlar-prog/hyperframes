import { mapStartTagsAndStyles } from "@hyperframes/core/compiler/html-document";

const ROOT_PATH = /^\/(?!\/)/;
const PATH_ATTR =
  /(\s(?:src|href|poster|xlink:href)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const CSS_ROOT_URL = /(\burl\(\s*)(["']?)(\/(?!\/)[^"')\s]*)\2/gi;

export const underBase = (path: string, base: string) =>
  ROOT_PATH.test(path) && !path.startsWith(base) ? base + path.slice(1) : path;

/** Moves the composition's root paths in src, href, poster and CSS url() under base; links and <base> stay. */
export function withRootPathsUnderBase(html: string, base: string): string {
  const css = (text: string) =>
    text.replace(
      CSS_ROOT_URL,
      (_m, open: string, quote: string, path: string) =>
        `${open}${quote}${underBase(path, base)}${quote}`,
    );
  const attrs = (tag: string) =>
    tag.replace(PATH_ATTR, (whole, name: string, dq?: string, sq?: string, bare?: string) => {
      const path = (dq ?? sq ?? bare ?? "").trim();
      const moved = underBase(path, base);
      if (moved === path) return whole;
      return dq !== undefined
        ? `${name}"${moved}"`
        : sq !== undefined
          ? `${name}'${moved}'`
          : `${name}${moved}`;
    });
  return mapStartTagsAndStyles(html, {
    tag: (tag) => (/^<(?:a|base)[\s/>]/i.test(tag) ? tag : css(attrs(tag))),
    style: css,
  });
}
