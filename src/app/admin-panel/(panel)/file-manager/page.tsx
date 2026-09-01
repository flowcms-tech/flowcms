import FileManagerBrowser from "@/Modules/FileManager/FileManagerBrowser"

/**
 * A shell, and deliberately nothing more.
 *
 * Every File Manager feature lives in `FileManagerBrowser`, which the picker
 * dialog renders too. Adding UI here instead would give the page something the
 * dialog does not have, which is the exact divergence that component exists to
 * make impossible — see `dev-docs/superpowers/specs/2026-09-01-file-manager-embeddable-design.md`.
 */
export default function FileManagerPage() {
  return <FileManagerBrowser />
}
