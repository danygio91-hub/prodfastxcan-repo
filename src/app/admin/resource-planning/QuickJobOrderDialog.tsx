"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import type { JobOrder, WorkGroup, JobPhase, Operator, OverallStatus } from '@/types';
import JobOrderCard from '@/components/production-console/JobOrderCard';
import WorkGroupCard from '@/components/production-console/WorkGroupCard';
import { useMasterData } from '@/contexts/MasterDataProvider';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { getOverallStatus } from '@/lib/types';
import { getDerivedJobStatus } from '@/lib/job-status';
import { convertTimestampsToDates } from '@/lib/utils';
import { 
  forceFinishProduction, 
  revertForceFinish, 
  toggleGuainaPhasePosition, 
  revertPhaseCompletion, 
  forcePauseOperators, 
  forceCompleteJob, 
  resetSingleCompletedJobOrder, 
  revertCompletion, 
  reportMaterialMissing, 
  resolveMaterialMissing, 
  updateJobDeliveryDate,
  updateJobPrepDate,
  getAnalysisForArticle,
  type ProductionTimeData,
  updatePhasesForJob
} from '@/app/admin/production-console/actions';
import { resolveJobProblem } from '@/app/scan-job/actions';
import { dissolveWorkGroup } from '@/app/admin/work-group-management/actions';

interface QuickJobOrderDialogProps {
    isOpen: boolean;
    onClose: () => void;
    job: JobOrder | null;
    onActionSuccess?: () => void;
}

