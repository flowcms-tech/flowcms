/**
 * Registers the integration theme for a suite that needs a SECOND theme.
 *
 * In its own module so it is evaluated before `@/Themes/registry`: the registry
 * is built once at module load, and setting the variable inside a test file
 * would run after the import graph had already been evaluated.
 *
 * Unlike `activationEnv`, this sets nothing else — a suite that mocks its
 * database access does not want a temp SQLite file created as a side effect of
 * asking for a second theme.
 */
process.env.FLOWCMS_INTEGRATION_THEMES = "1"
