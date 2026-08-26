import PostPreviewModule from "@/Modules/Blog/Posts/PostPreviewModule"

export default async function BlogPostPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <PostPreviewModule postId={id} />
}
