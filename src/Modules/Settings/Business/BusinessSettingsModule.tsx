'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import SettingsShell from '@/Modules/Settings/Components/SettingsShell'
import { SettingsServices } from '@/Modules/Settings/Services/SettingsServices'
import {
  updateSiteSettingsSchema,
  OPENING_HOURS_DAYS,
  type UpdateSiteSettingsFormValues,
  type OpeningHoursEntryValues,
} from '@/Modules/Settings/Values/Validations'

const EMPTY: UpdateSiteSettingsFormValues = {
  businessName: '', businessLegalName: '', businessType: '', businessPhone: '', businessEmail: '',
  addressStreet: '', addressCity: '', addressRegion: '', addressPostalCode: '', addressCountry: '',
  geoLatitude: '', geoLongitude: '', priceRange: '',
  openingHours: [], serviceAreaNames: [], socialProfileUrls: [],
}

/** A few common schema.org LocalBusiness subtypes, offered as suggestions.
 *  Free text is still allowed — schema.org has hundreds of them and hardcoding
 *  a closed list here would just block a correct answer. */
const BUSINESS_TYPES = [
  'LocalBusiness',
  'ProfessionalService',
  'Store',
  'FoodEstablishment',
  'HomeAndConstructionBusiness',
  'MedicalBusiness',
  'AutomotiveBusiness',
  'EntertainmentBusiness',
]

const NEW_HOURS_ROW: OpeningHoursEntryValues = {
  dayOfWeek: [...OPENING_HOURS_DAYS],
  opens: '00:00',
  closes: '23:59',
}

