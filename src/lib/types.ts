import type { JobOrder, WorkGroup, OverallStatus } from "@/types";
import { getDerivedJobStatus } from "./job-status";


/**
 * @deprecated Utilizzare getDerivedJobStatus da @/lib/job-status per coerenza SSoT.
 */
export function getOverallStatus(item: JobOrder | WorkGroup): OverallStatus {
    return getDerivedJobStatus(item);
}
