import { sqliteTable, text, integer, index, type AnySQLiteColumn } from "drizzle-orm/sqlite-core"

/**
 * Navigation menus, and the items in them.
 *
 * A menu is bound to a LOCATION — a theme's navigation slot, the strings a
 * theme declares in `manifest.menuSlots`. `location` is unique, so a slot holds
 * exactly one menu. There is deliberately no `theme_menu_assignment` table and
 * no many-to-many: the moment a slot can hold two menus, every render has to
 * decide which one wins, and no answer to that is obvious to an operator.
 *
 * WHY MENUS ARE NOT SCOPED TO A THEME
 *
 * A menu belongs to a *slot name*, not to the theme that happens to declare it.
 * Two themes both declaring `primary` share the menu, which is what an operator
 * expects when they switch themes and their main navigation is still there.
 * A menu whose location no installed theme declares is simply not rendered —
 * it is never deleted, never rewritten, and comes back the moment a theme
 * declaring that slot is installed again.
 */

export const menus = sqliteTable("menu", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

  /** Operator-facing name. Free text; it never reaches a URL. */
  name: text("name").notNull(),

  /**
   * The theme slot this menu fills, e.g. `primary`.
   *
   * UNIQUE: one menu per slot. Validated against the slots installed themes
   * declare on the WRITE path only — a persisted location naming a slot this
   * build no longer has must still be readable, or upgrading a theme would
   * make an operator's menu unreachable and unfixable.
   */
  location: text("location").notNull().unique(),

  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

/**
 * What a menu item points at.
 *
 * `custom` stores a URL or path in `target`. The four entity types store the
 * ENTITY ID, and core resolves the current public URL at render time. Storing
 * a copy of the URL instead would go stale the first time somebody renamed a
 * post's slug, and FlowCMS already creates a redirect for that — a menu holding
 * the old path would route visitors through a redirect forever.
 */
export const MENU_ITEM_TYPES = ["custom", "page", "post", "category", "tag"] as const
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number]

export const menuItems = sqliteTable(
  "menu_item",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

    /** Cascade: deleting a menu deletes its items. Nothing outside the menu
     *  references them, so there is no history to preserve. */
    menuId: text("menuId")
      .notNull()
      .references(() => menus.id, { onDelete: "cascade" }),

    /**
     * The parent item, or null for a top-level item. Self-referencing.
     *
     * `set null` rather than `cascade`, matching `blogCategories.parentId` —
     * the one self-referencing foreign key FlowCMS already had, and the one
     * shape proven to derive correctly to PostgreSQL and MySQL. InnoDB has
     * documented caveats around cascading self-referential deletes, and this
     * has to behave identically on four engines.
     *
     * In normal operation this action never fires: deleting an item deletes its
     * children first, in the same transaction, in application code. The
     * constraint is the backstop for a row deleted by hand in SQL, where
     * promoting orphans to the top level is a visible, recoverable degrade
     * rather than a dangling reference.
     */
    parentId: text("parentId").references((): AnySQLiteColumn => menuItems.id, {
      onDelete: "set null",
    }),

    label: text("label").notNull(),
    type: text("type", { enum: MENU_ITEM_TYPES }).notNull(),

    /** A URL/path for `custom`, an entity id for everything else. */
    target: text("target").notNull(),

    /** Ascending. Ties break on label then id, so ordering is total even when
     *  two rows share a value — see `buildNavTree`. */
    sortOrder: integer("sortOrder").notNull().default(0),

    /** Inactive items stay in the admin and never reach the public site. A
     *  delete is not the only way to take a link down. */
    isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),

    opensInNewTab: integer("opensInNewTab", { mode: "boolean" }).notNull().default(false),

    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // Every public render reads one menu's items in one query.
    index("menu_item_menu_idx").on(t.menuId),
    // Grouping children under their parent, and finding an item's children
    // before deleting it.
    index("menu_item_parent_idx").on(t.parentId),
  ],
)
