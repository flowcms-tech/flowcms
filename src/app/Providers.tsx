'use client';

import { ProgressProvider } from '@bprogress/next/app';

const Providers = ({ children }: { children: React.ReactNode }) => {
    return (
        <ProgressProvider
            height="4px"
            color="var(--primary)"
            shallowRouting
        >
            {children}
        </ProgressProvider>
    );
};

export default Providers;
