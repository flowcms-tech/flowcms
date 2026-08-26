import PageLookupModule from "@/Modules/SearchConsole/PageLookupModule"

export default async function SearchConsolePageLookupPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>
}) {
  const { url } = await searchParams
  return <PageLookupModule initialUrl={url} />
}
