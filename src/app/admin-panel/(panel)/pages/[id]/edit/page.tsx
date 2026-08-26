import PageEditModule from "@/Modules/Pages/PageEditModule"

export default async function PageEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <PageEditModule id={id} />
}
