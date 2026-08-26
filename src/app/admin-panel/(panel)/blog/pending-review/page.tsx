import { auth } from "@/Framework/Auth/auth"
import PendingReviewModule from "@/Modules/Blog/PendingReview/PendingReviewModule"

/** The signed-in editor's id is resolved here so the queue can drop the
 *  approve/reject buttons on their own submissions — the route refuses a
 *  self-review, and a button that always 422s is worse than no button. */
export default async function BlogPendingReviewPage() {
  const session = await auth()
  return <PendingReviewModule currentUserId={session?.user?.id ?? ""} />
}
