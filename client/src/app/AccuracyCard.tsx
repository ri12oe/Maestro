import { api } from '../api/client.ts';
import { useApi } from '../hooks/useApi.ts';
import { shortDate } from '../dates.ts';
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '../ui/primitives.tsx';
import {
  ACCURACY_EXPLANATION,
  DISPUTE_REMINDER,
  accuracyCredit,
  accuracyPercentLabel,
  holdoutLine,
  recordedLine,
} from '../evalAccuracy.ts';

/**
 * Measured accuracy of the classifier on the hand-labeled holdout.
 * The figures and the provider come from GET /api/eval. They describe the AI.
 */
export function AccuracyCard() {
  const evalState = useApi(() => api.evalResults(), []);
  const data = evalState.data;
  const ready = data?.available === true ? data : null;

  return (
    <Card
      title="Is the AI right?"
      action={ready ? <Badge>{ready.provider === 'mock' ? 'Offline mock' : ready.provider}</Badge> : undefined}
    >
      {evalState.loading && !data && (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton w="48%" h={14} />
          <Skeleton w="72%" h={28} />
          <Skeleton w="90%" h={14} />
        </div>
      )}
      {evalState.error && <ErrorState message={evalState.error} onRetry={evalState.reload} />}
      {data && !data.available && !evalState.error && (
        <EmptyState
          bulb="none"
          heading="No accuracy check yet"
          line="A measured check of the classifier on hand-labeled commits has not been recorded."
        />
      )}
      {ready && !evalState.error && (
        <div className="flex flex-col gap-3">
          <p className="text-fg-muted">{holdoutLine(ready.holdoutSize)}</p>
          <dl className="grid grid-cols-2 gap-4">
            <AccuracyFigure label="Work type" correct={ready.workType.correct} total={ready.workType.total} accuracy={ready.workType.accuracy} provider={ready.provider} holdoutSize={ready.holdoutSize} />
            <AccuracyFigure label="Substance" correct={ready.substance.correct} total={ready.substance.total} accuracy={ready.substance.accuracy} provider={ready.provider} holdoutSize={ready.holdoutSize} />
          </dl>
          <p className="text-label font-normal text-fg-muted">
            {recordedLine({ dateLabel: shortDate(ready.date), provider: ready.provider, model: ready.model })}
          </p>
          <p>{ACCURACY_EXPLANATION}</p>
          <p className="text-fg-muted">{DISPUTE_REMINDER}</p>
        </div>
      )}
    </Card>
  );
}

function AccuracyFigure({ label, correct, total, accuracy, provider, holdoutSize }: {
  label: string; correct: number; total: number; accuracy: number; provider: string; holdoutSize: number;
}) {
  return (
    <div>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-[28px] leading-9 font-semibold tracking-[-0.02em]">{accuracyPercentLabel(accuracy)}</dd>
      <dd className="text-caption font-normal text-fg-muted">{accuracyCredit({ accuracy, provider, holdoutSize })}</dd>
      <dd className="text-caption font-normal text-fg-muted">{correct} of {total}</dd>
    </div>
  );
}
