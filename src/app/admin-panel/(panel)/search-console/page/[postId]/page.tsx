import PageProfileModule from "@/Modules/SearchConsole/PageProfileModule"

export default async function SearchConsolePageProfilePage({
  params,
}: {
  params: Promise<{ postId: string }>
}) {
  const { postId } = await params
  return <PageProfileModule postId={postId} />
}
