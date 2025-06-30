
'use server';

import { revalidatePath } from 'next/cache';
import { mockOperators } from '@/lib/mock-data';

export async function signPrivacyPolicy(operatorId: string): Promise<{ success: boolean; message: string }> {
  const operatorIndex = mockOperators.findIndex(op => op.id === operatorId);

  if (operatorIndex === -1) {
    return { success: false, message: 'Operatore non trovato.' };
  }

  mockOperators[operatorIndex].privacySigned = true;

  // Revalidate the path for the admin dashboard to see the change
  revalidatePath('/admin/operator-management');
  // Revalidate the operator data page itself to ensure consistency
  revalidatePath('/operator-data');

  return { success: true, message: 'Informativa sulla privacy firmata con successo.' };
}
