/**
 * Moved to `@/Themes/contract/runtime/publicImageUrl` in Phase 7.2: themes
 * render stored images, so the URL builder is part of the published contract.
 *
 * Re-exported here because the route handler that SERVES those URLs
 * (`/api/public/images/[...key]`) needs the same base path, and one constant is
 * what keeps the writer and the reader agreeing.
 */
export {
  PUBLIC_IMAGE_ROUTE_BASE,
  publicImageUrl,
  publicImagePath,
} from "@/Themes/contract/runtime/publicImageUrl"
