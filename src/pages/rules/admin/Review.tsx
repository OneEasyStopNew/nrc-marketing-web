import type { ReactElement } from 'react';
import { HStack } from '@astryxdesign/core/Layout';
import { useSession } from '@/auth/AuthProvider';
import { policyAdminApi, reviewCapability, type PolicyBundleDetail, type ReviewItem } from '@/api/policyAdmin';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { isApiError } from '@/api/errors';
import { useRulebookChange } from './useRulebooks';

/**
 * Approve or reject one item of a rulebook (NRC-20 review). Shown only while
 * the rulebook can be reviewed (draft or in review), only on items not yet
 * reviewed, and only to the role that reviews that kind of item: exceptions,
 * disclosures and study wording go to the policy owner, the rest to the policy
 * administrator. The API checks the same and answers 403 otherwise.
 */
export function ReviewButtons({ bundle, item, id, name }: {
  bundle: PolicyBundleDetail;
  item: ReviewItem;
  /** The item's id, sent as item_id. */
  id: string;
  /** What the item is, in words, for the buttons' accessible names ("rule SYN-REC-04"). */
  name: string;
}): ReactElement | null {
  const caps = useSession().context.capabilities;
  const { toast } = useToast();
  const review = useRulebookChange((decision: 'APPROVED' | 'REJECTED') =>
    policyAdminApi.review(bundle.id, bundle.revision, { item_kind: item.kind, item_id: id, decision, note: null }));
  const open = bundle.lifecycle_state === 'DRAFT' || bundle.lifecycle_state === 'REVIEW';
  if (!open || !caps.includes(reviewCapability(item))) return null;

  const decide = (decision: 'APPROVED' | 'REJECTED') => review.mutate([decision], {
    onSuccess: () => toast(decision === 'APPROVED' ? `Approved ${name}` : `Rejected ${name}`, 'done'),
    onError: (e) => toast(`Could not review ${name}`, 'blocked', isApiError(e) && e.kind === 'stale' ? 'Someone changed this rulebook. The page now shows the latest version; try again.' : e.message),
  });

  return (
    <HStack gap={2} wrap="wrap">
      <Button size="sm" variant="secondary" icon="check" loading={review.isPending && review.variables?.[0] === 'APPROVED'}
        aria-label={`Approve ${name}`} onClick={() => decide('APPROVED')}>Approve</Button>
      <Button size="sm" variant="danger-outline" icon="x" loading={review.isPending && review.variables?.[0] === 'REJECTED'}
        aria-label={`Reject ${name}`} onClick={() => decide('REJECTED')}>Reject</Button>
    </HStack>
  );
}
