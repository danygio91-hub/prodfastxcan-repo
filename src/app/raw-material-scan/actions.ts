
'use server';

// This file is now obsolete.
// The functionality has been moved to:
// - src/app/material-loading/actions.ts (for loading stock)
// - src/app/scan-job/actions.ts (for consuming stock within a job)

// Keeping this file to prevent build errors from old imports, but it should not be used.
// It will be deleted in a future cleanup.

export async function placeholder() {
  return { success: true, message: "This action is obsolete." };
}
