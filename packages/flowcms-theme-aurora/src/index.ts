import type { FlowCMSTheme } from "flowcms/theme"
import { manifest } from "./manifest"
import { auroraSettings } from "./settings"
import Layout from "./Layout"
import Home from "./Home"
import BlogIndex from "./BlogIndex"

/**
 * The theme object FlowCMS registers.
 *
 * A PARTIAL theme, on purpose. `Page`, `BlogPost`, the archives and `NotFound`
 * are absent, and core falls back to the default theme's implementations for
 * each. Most real themes restyle part of a site rather than all of it, and a
 * package that implemented everything would never exercise that path.
 */
export const auroraTheme: FlowCMSTheme = {
  manifest,
  settings: auroraSettings,
  Layout,
  Home,
  BlogIndex,
}

export { manifest, auroraSettings }
export type { AuroraSettings } from "./settings"
export default auroraTheme
