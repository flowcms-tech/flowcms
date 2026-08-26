'use client'

import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ElementFileSelector from '@/components/shared/ElementFileSelector/ElementFileSelector'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'

/**
 * Shared between the create and edit drawers so the two can't drift — an
 * author's field set is long enough that duplicating it would guarantee they
 * eventually disagree.
 */
export default function AuthorFormFields() {
  return (
    <>
      <ElementInput
        name="name"
        label="Name"
        placeholder="e.g. Sarah Mitchell"
        hint="The name readers see on the byline. Use a real person, not a brand — Google weighs identifiable authorship."
        required
      />
      <ElementInput
        name="slug"
        label="Slug"
        placeholder="sarah-mitchell"
        hint="Reserved for the author's future public page URL. Auto-generated from the name — edit to override."
        required
      />

      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold">Expertise</h3>
        <p className="text-xs text-muted-foreground">
          These are the signals Google&apos;s E-E-A-T guidance actually reads. For lock and
          security advice — content people act on to protect their homes — stated
          credentials matter more than they would on a lifestyle blog.
        </p>

        <ElementInput
          name="jobTitle"
          label="Job Title"
          placeholder="e.g. Senior Editor"
          hint="Becomes schema.org Person.jobTitle in structured data."
          maxLength={120}
        />
        <ElementInput
          name="credentials"
          label="Credentials"
          placeholder="e.g. MSc Nutrition, 12 years in practice"
          hint="Licence number, years of experience, trade memberships. Shown on the byline and read as an expertise signal."
          maxLength={200}
        />
        <ElementTextArea
          name="bio"
          label="Bio"
          placeholder="One or two sentences about this author's background."
          hint="Becomes schema.org Person.description. Keep it factual and specific."
          rows={3}
          maxLength={500}
        />
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold">Photo</h3>

        <ElementFileSelector
          name="avatarKey"
          label="Author Photo"
          hint="A real headshot. Used on the byline and as schema.org Person.image."
          accept="image"
        />
        <ElementInput
          name="avatarAltText"
          label="Photo Alt Text"
          placeholder="e.g. Sarah Mitchell, Senior Editor"
          hint="Describes the photo for people who can't see it. Usually just the author's name and role."
          maxLength={125}
        />
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold">Profile Links</h3>
        <p className="text-xs text-muted-foreground">
          These become the schema.org <code>sameAs</code> array — the strongest available
          signal that a byline is a verifiable person rather than a placeholder. Leave
          blank what doesn&apos;t exist; an empty link is worse than none.
        </p>

        <ElementInput name="websiteUrl" label="Website" placeholder="https://..." />
        <ElementInput name="linkedinUrl" label="LinkedIn" placeholder="https://www.linkedin.com/in/..." />
        <ElementInput name="twitterUrl" label="X / Twitter" placeholder="https://x.com/..." />
        <ElementInput name="facebookUrl" label="Facebook" placeholder="https://www.facebook.com/..." />
        <ElementInput name="instagramUrl" label="Instagram" placeholder="https://www.instagram.com/..." />
        <ElementInput
          name="email"
          label="Contact Email"
          type="email"
          placeholder="sarah@flowcms.tech"
          hint="Optional. Only shown publicly if the future author page chooses to."
        />
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold">Author Page SEO</h3>
        <p className="text-xs text-muted-foreground">
          Applies to the author&apos;s own page once that exists. Safe to leave blank now.
        </p>

        <ElementInput
          name="metaTitle"
          label="Meta Title"
          placeholder="Overrides the page <title> for SEO"
          hint="Title shown in Google results. Aim for under 60 characters."
          maxLength={70}
        />
        <ElementTextArea
          name="metaDescription"
          label="Meta Description"
          placeholder="Search-engine snippet text"
          hint="The summary under the title in Google results. Aim for 120–160 characters."
          rows={2}
          maxLength={160}
        />
        <ElementInput
          name="canonicalUrl"
          label="Canonical URL"
          placeholder="https://flowcms.tech/blog/author/..."
          hint="Only if this author profile also lives elsewhere."
        />
        <ElementCheckbox
          name="isIndexable"
          label="Allow search engines to index this author's page"
          defaultValue
          hint="Uncheck to keep the author's future page out of Google while their byline still appears on posts."
        />
      </div>
    </>
  )
}
