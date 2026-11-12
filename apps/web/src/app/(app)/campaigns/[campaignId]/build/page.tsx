'use client';

// V7 Campaign builder (spec §15.10), steps 1–7 for a draft, and the editor for any campaign: the
// step lives in the URL; each step saves as you go; Back and Continue move between them. Launching
// is the last step's job. A launched campaign can be edited here too, within what the API allows.

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { AgentStep } from '../../../../../components/builder/agent.tsx';
import { AudienceStep } from '../../../../../components/builder/audience.tsx';
import { BasicsStep } from '../../../../../components/builder/basics.tsx';
import { useCampaign } from '../../../../../components/builder/common.tsx';
import { EmailsStep } from '../../../../../components/builder/emails.tsx';
import { GoalsStep } from '../../../../../components/builder/goals.tsx';
import { ReviewStep } from '../../../../../components/builder/review.tsx';
import { SendingStep } from '../../../../../components/builder/sending.tsx';
import { BuilderSteps, STEPS, type StepKey } from '../../../../../components/builder/steps.tsx';
import { CampaignStatusPill } from '../../../../../components/campaign/bits.tsx';
import { Button, ErrorText, Loading } from '../../../../../components/ui.tsx';

export default function BuildPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Build />
    </Suspense>
  );
}

function Build() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const campaign = useCampaign(campaignId);
  const step = (STEPS.find((entry) => entry.key === params.get('step'))?.key ?? 'basics') as StepKey;
  const index = STEPS.findIndex((entry) => entry.key === step);
  const go = (to: number) => router.push(`/campaigns/${campaignId}/build?step=${STEPS[to]!.key}`);

  if (campaign.isPending) return <Loading />;
  if (campaign.isError) return <ErrorText error={campaign.error} />;
  const data = campaign.data;

  return (
    <div className="max-w-5xl space-y-4">
      <Link href={`/campaigns/${campaignId}`} className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft aria-hidden className="size-4" /> {data.name}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{data.status === 'draft' ? 'New campaign' : `Edit ${data.name}`}</h1>
        <CampaignStatusPill status={data.status} />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Saved as you go.</span>
      </div>
      <BuilderSteps current={step} campaignId={campaignId} />
      {data.status !== 'draft' && step !== 'review' && <p className="text-xs text-amber-700 dark:text-amber-300">This campaign is {data.status}: some changes, such as goals threads have reached, can’t be made now.</p>}
      {step === 'basics' && <BasicsStep campaign={data} />}
      {step === 'goals' && <GoalsStep campaign={data} />}
      {step === 'audience' && <AudienceStep campaign={data} />}
      {step === 'emails' && <EmailsStep campaign={data} />}
      {step === 'agent' && <AgentStep campaign={data} />}
      {step === 'sending' && <SendingStep campaign={data} />}
      {step === 'review' && <ReviewStep campaign={data} onFix={(key) => router.push(`/campaigns/${campaignId}/build?step=${key}`)} />}
      <div className="flex gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        {index > 0 && (
          <Button variant="ghost" onClick={() => go(index - 1)}>
            ← Back
          </Button>
        )}
        {index < STEPS.length - 1 && (
          <Button variant="primary" onClick={() => go(index + 1)}>
            Continue →
          </Button>
        )}
      </div>
    </div>
  );
}
