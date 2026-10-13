/** Resolve snapshot URLs (including root-relative URLs embedded in catalogs)
 * against the build's public base without changing external data providers.
 */
export function publicAssetUrl(
  path: string,
  base = import.meta.env.BASE_URL,
): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) return path;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  if (path.startsWith(prefix)) return path;
  return `${prefix}${path.replace(/^(?:\.\/|\/)+/, "")}`;
}
