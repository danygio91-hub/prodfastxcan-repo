import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const buildIdPath = path.join(process.cwd(), '.next', 'BUILD_ID');
        if (fs.existsSync(buildIdPath)) {
            const buildId = fs.readFileSync(buildIdPath, 'utf8').trim();
            return NextResponse.json({ buildId });
        }
        
        // Fallback for Vercel environments
        if (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA) {
            return NextResponse.json({ buildId: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA });
        }

        return NextResponse.json({ buildId: 'development' });
    } catch (error) {
        return NextResponse.json({ buildId: 'error' }, { status: 500 });
    }
}
