import BlogPostEditModule from "@/Modules/Blog/Posts/BlogPostEditModule"

export default async function BlogPostEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <BlogPostEditModule postId={id} />
}
