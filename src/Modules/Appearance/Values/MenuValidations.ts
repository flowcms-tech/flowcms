import { z } from "zod"
import { MENU_ITEM_TYPES } from "@/db/schema/menus"
import { sanitizeCustomTarget } from "@/Framework/Navigation/menuTarget"

/**
 * Menu schemas, shared between the admin forms and the route handlers.
 *
 * One definition, both sides — the convention every other FlowCMS module
 * follows. It is what makes it impossible for the browser to accept something
 * the server would refuse, or the reverse.
 */

/** Same shape a theme manifest uses for `menuSlots`: this value has to be able
 *  to match one. */
export const SLOT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const location = z
  .string()
  .trim()
  .min(1, "A location is required")
  .max(40, "Location is too long")
  .regex(SLOT_PATTERN, "Location must be lowercase letters, numbers and hyphens")

const name = z.string().trim().min(1, "A menu name is required").max(120, "Menu name is too long")

export const createMenuSchema = z.object({ name, location })

/** Both fields optional, but at least one must be present — a PATCH that
 *  changes nothing is a client bug, not a no-op worth writing a row for. */
export const updateMenuSchema = z
  .object({ name: name.optional(), location: location.optional() })
  .refine((value) => value.name !== undefined || value.location !== undefined, {
    message: "Nothing to update",
  })

/**
 * `target` means different things per type, and is only fully checkable with
 * the database in hand:
 *
 *   custom → a URL or path, checked HERE by `sanitizeCustomTarget`, because it
 *            is the value that ends up in an href and no later layer re-checks
 *            it;
 *   others → an entity id, whose existence the route checks.
 *
 * Doing the custom check inside the schema means the admin form refuses a
 * `javascript:` URL before it is ever sent, using the same function the route
 * uses on arrival.
 */
const itemBase = {
  label: z.string().trim().min(1, "A label is required").max(120, "Label is too long"),
  type: z.enum(MENU_ITEM_TYPES),
  target: z.string().trim().min(1, "A target is required").max(2048, "Target is too long"),
  parentId: z.string().max(64).nullable().optional(),
  isActive: z.boolean().optional(),
  opensInNewTab: z.boolean().optional(),
}

/** Shared by create and update: a custom target must be one FlowCMS will render. */
function checkCustomTarget(
  value: { type?: string; target?: string },
  ctx: z.RefinementCtx,
): void {
  if (value.type !== "custom" || value.target === undefined) return
  if (sanitizeCustomTarget(value.target) === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["target"],
      message:
        "A link must be a path starting with / or a full http(s) address. Other schemes are not allowed.",
    })
  }
}

export const createMenuItemSchema = z.object(itemBase).superRefine(checkCustomTarget)

export const updateMenuItemSchema = z
  .object(itemBase)
  .partial()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Nothing to update" })
      return
    }
    // Only checkable when the request carries both — a PATCH that changes only
    // the target of an existing custom item is validated in the route, where
    // the stored type is known.
    checkCustomTarget(value, ctx)
  })

/**
 * A whole ordering, not a delta.
 *
 * The client sends the items in the order it wants them, with each one's
 * parent, and the server rewrites `sortOrder` from scratch. Sending "move item
 * X up one" instead would need the server to reconstruct the client's view of
 * the list to know what "up" meant, and two people reordering at once would
 * produce an order neither of them chose.
 */
export const reorderMenuItemsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        parentId: z.string().min(1).max(64).nullable(),
      }),
    )
    .min(1, "Nothing to reorder")
    .max(500, "Too many items in one request"),
})

export type CreateMenuValues = z.infer<typeof createMenuSchema>
export type CreateMenuItemValues = z.infer<typeof createMenuItemSchema>
export type UpdateMenuItemValues = z.infer<typeof updateMenuItemSchema>
