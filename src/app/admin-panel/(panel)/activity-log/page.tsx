import ActivityLogModule from "@/Modules/ActivityLog/ActivityLogModule"

/** No session read here beyond what the panel layout already does: the log is
 *  readable by any signed-in panel user, and the route re-checks that anyway. */
export default function ActivityLogPage() {
  return <ActivityLogModule />
}