export default function QuickJobOrderDialog({ isOpen, onClose, job, onActionSuccess }: QuickJobOrderDialogProps) {
    const router = useRouter();
    const { toast } = useToast();
    const { user } = useAuth();
    const { operators: cachedOperators } = useMasterData();

    const [isLoading, setIsLoading] = useState(false);
    const [workGroup, setWorkGroup] = useState<WorkGroup | null>(null);
    const [jobsInGroup, setJobsInGroup] = useState<JobOrder[]>([]);
    const [analysisDataMap, setAnalysisDataMap] = useState<Map<string, ProductionTimeData | null>>(new Map());
    const [isAnalysisLoading, setIsAnalysisLoading] = useState<Set<string>>(new Set());

    // Fasi modificabili (per PhaseManager)
    const [phaseManagedItem, setPhaseManagedItem] = useState<JobOrder | WorkGroup | null>(null);

    const loadGroupData = useCallback(async (groupId: string) => {
        setIsLoading(true);
        try {
            const groupDoc = await getDoc(doc(db, "workGroups", groupId));
            if (groupDoc.exists()) {
                const groupData = convertTimestampsToDates(groupDoc.data()) as WorkGroup;
                setWorkGroup(groupData);

                // Carica tutte le commesse del gruppo
                const jobsQuery = query(collection(db, "jobOrders"), where("workGroupId", "==", groupId));
                const jobsSnap = await getDocs(jobsQuery);
                const jobs = jobsSnap.docs.map(d => convertTimestampsToDates(d.data()) as JobOrder);
                setJobsInGroup(jobs);
            }
        } catch (error) {
            console.error("Error loading group data:", error);
            toast({ variant: "destructive", title: "Errore", description: "Impossibile caricare i dati del gruppo." });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        if (isOpen && job) {
            setWorkGroup(null);
            setJobsInGroup([]);
            if (job.workGroupId) {
                loadGroupData(job.workGroupId);
            }
        }
    }, [isOpen, job, loadGroupData]);

    const handleAction = async (actionFn: () => Promise<{ success: boolean; message: string }>) => {
        if (!user) return;
        const res = await actionFn();
        if (res.success) {
            toast({ title: "Successo", description: res.message });
            if (onActionSuccess) onActionSuccess();
            // Aggiorna dati locali se gruppo
            if (job?.workGroupId) loadGroupData(job.workGroupId);
        } else {
            toast({ variant: "destructive", title: "Errore", description: res.message });
        }
    };

    const handleFetchAnalysis = async (targetJob: JobOrder) => {
        if (!targetJob.id || !targetJob.details) return;
        setIsAnalysisLoading(prev => new Set(prev).add(targetJob.id));
        try {
            const analysis = await getAnalysisForArticle(targetJob.details);
            setAnalysisDataMap(prev => new Map(prev).set(targetJob.id, analysis));
        } catch (e) {
            toast({ variant: "destructive", title: "Errore Analisi" });
        } finally {
            setIsAnalysisLoading(prev => { const n = new Set(prev); n.delete(targetJob.id); return n; });
        }
    };

    if (!job && !isLoading) return null;

    const isGroupMode = !!job?.workGroupId && !!workGroup;
    const currentItem = isGroupMode ? workGroup! : job!;

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-slate-950 border-slate-800 text-slate-100">
                <DialogHeader className="flex flex-row items-center justify-between border-b border-slate-800 pb-4 mb-4">
                    <DialogTitle className="text-xl font-black uppercase tracking-tighter">
                        {isGroupMode ? `Console Gruppo: ${workGroup?.id}` : `Console Commessa: ${job?.ordinePF}`}
                    </DialogTitle>
                    <Button 
                        variant="outline" 
                        size="sm" 
                        className="bg-slate-900 border-slate-700 text-blue-400 hover:text-blue-300 hover:bg-slate-800 gap-2 mr-6"
                        onClick={() => {
                            const url = isGroupMode 
                                ? `/admin/production-console?groupId=${workGroup?.id}` 
                                : `/admin/production-console?ordinePF=${job?.ordinePF}&status=all`;
                            router.push(url);
                            onClose();
                        }}
                    >
                        <ExternalLink className="h-4 w-4" />
                        Vai alla pagina Console
                    </Button>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
                        <p className="mt-4 text-slate-400 font-bold uppercase tracking-widest text-xs">Caricamento Workflow...</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-6">
                        {isGroupMode ? (
                            <WorkGroupCard 
                                group={workGroup!} 
                                jobsInGroup={jobsInGroup} 
                                allOperators={cachedOperators}
                                isSelected={false}
                                onSelect={() => {}}
                                overallStatus={getDerivedJobStatus(workGroup!)}
                                getOverallStatus={getDerivedJobStatus}
                                onProblemClick={() => handleAction(() => resolveJobProblem(workGroup!.id, user!.uid))}
                                onForceFinishClick={(id) => handleAction(() => forceFinishProduction(id, user?.uid))}
                                onForcePauseClick={(id, ops) => handleAction(() => forcePauseOperators(id, ops, user?.uid, 'Pausa Admin'))}
                                onForceCompleteClick={(id) => handleAction(() => forceCompleteJob(id, user?.uid))}
                                onDissolveGroupClick={(id) => handleAction(async () => { await dissolveWorkGroup(id); return {success: true, message: "Gruppo sciolto."}})}
                                onOpenPhaseManager={(item) => setPhaseManagedItem(item)}
                                onOpenMaterialManager={() => {}} // TODO if needed
                                onToggleGuainaClick={(id, pid, state) => handleAction(() => toggleGuainaPhasePosition(id, pid, state))}
                                onUpdateDeliveryDate={(id, date) => handleAction(() => updateJobDeliveryDate(id, date, user!.uid))}
                                onUpdatePrepDate={(id, date) => handleAction(() => updateJobPrepDate(id, date, user!.uid))}
                                onNavigateToAnalysis={(article) => router.push(`/admin/production-time-analysis?articleCode=${encodeURIComponent(article)}`)}
                                onCopyArticleCode={(code) => { navigator.clipboard.writeText(code); toast({ title: "Copiato!" }); }}
                            />
                        ) : (
                            <JobOrderCard 
                                jobOrder={job!} 
                                allOperators={cachedOperators}
                                isSelected={false}
                                onSelect={() => {}}
                                overallStatus={getDerivedJobStatus(job!)}
                                analysisData={analysisDataMap.get(job!.id)}
                                isAnalysisLoading={isAnalysisLoading.has(job!.id)}
                                onFetchAnalysis={() => handleFetchAnalysis(job!)}
                                onProblemClick={() => handleAction(() => resolveJobProblem(job!.id, user!.uid))}
                                onForceFinishClick={(id) => handleAction(() => forceFinishProduction(id, user?.uid))}
                                onRevertForceFinishClick={(id) => handleAction(() => revertForceFinish(id, user?.uid))}
                                onToggleGuainaClick={(id, pid, state) => handleAction(() => toggleGuainaPhasePosition(id, pid, state))}
                                onRevertPhaseClick={(id, pid) => handleAction(() => revertPhaseCompletion(id, pid, user?.uid))}
                                onRevertCompletionClick={(id) => handleAction(() => revertCompletion(id, user!.uid))}
                                onForcePauseClick={(id, ops, reason, notes) => handleAction(() => forcePauseOperators(id, ops, user?.uid, reason, notes))}
                                onForceCompleteClick={(id) => handleAction(() => forceCompleteJob(id, user?.uid))}
                                onResetJobOrderClick={(id) => handleAction(() => resetSingleCompletedJobOrder(id, user!.uid))}
                                onOpenPhaseManager={(item) => setPhaseManagedItem(item)}
                                onOpenMaterialManager={() => {}}
                                onUpdateDeliveryDate={(id, date) => handleAction(() => updateJobDeliveryDate(id, date, user!.uid))}
                                onUpdatePrepDate={(id, date) => handleAction(() => updateJobPrepDate(id, date, user!.uid))}
                                onNavigateToAnalysis={(article) => router.push(`/admin/production-time-analysis?articleCode=${encodeURIComponent(article)}`)}
                                onCopyArticleCode={(code) => { navigator.clipboard.writeText(code); toast({ title: "Copiato!" }); }}
                                forceAllowActions={true}
                            />
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
