export interface ManualMultiRow {
  id: string;
  department: string;
  ordinePF: string;
  cliente: string;
  articleCode: string;
  qta: number | string;
  dataConsegnaFinale: string;
}

export const createInitialRow = (dept: string = 'CP'): ManualMultiRow => ({
  id: Math.random().toString(36).substring(2, 9),
  department: dept,
  ordinePF: '',
  cliente: '',
  articleCode: '',
  qta: 100,
  dataConsegnaFinale: '',
});

/**
 * FASE 70: Verifica se una riga è completamente vuota/intonsa.
 * Se l'utente non ha inserito Ordine PF, Cliente, Articolo né Data Consegna,
 * la riga è considerata intonsa/vuota, a prescindere dai valori predefiniti (come qta: 100 o reparto).
 */
export const isManualMultiRowEmpty = (r: ManualMultiRow): boolean => {
  const pf = (r.ordinePF || '').trim();
  const cliente = (r.cliente || '').trim();
  const article = (r.articleCode || '').trim();
  const delivery = (r.dataConsegnaFinale || '').trim();
  return !pf && !cliente && !article && !delivery;
};
