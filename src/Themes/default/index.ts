import type { FlowCMSTheme } from "@/Themes/contract"
import { manifest } from "./manifest"
import { defaultThemeSettings } from "./settings"
import Layout from "./Layout"
import Home from "./Home"
import Page from "./Page"
import BlogIndex from "./BlogIndex"
import BlogPost from "./BlogPost"
import Archive from "./Archive"
import AuthorArchive from "./AuthorArchive"
import NotFound from "./NotFound"

/**
 * The theme FlowCMS ships with.
 *
 * It implements every surface, which is what makes it usable as the fallback
 * for third-party themes that implement only some. Nothing else in the system
 * is allowed to assume that of any other theme.
 *
 * `CategoryArchive` and `TagArchive` are the same component deliberately. Both
 * receive an `ArchiveView` carrying `kind`, and the two pages differ only in a
 * label and a base path — two files would be two places to fix the same
 * pagination bug. They are separate contract surfaces so that a theme which
 * *does* want them to differ can say so.
 */
export const defaultTheme: FlowCMSTheme = {
  manifest,
  settings: defaultThemeSettings,
  Layout,
  Home,
  Page,
  BlogIndex,
  BlogPost,
  CategoryArchive: Archive,
  TagArchive: Archive,
  AuthorArchive,
  NotFound,
}

export default defaultTheme
