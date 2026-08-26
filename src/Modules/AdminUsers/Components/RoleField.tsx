'use client'

import { useFormContext } from 'react-hook-form'
import ElementSelect, { type SelectItem } from '@/components/shared/ElementSelect/ElementSelect'
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from '@/Framework/Auth/permissions'

const ROLE_ITEMS: SelectItem[] = ROLES.map((role) => ({
  label: ROLE_LABELS[role],
  value: role,
}))

interface RoleFieldProps {
  /** The signed-in user's own role. Anything below admin cannot set roles at
   *  all, and only an owner can grant "owner" — mirrored from the route so the
   *  form doesn't offer a choice the API will refuse. */
  actorRole: Role
  /** The role the edited account currently holds, when editing an existing one.
   *  Used to keep an owner's own row selectable rather than filtered away. */
  currentRole?: Role
  disabled?: boolean
}

/**
 * The role selector, shared by the create and edit drawers.
 *
 * It hides options the caller cannot grant, but that is convenience, not
 * security: `/api/admin-users` re-checks every one of these rules, because a
 * select element is a suggestion and a route handler is a decision.
 */
export default function RoleField({ actorRole, currentRole, disabled }: RoleFieldProps) {
  const { watch } = useFormContext()
  const selected = (watch('role') as Role | undefined) ?? currentRole

  const items = ROLE_ITEMS.filter((item) => {
    if (item.value !== 'owner') return true
    // Owner stays visible when it is already the account's role — removing it
    // would make the select render blank on the one row where the value is
    // most important to see.
    return actorRole === 'owner' || currentRole === 'owner'
  })

  return (
    <div className="flex flex-col gap-1.5">
      <ElementSelect
        name="role"
        label="Role"
        placeholder="Choose a role"
        items={items}
        required
        disabled={disabled}
      />
      {selected && (
        <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[selected]}</p>
      )}
      {currentRole === 'owner' && (
        <p className="text-xs text-muted-foreground">
          An owner can only be demoted by themselves, and never while they are the last
          active owner.
        </p>
      )}
    </div>
  )
}