export default function BusinessSettingsModule() {
  const queryClient = useQueryClient()
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const { data: settings, isLoading } = useQuery({
    queryKey: ['global-settings'],
    queryFn: SettingsServices.get,
  })

  const methods = useForm<UpdateSiteSettingsFormValues>({
    resolver: zodResolver(updateSiteSettingsSchema),
    defaultValues: EMPTY,
  })

  const { handleSubmit, reset, watch, setValue, formState: { isSubmitting } } = methods

  useEffect(() => {
    if (settings) {
      reset({
        businessLegalName: settings.businessLegalName,
        businessType: settings.businessType,
        businessPhone: settings.businessPhone,
        businessEmail: settings.businessEmail,
        addressStreet: settings.addressStreet,
        addressCity: settings.addressCity,
        addressRegion: settings.addressRegion,
        addressPostalCode: settings.addressPostalCode,
        addressCountry: settings.addressCountry,
        geoLatitude: settings.geoLatitude,
        geoLongitude: settings.geoLongitude,
        priceRange: settings.priceRange,
        openingHours: settings.openingHours,
        serviceAreaNames: settings.serviceAreaNames,
        socialProfileUrls: settings.socialProfileUrls,
      })
    }
  }, [settings, reset])

  const openingHours = watch('openingHours') ?? []
  const serviceAreaNames = watch('serviceAreaNames') ?? []
  const socialProfileUrls = watch('socialProfileUrls') ?? []

  // The three JSON-backed fields are edited as real rows, never as raw JSON.
  // Rewriting the whole array through setValue (rather than useFieldArray) is
  // what keeps the arrays plain strings/objects end to end — the shape the
  // route stringifies and the JSON-LD reads is exactly the shape in the form.
  const setHours = (rows: OpeningHoursEntryValues[]) =>
    setValue('openingHours', rows, { shouldDirty: true })
  const setAreas = (rows: string[]) =>
    setValue('serviceAreaNames', rows, { shouldDirty: true })
  const setProfiles = (rows: string[]) =>
    setValue('socialProfileUrls', rows, { shouldDirty: true })

  const toggleDay = (rowIndex: number, day: string) => {
    const rows = openingHours.map((row, index) => {
      if (index !== rowIndex) return row
      const has = row.dayOfWeek.includes(day)
      return {
        ...row,
        // Kept in week order rather than click order — dayOfWeek goes straight
        // into the markup, and a spec listing Sunday before Monday reads as
        // machine noise to anyone auditing it.
        dayOfWeek: has
          ? row.dayOfWeek.filter((d) => d !== day)
          : OPENING_HOURS_DAYS.filter((d) => d === day || row.dayOfWeek.includes(d)),
      }
    })
    setHours(rows)
  }

  const onSubmit = async (values: UpdateSiteSettingsFormValues) => {
    setServerErrors([])
    try {
      const updated = await SettingsServices.update(values)
      queryClient.setQueryData(['global-settings'], updated)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string | string[] } } }
      if (axiosErr.response?.status === 422) {
        const raw = axiosErr.response.data?.message
        setServerErrors(Array.isArray(raw) ? raw : raw ? [raw] : ['An error occurred'])
      } else {
        setServerErrors(['An error occurred'])
      }
    }
  }

  return (
    <SettingsShell
      description="The name, address, phone, and hours that feed this site's LocalBusiness structured data — the markup Google reads for map and local results."
      onSave={handleSubmit(onSubmit)}
      isSaving={isSubmitting}
    >
      {isLoading || !settings ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
            <ValidationBox messages={serverErrors} />

            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <p>
                This tab is the only source for your site&apos;s LocalBusiness structured data.
                There is no fallback: a field left blank is simply not published, because search
                engines read this as a factual claim about your business and a plausible-looking
                default would be a false one.
              </p>
              <p className="mt-2">
                <strong className="text-foreground">Business Name is the switch.</strong> Until it
                is set, no LocalBusiness markup is emitted at all. Everything else is optional
                detail on top of it.
              </p>
            </div>

            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold">Identity</h2>

              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementInput
                  name="businessName"
                  label="Business Name"
                  placeholder="e.g. Blue Harbour Bakery"
                  hint="The trading name. Distinct from Site Name under Global — the site is not necessarily the legal entity. Leave blank to publish no LocalBusiness markup."
                />
                <ElementInput
                  name="businessLegalName"
                  label="Legal Name"
                  placeholder="e.g. Blue Harbour Lda."
                  hint="The registered entity name, which may differ from the trading name shown on the site."
                />
              </div>

              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementSelect
                  name="businessType"
                  label="Schema Type"
                  items={BUSINESS_TYPES}
                  creatable
                  searchable
                  clearable
                  placeholder="LocalBusiness"
                  hint="The schema.org type for the business node. Pick the most specific type that is accurate; LocalBusiness is the safe generic."
                />
              </div>

              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementInput
                  name="businessPhone"
                  label="Phone"
                  type="tel"
                  placeholder="+15551234567"
                  hint="E.164 format, including the country code. This is the number published in your structured data."
                />
                <ElementInput
                  name="businessEmail"
                  label="Email"
                  type="email"
                  placeholder="info@example.com"
                />
              </div>
            </section>

            <section className="flex flex-col gap-4 border-t border-border pt-6">
              <div>
                <h2 className="text-sm font-semibold">Address</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  This has to match the business listing elsewhere character for character. An
                  address that differs between the site, Google Business Profile, and directories is
                  the most common reason local results don&apos;t consolidate.
                </p>
              </div>

              <ElementInput name="addressStreet" label="Street" placeholder="e.g. 1 Dock Road" />

              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementInput name="addressCity" label="City" placeholder="e.g. Lisbon" />
                <ElementInput name="addressRegion" label="Province / Region" placeholder="e.g. Lisboa" />
              </div>

              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementInput name="addressPostalCode" label="Postal Code" placeholder="e.g. 1100-148" />
                <ElementInput
                  name="addressCountry"
                  label="Country"
                  placeholder="CA"
                  hint="Two-letter ISO country code."
                />
              </div>

              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementInput
                  name="geoLatitude"
                  label="Latitude"
                  placeholder="43.8161"
                  hint="Copy from the coordinates in a Google Maps URL. Leave both blank to emit no geo data at all."
                />
                <ElementInput name="geoLongitude" label="Longitude" placeholder="-79.5100" />
              </div>
            </section>

            <section className="flex flex-col gap-4 border-t border-border pt-6">
              <h2 className="text-sm font-semibold">Pricing</h2>
              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementInput name="priceRange" label="Price Range" placeholder="$$" maxLength={20} />
              </div>
              <p className="text-sm text-muted-foreground">
                Leaving this blank is deliberate, and blank is the right answer unless you have real
                figures. A guessed price range is a guess published in machine-readable form —
                search engines quote it, and customers hold you to it. Nothing is emitted while this
                is empty.
              </p>
            </section>

            <section className="flex flex-col gap-4 border-t border-border pt-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold">Opening Hours</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    One row per distinct schedule. Leave this empty for the 24/7 default already in
                    the config file.
                  </p>
                </div>
                <ElementButton
                  type="button"
                  variant="cancel"
                  size="sm"
                  onClick={() => setHours([...openingHours, { ...NEW_HOURS_ROW }])}
                >
                  <Plus size={14} /> Add row
                </ElementButton>
              </div>

              {openingHours.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No rows — the site will publish “open 24 hours, every day”.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {openingHours.map((row, index) => (
                    <div
                      key={index}
                      className="flex flex-col gap-3 rounded-lg border border-border p-3"
                    >
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        {OPENING_HOURS_DAYS.map((day) => (
                          <div key={day} className="flex items-center gap-1.5">
                            <ElementCheckbox
                              value={row.dayOfWeek.includes(day)}
                              onChange={() => toggleDay(index, day)}
                            />
                            <span
                              className="cursor-pointer select-none text-xs"
                              onClick={() => toggleDay(index, day)}
                            >
                              {day.slice(0, 3)}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-end gap-4">
                        <div className="w-32">
                          <ElementInput
                            name={`openingHours.${index}.opens`}
                            label="Opens"
                            type="time"
                          />
                        </div>
                        <div className="w-32">
                          <ElementInput
                            name={`openingHours.${index}.closes`}
                            label="Closes"
                            type="time"
                          />
                        </div>
                        <ElementButton
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            setHours(openingHours.filter((_, i) => i !== index))
                          }
                        >
                          <Trash2 size={14} /> Remove
                        </ElementButton>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-4 border-t border-border pt-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold">Service Areas</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Cities and towns this business actually serves — they become
                    <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">areaServed</code>
                    in the markup. Listing somewhere you can&apos;t reach is a claim, not a keyword.
                  </p>
                </div>
                <ElementButton
                  type="button"
                  variant="cancel"
                  size="sm"
                  onClick={() => setAreas([...serviceAreaNames, ''])}
                >
                  <Plus size={14} /> Add area
                </ElementButton>
              </div>

              {serviceAreaNames.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No service areas set, so none are published.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {serviceAreaNames.map((_, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <div className="flex-1">
                        <ElementInput name={`serviceAreaNames.${index}`} placeholder="e.g. Lisbon" />
                      </div>
                      <ElementButton
                        type="button"
                        variant="destructive"
                        size="lg"
                        onClick={() =>
                          setAreas(serviceAreaNames.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 size={14} />
                      </ElementButton>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-4 border-t border-border pt-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold">Social Profiles</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Only profiles this business genuinely owns. They become
                    <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">sameAs</code>, which
                    is how search engines confirm two listings are the same entity — a wrong URL
                    here merges you with somebody else.
                  </p>
                </div>
                <ElementButton
                  type="button"
                  variant="cancel"
                  size="sm"
                  onClick={() => setProfiles([...socialProfileUrls, ''])}
                >
                  <Plus size={14} /> Add profile
                </ElementButton>
              </div>

              {socialProfileUrls.length === 0 ? (
                <p className="text-sm text-muted-foreground">None set — nothing is emitted.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {socialProfileUrls.map((_, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <div className="flex-1">
                        <ElementInput
                          name={`socialProfileUrls.${index}`}
                          type="url"
                          placeholder="https://www.facebook.com/yourpage"
                        />
                      </div>
                      <ElementButton
                        type="button"
                        variant="destructive"
                        size="lg"
                        onClick={() =>
                          setProfiles(socialProfileUrls.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 size={14} />
                      </ElementButton>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </form>
        </FormProvider>
      )}
    </SettingsShell>
  )
}
